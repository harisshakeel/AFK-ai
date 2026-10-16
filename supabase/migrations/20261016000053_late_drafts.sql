-- A draft typed, or a card sent back for a rewrite, while a parse is running is parsed
-- after it (audit F8). Only one parse is queued or running per meeting
-- (processing_jobs_one_active), so the route's and rewrite_command()'s insert of a
-- second one is a no-op while one runs; a running parse read its waiting rows when it
-- started and never saw the new one, which then sat on "Drafting…" until some later
-- event queued a parse. When a parse finishes, a waiting row changed after it started
-- queues one more. A row the finished parse saw and left waiting is older than its start,
-- so this cannot loop.

create function public.requeue_late_drafts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.meeting_commands c
    where c.meeting_id = new.meeting_id
      and c.status = 'detected'
      and c.source in ('spoken', 'typed')
      and c.updated_at > new.started_at
  ) then
    insert into public.processing_jobs (meeting_id, kind)
    values (new.meeting_id, 'detect_commands')
    on conflict do nothing;
  end if;
  return null;
end $$;

create trigger processing_jobs_requeue_late_drafts
  after update of status on public.processing_jobs
  for each row
  when (new.kind = 'detect_commands' and old.status = 'running' and new.status = 'done')
  execute function public.requeue_late_drafts();
