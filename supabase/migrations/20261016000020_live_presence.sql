-- Live presence (requirements-v2 L1, L2; completion plan, batch 7). The bot's real-time
-- transcript webhook stores each utterance; a host's question ("AFK, what did we decide
-- about pricing?") or "AFK, recap…" becomes a live command and an answer_in_meeting job,
-- which the worker answers from the transcript so far and posts in the meeting chat.
-- Nothing live is readable by any user role; the utterances go when the final transcript
-- is ingested, or after a day.

-- 1. Live commands: a third source, two live kinds, and the utterance they came from.
alter table public.meeting_commands
  drop constraint meeting_commands_source_check,
  add constraint meeting_commands_source_check
    check (source in ('spoken', 'typed', 'live')),
  drop constraint meeting_commands_kind_check,
  add constraint meeting_commands_kind_check
    check (kind in ('task', 'decision', 'note', 'highlight', 'remember', 'email',
                    'followup', 'remind', 'slack', 'ask', 'recap', 'unknown')),
  add column live_seq bigint;

create unique index meeting_commands_one_per_live_utterance
  on public.meeting_commands (meeting_id, live_seq) where source = 'live';

-- 2. The job kind. It carries the command it answers, like run_command.
alter table public.processing_jobs
  drop constraint processing_jobs_kind_check,
  add constraint processing_jobs_kind_check
    check (kind in ('ingest_media', 'detect_commands', 'analyze', 'summarize', 'learn',
                    'run_command', 'answer_in_meeting')),
  add constraint processing_jobs_answer_has_command
    check (kind <> 'answer_in_meeting' or command_id is not null);

-- 3. What the bot hears, as it hears it.
create table public.live_utterances (
  meeting_id      text not null references public.meetings (id) on delete cascade,
  seq             bigint generated always as identity,
  idempotency_key text not null check (length(idempotency_key) between 1 and 100),
  speaker_name    text check (length(speaker_name) <= 200),
  speaker_uuid    text check (length(speaker_uuid) <= 200),
  is_host         boolean not null default false,
  timestamp_ms    bigint not null check (timestamp_ms >= 0),
  duration_ms     integer not null default 0 check (duration_ms >= 0),
  text            text not null check (length(text) between 1 and 2000),
  received_at     timestamptz not null default now(),
  primary key (meeting_id, seq),
  unique (meeting_id, idempotency_key)
);

alter table public.live_utterances enable row level security;
revoke all on public.live_utterances from anon, authenticated;
grant all on public.live_utterances to service_role;

-- 4. What the bot said back (or would have, had it still been in the call).
create table public.live_replies (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  text not null references public.meetings (id) on delete cascade,
  command_id  uuid not null references public.meeting_commands (id) on delete cascade,
  text        text not null check (length(text) between 1 and 2000),
  posted      boolean not null default false,
  spoken      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index live_replies_meeting_idx on public.live_replies (meeting_id, created_at);

alter table public.live_replies enable row level security;
revoke all on public.live_replies from anon, authenticated;
grant all on public.live_replies to service_role;

-- 5. The webhook's one write: the utterance, and when the route detected a host's live
--    command, the command row and its answer job in the same transaction. Idempotent on
--    Attendee's key. The row for a bot that is not in a call of ours is ignored.
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
      -- Past the cap of live commands: the utterance is kept, the question is not answered.
      v_command := null;
    end;
  end if;
  return query select v_meeting, v_seq, false, v_command;
end $$;

revoke execute on function public.record_live_utterance(text, text, text, text, boolean, bigint, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_live_utterance(text, text, text, text, boolean, bigint, integer, text, jsonb)
  to service_role;

-- 6. The answer, once the worker has it: a reply row and the command's result.
create or replace function public.finish_live_answer(p_command_id uuid, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_meeting text;
begin
  select c.meeting_id into v_meeting from public.meeting_commands c
  where c.id = p_command_id and c.status = 'detected' for update;
  if not found then
    return;
  end if;
  insert into public.live_replies (meeting_id, command_id, text, posted, spoken)
  values (v_meeting, p_command_id, left(coalesce(p_payload ->> 'text', ''), 2000),
          coalesce((p_payload ->> 'posted')::boolean, false),
          coalesce((p_payload ->> 'spoken')::boolean, false));
  update public.meeting_commands
  set status = 'done', result = p_payload, finished_at = now()
  where id = p_command_id;
end $$;

revoke execute on function public.finish_live_answer(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_live_answer(uuid, jsonb) to service_role;

-- 7. complete_job(): the answer lands on the command; a final failure tells the host.
create or replace function public.complete_job(
  p_job_id uuid, p_claim_token uuid, p_outcome text,
  p_payload jsonb default null, p_error text default null, p_report jsonb default null,
  p_retry_at timestamptz default null)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_job public.processing_jobs;
begin
  select * into v_job from public.processing_jobs
  where id = p_job_id and claim_token = p_claim_token and status = 'running'
  for update;
  if not found then
    return false;
  end if;

  if p_outcome = 'done' then
    if v_job.kind = 'analyze' then
      perform public.apply_analysis(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'summarize' then
      perform public.apply_summaries(v_job.meeting_id, p_payload);
      perform public.note_meeting_in_history(v_job.meeting_id);
      insert into public.processing_jobs (meeting_id, kind)
      select m.id, 'learn'
      from public.meetings m
      where m.id = v_job.meeting_id
        and m.owner_id is not null
        and exists (select 1 from public.operators o where o.user_id = m.owner_id)
      on conflict do nothing;
    elsif v_job.kind = 'detect_commands' then
      perform public.apply_commands(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'learn' then
      perform public.apply_learned(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'answer_in_meeting' then
      perform public.finish_live_answer(v_job.command_id, p_payload);
    elsif v_job.kind = 'run_command' then
      perform public.finish_command(v_job.command_id, p_payload);
    end if;
    update public.processing_jobs
    set status = 'done', finished_at = now(), claim_token = null, lease_until = null,
        last_error = null, report = p_report
    where id = p_job_id;
  elsif p_outcome = 'failed' then
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        run_after = now() + make_interval(secs => 60 * power(4, attempts - 1)::int),
        claim_token = null, lease_until = null,
        last_error = left(p_error, 2000), report = p_report
    where id = p_job_id;
    if v_job.kind = 'ingest_media' and v_job.attempts >= v_job.max_attempts then
      update public.meetings
      set status = 'failed', status_detail = 'Could not fetch the recording or transcript'
      where id = v_job.meeting_id and status = 'transcribed';
    end if;
    if v_job.kind = 'detect_commands' and v_job.attempts >= v_job.max_attempts then
      insert into public.processing_jobs (meeting_id, kind)
      values (v_job.meeting_id, 'analyze'), (v_job.meeting_id, 'summarize')
      on conflict do nothing;
    end if;
    if v_job.kind = 'answer_in_meeting' and v_job.attempts >= v_job.max_attempts then
      update public.meeting_commands
      set status = 'failed', error = left(p_error, 2000), finished_at = now()
      where id = v_job.command_id and status = 'detected';
    end if;
    if v_job.kind = 'run_command' then
      if v_job.attempts >= v_job.max_attempts then
        update public.meeting_commands
        set status = 'failed', error = left(p_error, 2000), finished_at = now()
        where id = v_job.command_id and status in ('running', 'approved');
      else
        update public.meeting_commands
        set status = 'approved', error = left(p_error, 2000)
        where id = v_job.command_id and status = 'running';
      end if;
    end if;
  elsif p_outcome = 'release' then
    update public.processing_jobs
    set status = 'queued', attempts = greatest(attempts - 1, 0),
        run_after = coalesce(p_retry_at, now() + interval '15 minutes'),
        claim_token = null, lease_until = null, last_error = left(p_error, 2000)
    where id = p_job_id;
    if v_job.kind = 'run_command' then
      update public.meeting_commands
      set status = 'approved', error = left(p_error, 2000)
      where id = v_job.command_id and status = 'running';
    end if;
  else
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  return true;
end $$;

-- 8. The final transcript replaces what was heard live.
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

  delete from public.meeting_commands where meeting_id = p_meeting_id;
  delete from public.meeting_items where meeting_id = p_meeting_id;
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.transcript_turns where meeting_id = p_meeting_id;
  delete from public.meeting_speakers where meeting_id = p_meeting_id;
  delete from public.live_utterances where meeting_id = p_meeting_id;

  insert into public.meeting_speakers (meeting_id, code, label, idx, is_host)
  select p_meeting_id, s.value ->> 'code', s.value ->> 'label', (s.ord - 1)::int,
         coalesce((s.value ->> 'isHost')::boolean, false)
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
  set transcript_hash = p_hash, duration_sec = p_duration_sec, ai_headline = null,
      host_speaker_code = null, host_detected_by = null
  where id = p_meeting_id;

  update public.processing_jobs
  set status = 'failed', last_error = 'superseded by a new transcript', finished_at = now(),
      claim_token = null, lease_until = null
  where meeting_id = p_meeting_id
    and kind in ('detect_commands', 'analyze', 'summarize', 'learn')
    and status in ('queued', 'running');

  if v_owner is null then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize');
  elsif exists (select 1 from public.operators o where o.user_id = v_owner) then
    insert into public.processing_jobs (meeting_id, kind) values (p_meeting_id, 'detect_commands');
  end if;

  return true;
end $$;
