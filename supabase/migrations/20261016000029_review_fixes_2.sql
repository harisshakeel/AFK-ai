-- Fixes from the read-only review of the schema (second round):
--
--   1. The bot caps count per place as well as per identity: a guest identity is free
--      to make (Supabase allows thirty an hour per address), so five bots a day per
--      identity alone let one browser exhaust the deployment's daily allowance for
--      everyone. The bot route stores a keyed hash of the sender's address on the
--      meeting (never the address), the trigger copies it to bot_requests and caps it.
--   2. claim_job()'s lease-expiry sweep carries out the follow-ups complete_job() does on
--      a final failure: a detect_commands job that expires for good still queues the
--      notes, and an answer_in_meeting job that expires for good fails its command, so
--      a host is told rather than left waiting forever.
--   3. get_shared_clip() names only the speakers heard inside the clip.
--   4. access_requests writes count against the visitor limit through the trigger, like
--      every other table a visitor may write through the Data API.
--   5. Every count-then-insert cap takes an advisory lock on its own key, so concurrent
--      inserts at the boundary cannot all pass the count.
--   6. dismiss_command() refuses a command that already ran: its result stands.
--   7. memory_files: the Google-only rule on update and delete as on select and insert.
--   8. record_live_utterance() swallows only the command cap, not every check violation.
--   9. Indexes for the foreign keys that deletions walk and for the share-link policy.

-- 1. Bot caps per place.
alter table public.meetings
  add column sender_key text check (sender_key ~ '^[0-9a-f]{32}$');
alter table public.bot_requests add column client_key text;
create index bot_requests_client_key_at_idx on public.bot_requests (client_key, at desc);

create or replace function public.cap_bot_requests()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_recent integer;
  v_by_place integer;
  v_cap integer;
begin
  if new.owner_id is null or new.source ->> 'kind' is distinct from 'bot' then
    return new;
  end if;
  -- One lock for every bot request: the counts below are then exact.
  perform pg_advisory_xact_lock(hashtext('bot_requests'));
  delete from public.bot_requests where at < now() - interval '24 hours';
  select count(*) into v_recent from public.bot_requests where owner_id = new.owner_id;
  if v_recent >= 5 then
    raise exception 'at most 5 bot meetings a day per user' using errcode = 'P0003';
  end if;
  if new.sender_key is not null then
    select count(*) into v_by_place from public.bot_requests where client_key = new.sender_key;
    if v_by_place >= 5 then
      raise exception 'at most 5 bot meetings a day from one place' using errcode = 'P0003';
    end if;
  end if;
  select coalesce(value::integer, 20) into v_cap from public.app_settings where key = 'bot_daily_cap';
  if (select count(*) from public.bot_requests) >= coalesce(v_cap, 20) then
    raise exception 'the bot is fully booked for today' using errcode = 'P0004';
  end if;
  insert into public.bot_requests (owner_id, client_key) values (new.owner_id, new.sender_key);
  return new;
end $$;

-- 2. The expiry sweep's follow-ups.
create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800,
  p_meeting_id text default null)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
begin
  with expired as (
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        last_error = 'lease expired (the processor stopped mid-job)',
        claim_token = null, lease_until = null
    where status = 'running' and lease_until < now()
    returning meeting_id, kind, status, command_id
  ),
  failed_ingest as (
    update public.meetings m
    set status = 'failed',
        status_detail = 'The recording could not be processed after three attempts.'
    from expired e
    where e.meeting_id = m.id and e.kind = 'ingest_media' and e.status = 'failed'
      and m.status = 'transcribed'
    returning m.id
  ),
  -- A command parse that will not finish: the notes are still written (complete_job does
  -- the same on a final failure).
  failed_detect as (
    insert into public.processing_jobs (meeting_id, kind)
    select e.meeting_id, k.kind
    from expired e cross join (values ('analyze'), ('summarize')) as k(kind)
    where e.kind = 'detect_commands' and e.status = 'failed'
    on conflict do nothing
    returning id
  ),
  -- A live question nobody will answer: the host is told on the card.
  failed_answer as (
    update public.meeting_commands c
    set status = 'failed', finished_at = now(),
        error = 'The answer was cut off and not retried.'
    from expired e
    where e.command_id = c.id and e.kind = 'answer_in_meeting' and e.status = 'failed'
      and c.status = 'detected'
    returning c.id
  )
  update public.meeting_commands c
  set status = 'failed', finished_at = now(),
      error = 'The run stopped mid-way. Check the connected app before trying again.'
  from expired e
  where e.command_id = c.id and e.kind = 'run_command' and e.status = 'failed'
    and c.status = 'running';

  return query
  update public.processing_jobs j
  set status = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = now(), worker_id = p_worker_id
  where j.id = (
    select q.id
    from public.processing_jobs q
    where q.status = 'queued' and q.run_after <= now()
      and (p_kinds is null or q.kind = any (p_kinds))
    order by
      (p_meeting_id is not null and q.meeting_id = p_meeting_id) desc,
      (q.kind in ('answer_in_meeting', 'run_command')) desc,
      q.run_after, q.created_at
    limit 1
    for update skip locked
  )
  returning j.*;
end $$;

-- 3. Only the speakers heard in the clip.
create or replace function public.get_shared_clip(p_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'highlightId', h.id,
    'startSec', h.start_sec,
    'endSec', least(h.end_sec, m.duration_sec),
    'note', h.note,
    'meeting', jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'recordedAt', m.recorded_at,
      'durationSec', m.duration_sec,
      'isPublic', m.owner_id is null,
      'source', case when m.owner_id is null then m.source else null end
    ),
    'audioPath', case when m.owner_id is null then m.audio_path else null end,
    'speakers', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label) order by s.idx)
      from public.meeting_speakers s
      where s.meeting_id = m.id
        and exists (
          select 1 from public.transcript_turns t
          where t.meeting_id = m.id and t.speaker_code = s.code
            and t.start_sec < h.end_sec and t.end_sec > h.start_sec)
    ), '[]'::jsonb),
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'speaker', t.speaker_code, 'startSec', t.start_sec,
               'endSec', t.end_sec, 'text', t.text) order by t.start_sec, t.end_sec)
      from public.transcript_turns t
      where t.meeting_id = m.id and t.start_sec < h.end_sec and t.end_sec > h.start_sec
    ), '[]'::jsonb)
  )
  from public.share_links l
  join public.highlights h on h.id = l.highlight_id
  join public.meetings m on m.id = h.meeting_id
  where p_token ~ '^[0-9a-f]{64}$'
    and l.token = p_token
    and l.revoked_at is null
    and m.status = 'ready'
    -- the sharer must still be able to read the meeting
    and (m.owner_id is null or m.owner_id = h.owner_id);
$$;

-- 4. The visitor write limit on access requests too.
create trigger access_requests_visitor_write
  before insert on public.access_requests
  for each row execute function public.enforce_visitor_write();

-- 5. Caps under a lock on their own key.
create or replace function public.cap_highlights()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('highlights:' || new.owner_id::text));
  if (select count(*) from public.highlights where owner_id = new.owner_id) >= 300 then
    raise exception 'at most 300 highlights per visitor' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.cap_share_links()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('share_links:' || new.highlight_id::text));
  if (select count(*) from public.share_links where highlight_id = new.highlight_id) >= 50 then
    raise exception 'at most 50 links per highlight' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.cap_meeting_commands()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('meeting_commands:' || new.meeting_id));
  if new.status = 'skipped' then
    if (select count(*) from public.meeting_commands
        where meeting_id = new.meeting_id and status = 'skipped') >= 20 then
      raise exception 'at most 20 skipped commands a meeting' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (select count(*) from public.meeting_commands
      where meeting_id = new.meeting_id and source = new.source and status <> 'skipped') >= 20 then
    raise exception 'at most 20 % commands a meeting', new.source using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.note_read_hit(p_bucket text, p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('read_hits:' || p_bucket || ':' || p_key));
  delete from public.read_hits where at < now() - interval '1 minute';
  select count(*) into v_count
  from public.read_hits
  where bucket = p_bucket and key = p_key;
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.read_hits (bucket, key) values (p_bucket, p_key);
  return true;
end $$;

-- 6. What ran, stays.
create or replace function public.dismiss_command(p_command_id uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_item_id uuid;
  v_highlight_id uuid;
begin
  update public.meeting_commands
  set status = 'dismissed', finished_at = now()
  where id = p_command_id and status not in ('dismissed', 'running', 'done')
  returning item_id, highlight_id into v_item_id, v_highlight_id;
  if not found then
    return false;
  end if;
  delete from public.meeting_items where id = v_item_id;
  delete from public.highlights where id = v_highlight_id;
  update public.processing_jobs
  set status = 'failed', last_error = 'dismissed by the owner', finished_at = now(),
      claim_token = null, lease_until = null
  where command_id = p_command_id and status = 'queued';
  return true;
end $$;

-- 7. Memory is a Google account's, on every verb.
drop policy "you can change your own memory" on public.memory_files;
drop policy "you can erase your own memory" on public.memory_files;
create policy "you can change your own memory"
  on public.memory_files for update to authenticated
  using (owner_id = (select auth.uid())
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (owner_id = (select auth.uid())
              and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy "you can erase your own memory"
  on public.memory_files for delete to authenticated
  using (owner_id = (select auth.uid())
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

-- 8. Only the cap is swallowed.
create or replace function public.record_live_utterance(
  p_bot_id text, p_idempotency_key text, p_speaker_name text, p_speaker_uuid text,
  p_is_host boolean, p_timestamp_ms bigint, p_duration_ms integer, p_text text,
  p_command jsonb default null)
returns table (meeting_id text, seq bigint, duplicate boolean, command_id uuid)
language plpgsql set search_path = '' as $$
-- The output columns share names with table columns; inside SQL, the column wins.
#variable_conflict use_column
declare
  v_meeting text;
  v_seq bigint;
  v_command uuid;
begin
  select m.id into v_meeting from public.meetings m
  where m.bot_id = p_bot_id and m.status in ('requested', 'recording');
  if not found then
    return query select null::text, null::bigint, false, null::uuid;
    return;
  end if;

  insert into public.live_utterances
    (meeting_id, idempotency_key, speaker_name, speaker_uuid, is_host, timestamp_ms,
     duration_ms, text)
  values (v_meeting, left(p_idempotency_key, 100), left(p_speaker_name, 200),
          left(p_speaker_uuid, 200), coalesce(p_is_host, false), p_timestamp_ms,
          coalesce(p_duration_ms, 0), left(p_text, 2000))
  on conflict (meeting_id, idempotency_key) do nothing
  returning live_utterances.seq into v_seq;
  if v_seq is null then
    return query select v_meeting, null::bigint, true, null::uuid;
    return;
  end if;

  if p_command is not null and coalesce(p_is_host, false) then
    begin
      insert into public.meeting_commands
        (meeting_id, turn_id, source, kind, sentence, args, status, needs_approval, live_seq)
      values (v_meeting, null, 'live', p_command ->> 'kind', left(p_text, 1000),
              coalesce(p_command -> 'args', '{}'::jsonb), 'detected', false, v_seq)
      returning id into v_command;
      insert into public.processing_jobs (meeting_id, kind, command_id, max_attempts)
      values (v_meeting, 'answer_in_meeting', v_command, 2);
    exception when check_violation then
      -- Past the cap of live commands: the utterance is kept, the question is not
      -- answered. Any other violation (an unknown kind, oversized args) is a fault to see.
      if sqlerrm not like 'at most 20%' then
        raise;
      end if;
      v_command := null;
    end;
  end if;
  return query select v_meeting, v_seq, false, v_command;
end $$;

-- 9. Indexes for what deletions and policies walk.
create index share_links_owner_idx on public.share_links (owner_id);
create index highlights_command_idx on public.highlights (command_id) where command_id is not null;
create index meeting_items_command_idx on public.meeting_items (command_id) where command_id is not null;
create index meeting_commands_item_idx on public.meeting_commands (item_id) where item_id is not null;
create index meeting_commands_highlight_idx on public.meeting_commands (highlight_id) where highlight_id is not null;

-- 5b. The visitor write counter, under a lock on the identity.
create or replace function public.note_visitor_write()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('visitor_writes:' || v_uid::text));
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
