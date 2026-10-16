-- Each run of the daily keep-alive leaves a row (NFR Availability). Vercel shows a cron's
-- last run only in its dashboard and keeps Hobby runtime logs for an hour, so without a
-- trace nobody could tell from the project itself whether the keep-alive ever ran. The
-- route writes one row per run with what it did; the service role alone may touch it.
create table public.cron_runs (
  id       bigint generated always as identity primary key,
  job      text not null check (job in ('keepalive')),
  ran_at   timestamptz not null default now(),
  meetings integer not null check (meetings >= 0),
  pruned   integer not null check (pruned >= 0)
);

create index cron_runs_job_ran_at_idx on public.cron_runs (job, ran_at desc);

alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from anon, authenticated;
grant all on public.cron_runs to service_role;
