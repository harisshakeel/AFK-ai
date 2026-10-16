-- Memory saves never overwrite AFK's lines unseen, and the history files are AFK's
-- (audit F13 and D8; quality review 2026-10-17).
--
-- F13: save_memory_file() took "no expected version" as "overwrite whatever is there".
-- The editor sends no version for a file it opened from the template, so a save after
-- AFK created the row meanwhile (a learned line) replaced it without a conflict. Now no
-- version means "create": an existing row, or one created at the same moment, answers
-- P0006 and the editor asks for a reload.
-- D8: history/*.md are AFK's record of what it did and of past meetings. The route
-- refused them, but the function and the Data API did not; now both do. A user can still
-- delete them ("Forget everything").

create or replace function public.save_memory_file(
  p_path text,
  p_content text,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_path like 'history/%' then
    raise exception 'the history files are written by AFK' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null then
    update public.memory_files
      set content = p_content
      where owner_id = v_uid and path = p_path and updated_at = p_expected_updated_at
      returning updated_at into v_updated_at;
    if found then
      return v_updated_at;
    end if;
    -- Gone or newer than the editor's copy: refuse, lose nothing.
    raise exception 'this file changed meanwhile' using errcode = 'P0006';
  end if;

  -- No version: the editor believes there is no file yet.
  begin
    insert into public.memory_files (owner_id, path, content)
      values (v_uid, p_path, p_content)
      returning updated_at into v_updated_at;
  exception when unique_violation then
    raise exception 'this file changed meanwhile' using errcode = 'P0006';
  end;
  return v_updated_at;
end $$;

drop policy "you can write your own memory" on public.memory_files;
drop policy "you can change your own memory" on public.memory_files;
create policy "you can write your own memory"
  on public.memory_files for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_google_user()
              and path not like 'history/%');
create policy "you can change your own memory"
  on public.memory_files for update to authenticated
  using (owner_id = (select auth.uid()) and public.is_google_user()
         and path not like 'history/%')
  with check (owner_id = (select auth.uid()) and public.is_google_user()
              and path not like 'history/%');
