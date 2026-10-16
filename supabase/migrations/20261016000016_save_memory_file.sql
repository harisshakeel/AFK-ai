-- The memory save as one statement (requirement M6, NFR Concurrency). The route used to
-- read updated_at, compare it and then write, so a line AFK appended between the read
-- and the write could be overwritten. Now the editor's stamp travels into one UPDATE
-- whose WHERE clause carries the check: a row that moved on since the editor loaded it
-- is left alone and the save is refused with P0006, and the editor asks for a reload.
--
-- Runs as the caller, not as definer: RLS and the column grants apply exactly as they
-- do to the Data API, and the memory_files_user_write trigger stamps who and when and
-- counts the write against the visitor's limit.
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

  update public.memory_files
    set content = p_content
    where owner_id = v_uid
      and path = p_path
      and (p_expected_updated_at is null or updated_at = p_expected_updated_at)
    returning updated_at into v_updated_at;
  if found then
    return v_updated_at;
  end if;

  -- The row exists but is newer than the editor's copy: refuse, lose nothing.
  if exists (select 1 from public.memory_files where owner_id = v_uid and path = p_path) then
    raise exception 'this file changed meanwhile' using errcode = 'P0006';
  end if;

  insert into public.memory_files (owner_id, path, content)
    values (v_uid, p_path, p_content)
    returning updated_at into v_updated_at;
  return v_updated_at;
end $$;

revoke execute on function public.save_memory_file(text, text, timestamptz) from public, anon;
grant execute on function public.save_memory_file(text, text, timestamptz)
  to authenticated, service_role;
