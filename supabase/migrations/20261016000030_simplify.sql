-- Simplification round, after four read-only reviews of the day's work:
--
--   1. One place owns "a job failed for good": job_failed_for_good(). claim_job()'s
--      lease-expiry sweep and complete_job()'s failed branch both call it, so the
--      follow-ups (a failed ingest fails the meeting, a failed parse still queues the
--      notes, a failed answer or run fails its command) can never drift apart again.
--   2. complete_job() takes a fourth outcome, 'skipped': the claim is over and there is
--      nothing to apply. skip_job(), which copied the done branch, goes.
--   3. A meeting records when its notes were written (analyzed_at, summarized_at). The
--      command parser queues generation while neither is set; prune_finished_jobs() no
--      longer has to keep job rows as that record, and a changed transcript clears the
--      marks (a trigger), so the notes are written again.
--   4. apply_typed_command() inserts its row itself and has apply_commands() fill it in
--      by id, the path that function already has, instead of finding the row afterwards.
--   5. is_google_user(): the "not an anonymous identity" test as one function, used by
--      memory_files on every verb; the mirror of is_guest() for the user roles.
--   6. queue_status() as scalar counts that each use a partial index, not one pass over
--      the whole table on every health hit.

-- 1. The follow-ups, once.
create or replace function public.job_failed_for_good(
  p_meeting_id text, p_kind text, p_command_id uuid, p_error text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_kind = 'ingest_media' then
    update public.meetings
    set status = 'failed',
        status_detail = 'The recording could not be processed after three attempts.'
    where id = p_meeting_id and status = 'transcribed';
  elsif p_kind = 'detect_commands' then
    -- The notes are still written; what the host said with commands is lost and said so.
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize')
    on conflict do nothing;
  elsif p_kind = 'answer_in_meeting' then
    update public.meeting_commands
    set status = 'failed', error = left(p_error, 2000), finished_at = now()
    where id = p_command_id and status = 'detected';
  elsif p_kind = 'run_command' then
    update public.meeting_commands
    set status = 'failed', error = left(p_error, 2000), finished_at = now()
    where id = p_command_id and status in ('running', 'approved');
  end if;
end $$;
revoke execute on function public.job_failed_for_good(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.job_failed_for_good(text, text, uuid, text) to service_role;

create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800,
  p_meeting_id text default null)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
declare
  v_expired record;
begin
  for v_expired in
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        last_error = 'lease expired (the processor stopped mid-job)',
        claim_token = null, lease_until = null
    where status = 'running' and lease_until < now()
    returning meeting_id, kind, status, command_id
  loop
    if v_expired.status = 'failed' then
      perform public.job_failed_for_good(
        v_expired.meeting_id, v_expired.kind, v_expired.command_id,
        case v_expired.kind
          when 'run_command' then 'The run stopped mid-way. Check the connected app before trying again.'
          else 'The run was cut off and not retried.'
        end);
    end if;
  end loop;

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

-- 3. The marks, before complete_job() starts setting them.
alter table public.meetings
  add column analyzed_at timestamptz,
  add column summarized_at timestamptz;
update public.meetings m
set analyzed_at = j.finished_at
from public.processing_jobs j
where j.meeting_id = m.id and j.kind = 'analyze' and j.status = 'done';
update public.meetings m
set summarized_at = j.finished_at
from public.processing_jobs j
where j.meeting_id = m.id and j.kind = 'summarize' and j.status = 'done';

create or replace function public.clear_generation_marks()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.transcript_hash is distinct from old.transcript_hash then
    new.analyzed_at := null;
    new.summarized_at := null;
  end if;
  return new;
end $$;
create trigger meetings_clear_generation_marks
  before update of transcript_hash on public.meetings
  for each row execute function public.clear_generation_marks();

-- 2. complete_job(): 'skipped', the marks, and the follow-ups through one function.
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

  if p_outcome in ('done', 'skipped') then
    if p_outcome = 'done' then
      if v_job.kind = 'analyze' then
        perform public.apply_analysis(v_job.meeting_id, p_payload);
        update public.meetings set analyzed_at = now() where id = v_job.meeting_id;
      elsif v_job.kind = 'summarize' then
        perform public.apply_summaries(v_job.meeting_id, p_payload);
        perform public.note_meeting_in_history(v_job.meeting_id);
        update public.meetings set summarized_at = now() where id = v_job.meeting_id;
        -- The chain's last link (M3): learned lines, for meetings owned by a Google user.
        insert into public.processing_jobs (meeting_id, kind)
        select m.id, 'learn' from public.meetings m
        where m.id = v_job.meeting_id and m.owner_id is not null
          and not public.is_guest(m.owner_id)
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
    if v_job.attempts >= v_job.max_attempts then
      perform public.job_failed_for_good(v_job.meeting_id, v_job.kind, v_job.command_id, p_error);
    elsif v_job.kind = 'run_command' then
      update public.meeting_commands
      set status = 'approved', error = left(p_error, 2000)
      where id = v_job.command_id and status = 'running';
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

drop function public.skip_job(uuid, uuid, jsonb);

-- The seed import's exported output counts as generated too.
create or replace function public.import_generated(
  p_meeting_id text, p_transcript_hash text, p_kind text, p_payload jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meetings where id = p_meeting_id and transcript_hash = p_transcript_hash
  ) then
    return false;
  end if;
  if p_kind = 'analyze' then
    perform public.apply_analysis(p_meeting_id, p_payload);
    update public.meetings set analyzed_at = now() where id = p_meeting_id;
  elsif p_kind = 'summarize' then
    perform public.apply_summaries(p_meeting_id, p_payload);
    update public.meetings set summarized_at = now() where id = p_meeting_id;
  else
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;
  update public.processing_jobs
  set status = 'done', finished_at = now(), last_error = null,
      report = jsonb_build_object('source', 'data/ai export')
  where meeting_id = p_meeting_id and kind = p_kind and status = 'queued';
  return true;
end $$;

create or replace function public.prune_finished_jobs(
  p_older_than interval default interval '30 days')
returns integer language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.processing_jobs
    where status in ('done', 'failed') and finished_at < now() - p_older_than
    returning id
  )
  select count(*) into v_count from gone;
  return v_count;
end $$;

-- 4. The typed command's row, made here and filled in by id.
create or replace function public.apply_typed_command(p_meeting_id text, p_command jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_kind text := p_command ->> 'kind';
begin
  insert into public.meeting_commands
    (meeting_id, turn_id, source, kind, sentence, status, needs_approval)
  values (p_meeting_id, p_command ->> 'turnId', 'typed', v_kind,
          left(p_command ->> 'sentence', 1000), 'detected',
          v_kind in ('email', 'followup', 'remind', 'slack'))
  returning id into v_id;
  perform public.apply_commands(
    p_meeting_id,
    jsonb_build_object(
      'commands', jsonb_build_array(p_command || jsonb_build_object('id', v_id)),
      'queueGeneration', false));
  return v_id;
end $$;

-- 5. One test for a Google account.
create or replace function public.is_google_user()
returns boolean language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false;
$$;
revoke execute on function public.is_google_user() from public;
grant execute on function public.is_google_user() to anon, authenticated, service_role;

drop policy "your memory is yours to read" on public.memory_files;
drop policy "you can write your own memory" on public.memory_files;
drop policy "you can change your own memory" on public.memory_files;
drop policy "you can erase your own memory" on public.memory_files;
create policy "your memory is yours to read"
  on public.memory_files for select to authenticated
  using (owner_id = (select auth.uid()) and public.is_google_user());
create policy "you can write your own memory"
  on public.memory_files for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_google_user());
create policy "you can change your own memory"
  on public.memory_files for update to authenticated
  using (owner_id = (select auth.uid()) and public.is_google_user())
  with check (owner_id = (select auth.uid()) and public.is_google_user());
create policy "you can erase your own memory"
  on public.memory_files for delete to authenticated
  using (owner_id = (select auth.uid()) and public.is_google_user());

-- 6. Counts that each hit their index.
create or replace function public.queue_status()
returns table (
  runnable bigint,
  scheduled bigint,
  running bigint,
  failed_day bigint,
  oldest_runnable_sec numeric
)
language sql stable set search_path = '' as $$
  select
    (select count(*) from public.processing_jobs
      where status = 'queued' and run_after <= now()),
    (select count(*) from public.processing_jobs
      where status = 'queued' and run_after > now()),
    (select count(*) from public.processing_jobs where status = 'running'),
    (select count(*) from public.processing_jobs
      where status = 'failed' and finished_at > now() - interval '1 day'),
    coalesce((select extract(epoch from now() - min(run_after)) from public.processing_jobs
               where status = 'queued' and run_after <= now()), 0);
$$;
