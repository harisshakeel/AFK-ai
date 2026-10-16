-- Fixes from the pre-submission review (docs/review.md).

-- 1. Exported AI output is loaded only when a job is waiting for it. Re-running the seed
--    import against an unchanged transcript used to delete and re-insert every item,
--    which cascaded away visitors' ticks (item_states). A meeting whose output is already
--    in place is now left alone; a changed transcript queues new jobs, so it still loads.
create or replace function public.import_generated(
  p_meeting_id text, p_transcript_hash text, p_kind text, p_payload jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meetings where id = p_meeting_id and transcript_hash = p_transcript_hash
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.processing_jobs
    where meeting_id = p_meeting_id and kind = p_kind and status in ('queued', 'failed')
  ) then
    return false;
  end if;
  if p_kind = 'analyze' then
    perform public.apply_analysis(p_meeting_id, p_payload);
  elsif p_kind = 'summarize' then
    perform public.apply_summaries(p_meeting_id, p_payload);
  else
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;
  update public.processing_jobs
  set status = 'done', finished_at = now(), last_error = null,
      report = jsonb_build_object('source', 'data/ai export')
  where meeting_id = p_meeting_id and kind = p_kind and status in ('queued', 'failed');
  return true;
end $$;

-- 1b. Deleting a meeting cascades to its turns and, separately, to its items and their
--     citations. The citation -> turn key had no delete action, so the turn cascade hit
--     citations that the item cascade had not reached yet and the delete failed (found
--     by the review's database test). Both keys now cascade; ingest_transcript() still
--     deletes items before turns, so nothing else changes.
alter table public.item_citations
  drop constraint item_citations_turn_fk,
  add constraint item_citations_turn_fk foreign key (meeting_id, turn_id)
    references public.transcript_turns (meeting_id, id) on delete cascade;

alter table public.chapters
  drop constraint chapters_first_turn_fk,
  add constraint chapters_first_turn_fk foreign key (meeting_id, first_turn_id)
    references public.transcript_turns (meeting_id, id) on delete cascade;

-- 1c. When a bot meeting's ingest job dies by lease expiry for the last time, the meeting
--     itself is marked failed too, so the page stops saying "Processing" for good.
create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
begin
  with expired as (
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        last_error = 'lease expired (worker stopped mid-job)',
        claim_token = null, lease_until = null
    where status = 'running' and lease_until < now()
    returning meeting_id, kind, status
  )
  update public.meetings m
  set status = 'failed',
      status_detail = 'The recording could not be processed. The worker stopped three times.'
  from expired e
  where e.meeting_id = m.id and e.kind = 'ingest_media' and e.status = 'failed'
    and m.status = 'transcribed';

  return query
  update public.processing_jobs j
  set status = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = now(), worker_id = p_worker_id
  where j.id = (
    select q.id
    from public.processing_jobs q
    join public.meetings m on m.id = q.meeting_id
    where q.status = 'queued' and q.run_after <= now()
      and (p_kinds is null or q.kind = any (p_kinds))
      and (m.owner_id is null or exists (select 1 from public.operators o where o.user_id = m.owner_id))
    order by q.run_after, q.created_at
    limit 1
    for update of q skip locked
  )
  returning j.*;
end $$;

-- 2. The write limit is not an argument a visitor can pass: the function takes none.
drop function public.note_visitor_write(integer);

create function public.note_visitor_write()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;
  delete from public.visitor_writes where owner_id = v_uid and at < now() - interval '1 minute';
  select count(*) into v_count
  from public.visitor_writes
  where owner_id = v_uid and at >= now() - interval '1 minute';
  if v_count >= 60 then
    return false;
  end if;
  insert into public.visitor_writes (owner_id) values (v_uid);
  return true;
end $$;

revoke execute on function public.note_visitor_write() from public, anon;
grant execute on function public.note_visitor_write() to authenticated, service_role;

-- 3. Supabase grants execute on new functions to anon by default; "revoke from public"
--    in the earlier migration did not undo that for this one. Anon has no write grant on
--    item_states, so nothing was reachable, but the grant list should say what it means.
revoke execute on function public.can_tick_item(uuid) from anon;

-- 4. Caps per identity, so one visitor (or a script minting identities) cannot fill the
--    database: 300 highlights per visitor and 50 links per highlight, counting revoked
--    ones. Both are far above honest use. The checks run as the visitor, so Row Level
--    Security scopes the counts to their own rows.
create or replace function public.cap_highlights()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.highlights where owner_id = new.owner_id) >= 300 then
    raise exception 'at most 300 highlights per visitor' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger highlights_cap
  before insert on public.highlights
  for each row execute function public.cap_highlights();

create or replace function public.cap_share_links()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.share_links where highlight_id = new.highlight_id) >= 50 then
    raise exception 'at most 50 links per highlight' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger share_links_cap
  before insert on public.share_links
  for each row execute function public.cap_share_links();
