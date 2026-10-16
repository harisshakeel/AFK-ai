-- One "Share the notes" card waiting per meeting (audit F4; quality review 2026-10-17).
--
-- The route inserted a new email card on every click, so two clicks, a retried request
-- or two tabs gave two cards to everyone on the call, and approving both sent the notes
-- twice. The database now refuses a second card while one waits for approval; the
-- route answers with the waiting card instead. Once it is approved, sent or dismissed,
-- the notes can be shared again.

-- Cards the old route already doubled would stop the index being built (and every
-- migration after it): the newest waiting card per meeting stays, the rest are dismissed.
update public.meeting_commands c
set status = 'dismissed', finished_at = now()
where c.status = 'proposed' and (c.args ->> 'sharedNotes') = 'true'
  and exists (
    select 1 from public.meeting_commands newer
    where newer.meeting_id = c.meeting_id and newer.status = 'proposed'
      and (newer.args ->> 'sharedNotes') = 'true'
      and (newer.created_at, newer.id) > (c.created_at, c.id)
  );

create unique index meeting_commands_one_shared_notes
  on public.meeting_commands (meeting_id)
  where status = 'proposed' and (args ->> 'sharedNotes') = 'true';
