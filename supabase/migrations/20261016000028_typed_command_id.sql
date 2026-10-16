-- apply_typed_command() returns the row it made, not the newest typed row (from a
-- review): the model-backed kinds (/ask, /email, ...) are inserted by the route
-- directly, outside this function, and one committed a moment later would otherwise be
-- returned as the id of the /task or /decision just applied. The row this function
-- inserts carries this transaction's timestamp, which is what the filter asks for.

create or replace function public.apply_typed_command(p_meeting_id text, p_command jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.apply_commands(
    p_meeting_id,
    jsonb_build_object('commands', jsonb_build_array(p_command), 'queueGeneration', false));
  select id into v_id from public.meeting_commands
  where meeting_id = p_meeting_id and source = 'typed' and created_at = now()
  order by id limit 1;
  return v_id;
end $$;
