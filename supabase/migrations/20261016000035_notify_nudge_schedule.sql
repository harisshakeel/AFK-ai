-- Three things for the flow (owner's call on the six suggestions):
--   1. notify_owner: a job queued when the notes are written (a trigger on
--      summarized_at) that emails the owner, through their own Gmail, that the meeting
--      is written up and what waits for them.
--   2. The wrap-up's nudge: a meeting whose cards have waited a day pops up again; Later
--      on that one is snoozed for a day (nudged_at), not for the visit.
--   3. Scheduled bots: AFK joins a calendar meeting at its time (status 'scheduled',
--      scheduled_for, the calendar event it came from), one per event per owner; a
--      scheduled bot does not block sending another, and one that never joins is swept
--      six hours after its time.

-- 1. The job kind, and the queueing after summarize.
alter table public.processing_jobs
  drop constraint processing_jobs_kind_check,
  add constraint processing_jobs_kind_check
    check (kind in ('ingest_media', 'detect_commands', 'analyze', 'summarize', 'learn',
                    'answer_in_meeting', 'run_command', 'notify_owner'));

-- The notes are written when summarized_at is set (complete_job); a trigger queues the
-- note, so complete_job() itself is untouched.
create function public.queue_owner_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.summarized_at is not null
     and (old.summarized_at is null or new.summarized_at <> old.summarized_at)
     and new.owner_id is not null
     and not public.is_guest(new.owner_id) then
    insert into public.processing_jobs (meeting_id, kind)
    values (new.id, 'notify_owner')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger meetings_owner_note
  after update of summarized_at on public.meetings
  for each row execute function public.queue_owner_note();

-- 2. The nudge.
alter table public.meetings add column nudged_at timestamptz;

create function public.snooze_wrap_up(p_meeting_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.meetings set nudged_at = now()
  where id = p_meeting_id and owner_id = auth.uid();
  return found;
end $$;

revoke execute on function public.snooze_wrap_up(text) from public, anon;
grant execute on function public.snooze_wrap_up(text) to authenticated, service_role;

-- 3. Scheduled bots.
alter table public.meetings
  drop constraint meetings_status_check,
  add constraint meetings_status_check
    check (status in ('scheduled', 'requested', 'recording', 'transcribed', 'ready', 'failed')),
  add column scheduled_for timestamptz,
  add column calendar_event_id text check (calendar_event_id ~ '^[A-Za-z0-9_@.-]{1,200}$');

create unique index meetings_one_bot_per_calendar_event
  on public.meetings (owner_id, calendar_event_id) where calendar_event_id is not null;

create index meetings_scheduled on public.meetings (scheduled_for) where status = 'scheduled';

-- A scheduled bot that never reported in: closed six hours after its time, so the day's
-- allowance and the owner's attention are not held by a call that never happened.
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
    where (status in ('requested', 'recording') and created_at < now() - p_older_than)
       or (status = 'scheduled' and coalesce(scheduled_for, created_at) < now() - p_older_than)
    returning id
  )
  select count(*) into v_count from swept;
  return v_count;
end $$;

-- A scheduled bot's call ends like any other's.
create or replace function public.mark_bot_finished(
  p_bot_id text, p_succeeded boolean, p_detail text default null)
returns text language plpgsql set search_path = '' as $$
declare
  v_meeting_id text;
begin
  update public.meetings
  set status = case when p_succeeded then 'transcribed' else 'failed' end,
      status_detail = left(p_detail, 500)
  where bot_id = p_bot_id and status in ('scheduled', 'requested', 'recording')
  returning id into v_meeting_id;
  if v_meeting_id is not null and p_succeeded then
    insert into public.processing_jobs (meeting_id, kind)
    values (v_meeting_id, 'ingest_media')
    on conflict do nothing;
  end if;
  return v_meeting_id;
end $$;
