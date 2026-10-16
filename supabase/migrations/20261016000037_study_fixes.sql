-- Fixes from a read-only study of the system design:
--
--   1. complete_job() takes a fifth outcome, 'rejected': the database refused the job's
--      output (a broken check, a malformed payload, a raised exception), so running the
--      job again would pay Claude for the same refusal. It fails the job for good at
--      once, with the follow-ups job_failed_for_good() owns. 'failed' still retries with
--      backoff, for errors a retry can mend.
--   2. The one-active-bot rule is for bots sent now (a double click must not start two
--      paid bots). A bot scheduled from the calendar joins at its event's time whatever
--      else the owner has in a call; until now its move to 'recording' broke the rule,
--      the webhook answered 500 and the meeting stayed 'scheduled', so its live
--      utterances matched no meeting and were dropped.
--   3. start_job_effect(): the at-most-once gate for a job whose work leaves the system
--      without a command row to mark (the note to the owner through Gmail, a live
--      answer's line in the meeting chat). The handler asks right before the send: 'go'
--      once per job, 'done_before' to every later attempt (an earlier one reached the
--      send and then failed or was cut off before it finished), 'lost' when the claim
--      no longer holds (another run has the job). run_command keeps start_command().

-- 1. 'rejected'. The body is migration 30's but for the new branch.
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
  elsif p_outcome = 'rejected' then
    update public.processing_jobs
    set status = 'failed', finished_at = now(), claim_token = null, lease_until = null,
        last_error = left(p_error, 2000), report = p_report
    where id = p_job_id;
    perform public.job_failed_for_good(v_job.meeting_id, v_job.kind, v_job.command_id, p_error);
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

-- 2. Bots sent now only. A scheduled bot always has its time (server/bots.ts).
drop index public.meetings_one_active_bot_per_owner;
create unique index meetings_one_active_bot_per_owner
  on public.meetings (owner_id)
  where status in ('requested', 'recording') and scheduled_for is null;

-- 3. The gate. The column is the server's alone: the visitors' column grant on
--    processing_jobs (migration 2) does not name it.
alter table public.processing_jobs add column effect_at timestamptz;

create function public.start_job_effect(p_job_id uuid, p_claim_token uuid)
returns text language plpgsql set search_path = '' as $$
declare
  v_effect_at timestamptz;
begin
  select effect_at into v_effect_at from public.processing_jobs
  where id = p_job_id and claim_token = p_claim_token and status = 'running'
  for update;
  if not found then
    return 'lost';
  end if;
  if v_effect_at is not null then
    return 'done_before';
  end if;
  update public.processing_jobs set effect_at = now() where id = p_job_id;
  return 'go';
end $$;

revoke execute on function public.start_job_effect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_job_effect(uuid, uuid) to service_role;
