-- Fixes from the review (the guest-mode, API-processing and hardening commits):
--
--   1. prune_finished_jobs() keeps the analyze and summarize rows. The command parser
--      decides whether a meeting's notes are generated for the first time by asking
--      whether an analyze or summarize job has ever existed for it; pruning those rows
--      would make a typed /email on an old meeting rewrite its notes and append a second
--      history line. Two rows per meeting is a price worth paying for that record.
--   2. purge_stale_guests() leaves a guest alone while their bot is in a call (the row
--      the webhook reports to must exist until the call ends), and returns the audio
--      paths of the meetings it removed, so the keep-alive deletes the objects after the
--      rows are gone: a failed removal is then a storage leak to log, never a "ready"
--      meeting pointing at a file that no longer exists. stale_guest_audio() goes.
--   3. skip_job(): a handler that found nothing to do (the meeting changed meanwhile)
--      ends its job as done without applying anything, instead of leaving it running
--      until the lease expires and an attempt is spent on a retry that would find the
--      same nothing.

create or replace function public.prune_finished_jobs(
  p_older_than interval default interval '30 days')
returns integer language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.processing_jobs
    where status in ('done', 'failed')
      and finished_at < now() - p_older_than
      -- the record of a meeting's first generation (see detect-commands.ts)
      and kind not in ('analyze', 'summarize')
    returning id
  )
  select count(*) into v_count from gone;
  return v_count;
end $$;

drop function public.stale_guest_audio(interval);
-- The return type changes, which create or replace cannot do.
drop function public.purge_stale_guests(interval);

create function public.purge_stale_guests(p_older_than interval default interval '30 days')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_users uuid[];
  v_paths text[];
begin
  select coalesce(array_agg(u.id), '{}'::uuid[]) into v_users
  from auth.users u
  where u.is_anonymous
    and u.created_at < now() - p_older_than
    and not exists (
      select 1 from public.meetings m
      where m.owner_id = u.id and m.status in ('requested', 'recording'));
  select coalesce(array_agg(m.audio_path), '{}'::text[]) into v_paths
  from public.meetings m
  where m.owner_id = any (v_users) and m.audio_path is not null;
  delete from auth.users u where u.id = any (v_users);
  return jsonb_build_object(
    'users', coalesce(array_length(v_users, 1), 0),
    'audio_paths', to_jsonb(v_paths));
end $$;

revoke execute on function public.purge_stale_guests(interval) from public, anon, authenticated;
grant execute on function public.purge_stale_guests(interval) to service_role;

create or replace function public.skip_job(
  p_job_id uuid, p_claim_token uuid, p_report jsonb default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.processing_jobs
  set status = 'done', finished_at = now(), claim_token = null, lease_until = null,
      last_error = null, report = p_report
  where id = p_job_id and claim_token = p_claim_token and status = 'running';
  return found;
end $$;

revoke execute on function public.skip_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.skip_job(uuid, uuid, jsonb) to service_role;
