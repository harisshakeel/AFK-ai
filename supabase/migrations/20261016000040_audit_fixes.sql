-- Fixes from the audit (2026-10-16).

-- 1. The daily sweep no longer closes a scheduled bot's call in progress (audit F1).
--    A scheduled bot's row is made when it is scheduled, up to 90 days ahead, so timing
--    a "requested" or "recording" row from created_at failed it mid-call and its recording
--    was never ingested. Every bot row is now timed from when its call was due to start:
--    the scheduled time, or the request for a bot sent now. Attendee makes a bot leave
--    within five minutes of a waiting room and three hours of a call, so six hours after
--    that start no live call remains.
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
        status_detail = case
          when status = 'scheduled'
          then 'AFK was scheduled for this call but heard nothing from the bot for six hours after its time, so this meeting was closed.'
          else 'AFK heard nothing more from the bot for six hours, so this meeting was closed. If the call was recorded, the recording never arrived.'
        end
    where status in ('scheduled', 'requested', 'recording')
      and coalesce(scheduled_for, created_at) < now() - p_older_than
    returning id
  )
  select count(*) into v_count from swept;
  return v_count;
end $$;
