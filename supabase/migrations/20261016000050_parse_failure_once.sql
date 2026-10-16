-- A parse that fails for good no longer writes a meeting's notes twice, and the owner's
-- note goes out once per meeting (audit F5; quality review 2026-10-17).
--
-- job_failed_for_good() queued the analysis and the summaries again after any failed
-- parse, including one queued on a meeting whose notes were written (a typed draft, a
-- rewrite): the items were replaced (ticks lost), a second history line was written,
-- and summarized_at changed, which queued a second email to the owner. Now the notes are
-- queued only when there are none, the drafts that waited for the parse are marked not
-- understood instead of drafting for ever, and queue_owner_note() fires only the first
-- time a meeting's notes are written (a changed transcript clears the mark, so a real
-- re-write still tells the owner).

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
    -- The drafts that waited for this parse say so, rather than "Drafting…" for ever.
    update public.meeting_commands
    set status = 'unparsed',
        error = 'AFK couldn''t work out the details. Type it again with them.'
    where meeting_id = p_meeting_id and status = 'detected' and source <> 'live';
    -- The notes are still written, but only when they were not: a parse queued on a
    -- meeting with notes (a typed draft, a rewrite) must not write them a second time.
    if not exists (
      select 1 from public.meetings where id = p_meeting_id and summarized_at is not null
    ) then
      insert into public.processing_jobs (meeting_id, kind)
      values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize')
      on conflict do nothing;
    end if;
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

create or replace function public.queue_owner_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.summarized_at is not null
     and old.summarized_at is null
     and new.owner_id is not null
     and not public.is_guest(new.owner_id) then
    insert into public.processing_jobs (meeting_id, kind)
    values (new.id, 'notify_owner')
    on conflict do nothing;
  end if;
  return new;
end $$;
