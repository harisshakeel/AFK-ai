-- A slow live answer gets one chat line, never two (audit F6).
--
-- Twenty seconds after a host's question, the webhook posts "I'll answer this after the
-- call" if the question is still unanswered. It used to check only the command's status,
-- which stays "detected" while the answer job runs, so an answer slower than twenty
-- seconds posted the fallback and then the answer. The fallback and the answer now take
-- the same row lock on the answer job: the fallback goes out only if the answer has not
-- started (the job is not running on a live lease and has not posted), and it stamps the
-- job's effect_at as it does, so start_job_effect() answers "done_before" and a late
-- answer lands on the card only. A run that was cut off (its lease has run out) no longer
-- counts as started, so its question still gets the fallback.
create function public.claim_live_fallback(p_command_id uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  if not exists (
    select 1 from public.meeting_commands
    where id = p_command_id and status = 'detected' and kind in ('ask', 'recap')
  ) then
    return false;
  end if;
  select * into v_job from public.processing_jobs
  where command_id = p_command_id and kind = 'answer_in_meeting'
  for update;
  if not found then
    -- No answer job to race with: the host is still waiting.
    return true;
  end if;
  if v_job.effect_at is not null
     or v_job.status in ('done', 'failed')
     or (v_job.status = 'running' and v_job.lease_until > now()) then
    return false;
  end if;
  update public.processing_jobs set effect_at = now() where id = v_job.id;
  return true;
end $$;

revoke execute on function public.claim_live_fallback(uuid) from public, anon, authenticated;
grant execute on function public.claim_live_fallback(uuid) to service_role;
