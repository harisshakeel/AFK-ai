-- append_memory_lines(): the user's zone ends where the marker begins. The first version
-- added a newline after it on every append after the first, so a file gained a blank
-- line each time AFK learned something. Caught by the database test when Phase A2
-- resumed; the function is otherwise the one in migration 12.
create or replace function public.append_memory_lines(
  p_owner_id uuid, p_path text, p_lines text[], p_template text default '')
returns void language plpgsql set search_path = '' as $$
declare
  v_content text;
  v_user_zone text;
  v_learned text[];
  v_marker constant text := E'\n---\n\n## Learned by AFK\n';
  v_pos integer;
  v_line text;
  v_result text;
begin
  if p_lines is null or array_length(p_lines, 1) is null then
    return;
  end if;
  select content into v_content from public.memory_files
  where owner_id = p_owner_id and path = p_path for update;
  if not found then
    v_content := coalesce(p_template, '');
    insert into public.memory_files (owner_id, path, content, updated_by)
    values (p_owner_id, p_path, v_content, 'afk');
  end if;

  if p_path like 'history/%' then
    v_user_zone := '';
    v_learned := array_remove(string_to_array(v_content, E'\n'), '');
  else
    v_pos := position(v_marker in v_content);
    if v_pos = 0 then
      v_user_zone := rtrim(v_content, E'\n') || E'\n';
      v_learned := array[]::text[];
    else
      -- The marker starts with its own newline: the zone ends exactly where it begins.
      v_user_zone := left(v_content, v_pos - 1);
      v_learned := array_remove(
        string_to_array(substring(v_content from v_pos + length(v_marker)), E'\n'), '');
    end if;
  end if;

  foreach v_line in array p_lines loop
    v_line := left(regexp_replace(v_line, E'[\\r\\n]+', ' ', 'g'), 500);
    if length(trim(v_line)) > 0 then
      v_learned := array_append(v_learned, trim(v_line));
    end if;
  end loop;

  loop
    v_result := case
      when p_path like 'history/%' then array_to_string(v_learned, E'\n') || E'\n'
      else v_user_zone || v_marker || E'\n' || array_to_string(v_learned, E'\n') || E'\n'
    end;
    exit when octet_length(v_result) <= 32768 or array_length(v_learned, 1) is null;
    v_learned := v_learned[2:array_length(v_learned, 1)];
  end loop;

  update public.memory_files
  set content = v_result, updated_by = 'afk', updated_at = now()
  where owner_id = p_owner_id and path = p_path;
end $$;

