-- Scale hardening, after the audit's L2 and L3 and the move of processing
-- into the web app's functions:
--
--   1. Indexes the hot paths were missing: the lease-expiry sweep in claim_job(), the
--      prune of finished jobs, ticks by owner (the dashboard record), the title branch of
--      search_meetings(), the exact sort of list_meetings(), and the age of live
--      utterances.
--   2. queue_status(): what the health route and the kick chain read. Counts and an age,
--      nothing else.
--   3. Pruning, run by the daily keep-alive and counted in cron_runs: finished jobs after
--      thirty days (their reports have served their purpose by then), live utterances
--      after a day (ingest_transcript() deletes them on the normal path; this catches
--      calls that never finished).

-- 1. Indexes.
create index processing_jobs_running_lease_idx
  on public.processing_jobs (lease_until) where status = 'running';
create index processing_jobs_finished_idx
  on public.processing_jobs (finished_at) where status in ('done', 'failed');
create index item_states_owner_idx on public.item_states (owner_id);
create index meetings_title_tsv_idx
  on public.meetings using gin (to_tsvector('english', title));
-- The order list_meetings() asks for, so a page is an index range, not a sort.
create index meetings_list_order_idx
  on public.meetings (owner_id, (coalesce(recorded_at, '-infinity'::timestamptz)) desc,
                      created_at desc, id desc);
create index live_utterances_received_idx on public.live_utterances (received_at);

-- 2. The queue, in numbers.
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
    count(*) filter (where status = 'queued' and run_after <= now()),
    count(*) filter (where status = 'queued' and run_after > now()),
    count(*) filter (where status = 'running'),
    count(*) filter (where status = 'failed' and finished_at > now() - interval '1 day'),
    coalesce(max(extract(epoch from now() - run_after))
               filter (where status = 'queued' and run_after <= now()), 0)
  from public.processing_jobs;
$$;
revoke execute on function public.queue_status() from public, anon, authenticated;
grant execute on function public.queue_status() to service_role;

-- 3. Pruning.
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

create or replace function public.prune_live_utterances(
  p_older_than interval default interval '1 day')
returns integer language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.live_utterances
    where received_at < now() - p_older_than
    returning seq
  )
  select count(*) into v_count from gone;
  return v_count;
end $$;

revoke execute on function public.prune_finished_jobs(interval) from public, anon, authenticated;
revoke execute on function public.prune_live_utterances(interval) from public, anon, authenticated;
grant execute on function public.prune_finished_jobs(interval) to service_role;
grant execute on function public.prune_live_utterances(interval) to service_role;

alter table public.cron_runs
  add column jobs_pruned integer not null default 0 check (jobs_pruned >= 0),
  add column utterances_pruned integer not null default 0 check (utterances_pruned >= 0);
