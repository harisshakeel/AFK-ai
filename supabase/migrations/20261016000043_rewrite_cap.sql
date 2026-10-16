-- A draft can be rewritten at most three times, and every rewrite counts against the
-- visitor's write limit inside the database.
--
-- rewrite_command() is granted to every signed-in identity, guests included, and each
-- call queues a parse of the whole transcript: one Claude call. It never counted a
-- write, so calling it through the Data API skipped even the route's limit, and nothing
-- counted rewrites, so a loop of rewrite, wait for the draft, rewrite again spent the
-- owner's key without end. Three rewrites a card, with the twenty-typed cap for a card
-- typed again, bound what one meeting can cost.
--
-- A "Share the notes" card is not the model's draft: its body is the meeting's notes,
-- written in code. A rewrite sent it to the parser as "/email the notes to everyone",
-- which replaced the notes, the recipients and the sign-off with a new draft. It is
-- refused.

alter table public.meeting_commands
  add column rewrites smallint not null default 0 check (rewrites between 0 and 3);

comment on column public.meeting_commands.rewrites is
  'How many times the owner sent this draft back with a note; rewrite_command() refuses a fourth.';

create or replace function public.rewrite_command(p_command_id uuid, p_note text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_meeting text;
begin
  if not public.note_visitor_write() then
    raise exception 'too many changes; wait a minute' using errcode = 'P0005';
  end if;
  select c.meeting_id into v_meeting
  from public.meeting_commands c
  join public.meetings m on m.id = c.meeting_id
  where c.id = p_command_id
    and m.owner_id = auth.uid()
    and c.kind in ('email', 'followup', 'remind')
    and c.status in ('proposed', 'unparsed')
    and c.rewrites < 3
    and not coalesce(c.args ? 'sharedNotes', false)
  for update of c;
  if v_meeting is null then
    return false;
  end if;
  update public.meeting_commands
  set status = 'detected',
      args = coalesce(args, '{}'::jsonb) || jsonb_build_object('rewriteNote', left(trim(p_note), 300)),
      error = null,
      rewrites = rewrites + 1
  where id = p_command_id;
  insert into public.processing_jobs (meeting_id, kind)
  values (v_meeting, 'detect_commands')
  on conflict do nothing;
  return true;
end $$;
