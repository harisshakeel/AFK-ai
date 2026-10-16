-- Robustness (completion plan, batch 4).

-- 1. A bot whose webhook never arrives (review D3). Attendee bots leave on their own after
--    at most three hours, so a meeting still "requested" or "recording" six hours after it
--    was created is over, and its row would otherwise block the owner's next bot for good
--    (one active bot per owner). The daily keep-alive sweeps such rows to failed.
create or replace function public.sweep_stale_bots(
  p_older_than interval default interval '6 hours'
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with swept as (
    update public.meetings
    set status = 'failed',
        status_detail = 'AFK heard nothing more from the bot for six hours, so this meeting was closed. If the call was recorded, the recording never arrived.'
    where status in ('requested', 'recording')
      and created_at < now() - p_older_than
    returning id
  )
  select count(*) into v_count from swept;
  return v_count;
end $$;

revoke execute on function public.sweep_stale_bots(interval) from public, anon, authenticated;
grant execute on function public.sweep_stale_bots(interval) to service_role;

alter table public.cron_runs
  add column swept integer not null default 0 check (swept >= 0);

-- 2. Commands past the cap are listed, not only counted (requirement C2). The detector
--    records the next twenty as "skipped" with the reason; they count neither toward the
--    spoken cap nor as anything done, and the owner may dismiss them.
alter table public.meeting_commands drop constraint meeting_commands_status_check;
alter table public.meeting_commands add constraint meeting_commands_status_check
  check (status in ('detected', 'applied', 'proposed', 'unparsed', 'approved',
                    'running', 'done', 'failed', 'dismissed', 'skipped'));

create or replace function public.cap_meeting_commands()
returns trigger language plpgsql set search_path = '' as $$
begin
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
