-- Any signed-in user may send the bot; AI output stays for operators (requirement F9,
-- amended; "How v1 works").
--
-- Access model after this migration:
--   * anonymous visitor: reads seed meetings, owns highlights, ticks and share links
--   * signed-in user (Google): also sends the bot to their own calls; the recording and
--     transcript are private to them (RLS: owner_id = auth.uid(), unchanged)
--   * operator (operators table): also gets AI output, because a Claude run on AFK's own
--     subscription may only serve its operators
--
-- What changes:
--   1. claim_job() hands out ingest_media for any owner (no Claude in ingest: Attendee,
--      ffmpeg and Storage only); analyze and summarize stay seed-or-operator only.
--   2. ingest_transcript() queues analyze and summarize only for seed and operator
--      meetings, so a signed-in user's meeting is "ready" with no AI jobs instead of
--      "queued" forever.
--   3. A per-user cap on bot requests (5 a day, counted in bot_requests so a delete does
--      not reset it). The route adds a global daily cap on top.

-- 1. Who gets which job.
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
      -- ingest runs no AI, so it serves every owner; Claude runs serve seed and operators
      and (q.kind = 'ingest_media'
           or m.owner_id is null
           or exists (select 1 from public.operators o where o.user_id = m.owner_id))
    order by q.run_after, q.created_at
    limit 1
    for update of q skip locked
  )
  returning j.*;
end $$;

-- 2. AI jobs only where a Claude run is allowed.
create or replace function public.ingest_transcript(
  p_meeting_id text, p_duration_sec numeric, p_speakers jsonb, p_turns jsonb, p_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_hash text;
  v_owner uuid;
begin
  select transcript_hash, owner_id into v_hash, v_owner
  from public.meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'meeting % does not exist', p_meeting_id using errcode = 'P0002';
  end if;
  if v_hash is not distinct from p_hash then
    return false;
  end if;

  delete from public.meeting_items where meeting_id = p_meeting_id;
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.transcript_turns where meeting_id = p_meeting_id;
  delete from public.meeting_speakers where meeting_id = p_meeting_id;

  insert into public.meeting_speakers (meeting_id, code, label, idx)
  select p_meeting_id, s.value ->> 'code', s.value ->> 'label', (s.ord - 1)::int
  from jsonb_array_elements(p_speakers) with ordinality as s(value, ord);

  insert into public.transcript_turns (id, meeting_id, idx, speaker_code, start_sec, end_sec, text)
  select t.value ->> 'id', p_meeting_id, (t.ord - 1)::int, t.value ->> 'speaker',
         (t.value ->> 'startSec')::numeric, (t.value ->> 'endSec')::numeric, t.value ->> 'text'
  from jsonb_array_elements(p_turns) with ordinality as t(value, ord);

  if exists (
    select 1 from public.transcript_turns
    where meeting_id = p_meeting_id and end_sec > p_duration_sec
  ) then
    raise exception 'a turn ends after the meeting' using errcode = '23514';
  end if;

  update public.meetings
  set transcript_hash = p_hash, duration_sec = p_duration_sec, ai_headline = null
  where id = p_meeting_id;

  -- Older queued or running generation is retired so its output (keyed to the old
  -- turns) can never be published.
  update public.processing_jobs
  set status = 'failed', last_error = 'superseded by a new transcript', finished_at = now(),
      claim_token = null, lease_until = null
  where meeting_id = p_meeting_id and kind in ('analyze', 'summarize')
    and status in ('queued', 'running');

  -- Fresh generation only where a Claude run may serve the owner: seed meetings and
  -- operators. Anyone else's meeting is complete without AI output.
  if v_owner is null or exists (select 1 from public.operators o where o.user_id = v_owner) then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize');
  end if;

  return true;
end $$;

-- 3. Bot requests per user. A row per request, kept for a day, so deleting a meeting
--    does not give the day's allowance back (bot time is billed either way).
create table public.bot_requests (
  owner_id uuid not null references auth.users (id) on delete cascade,
  at       timestamptz not null default now()
);

create index bot_requests_owner_at_idx on public.bot_requests (owner_id, at desc);
create index bot_requests_at_idx on public.bot_requests (at desc);

alter table public.bot_requests enable row level security;
revoke all on public.bot_requests from anon, authenticated;
grant all on public.bot_requests to service_role;

create or replace function public.cap_bot_requests()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_recent integer;
begin
  if new.owner_id is null or new.source ->> 'kind' is distinct from 'bot' then
    return new;
  end if;
  delete from public.bot_requests
  where owner_id = new.owner_id and at < now() - interval '24 hours';
  select count(*) into v_recent from public.bot_requests where owner_id = new.owner_id;
  if v_recent >= 5 then
    raise exception 'at most 5 bot meetings a day per user' using errcode = 'P0003';
  end if;
  insert into public.bot_requests (owner_id) values (new.owner_id);
  return new;
end $$;

create trigger meetings_cap_bot_requests
  before insert on public.meetings
  for each row execute function public.cap_bot_requests();

-- 4. Search: a signed-in user's list shows only their own meetings, so their search does
--    too (p_own_only). Still security invoker: RLS decides what exists first.
drop function public.search_meetings(text, integer);
create or replace function public.search_meetings(
  p_query text, p_limit integer default 60, p_own_only boolean default false)
returns table (
  meeting_id   text,
  kind         text,
  ref_id       text,
  start_sec    numeric,
  speaker_code text,
  snippet      text,
  rank         real
)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_query, ''), 200)) as query
  ),
  hits as (
    select t.meeting_id, 'turn'::text as kind, t.id as ref_id, t.start_sec, t.speaker_code,
           ts_headline('english', t.text, q.query,
             'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=1') as snippet,
           ts_rank(t.tsv, q.query) as rank
    from public.transcript_turns t, q
    where t.tsv @@ q.query
    union all
    select i.meeting_id, i.kind, i.id::text,
           (select min(tt.start_sec)
              from public.item_citations c
              join public.transcript_turns tt on tt.meeting_id = c.meeting_id and tt.id = c.turn_id
             where c.item_id = i.id),
           null,
           ts_headline('english', i.text, q.query,
             'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=1'),
           -- what the AI concluded ranks a little above a passing mention
           ts_rank(i.tsv, q.query) * 1.5
    from public.meeting_items i, q
    where i.tsv @@ q.query
    union all
    select m.id, 'title', m.id, null, null,
           ts_headline('english', m.title, q.query, 'StartSel=⟦, StopSel=⟧, HighlightAll=true'),
           ts_rank(to_tsvector('english', m.title), q.query) * 2
    from public.meetings m, q
    where to_tsvector('english', m.title) @@ q.query
  )
  select h.meeting_id, h.kind, h.ref_id, h.start_sec, h.speaker_code, h.snippet, h.rank
  from hits h
  where not coalesce(p_own_only, false)
     or exists (select 1 from public.meetings m
                where m.id = h.meeting_id and m.owner_id = (select auth.uid()))
  order by h.rank desc, h.meeting_id, h.start_sec nulls first
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;

revoke execute on function public.search_meetings(text, integer, boolean) from public;
grant execute on function public.search_meetings(text, integer, boolean)
  to anon, authenticated, service_role;
