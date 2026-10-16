-- history/meetings.md counts the action items still open for the owner (requirement M4),
-- not every action item: a tick by the owner closes one.
create or replace function public.note_meeting_in_history(p_meeting_id text)
returns void language plpgsql set search_path = '' as $$
declare
  v_owner uuid;
  v_line text;
begin
  select m.owner_id into v_owner from public.meetings m where m.id = p_meeting_id;
  if v_owner is null then
    return;
  end if;
  select '- [' || coalesce(to_char(m.recorded_at, 'YYYY-MM-DD'), 'undated') || '] '
         || m.title
         || coalesce(': ' || m.ai_headline, '')
         || ' (' || (select count(*) from public.meeting_items i
                     where i.meeting_id = m.id and i.kind = 'action'
                       and not exists (select 1 from public.item_states s
                                       where s.item_id = i.id and s.owner_id = m.owner_id
                                         and s.done))
         || ' open action items)'
  into v_line
  from public.meetings m where m.id = p_meeting_id;
  perform public.append_memory_lines(v_owner, 'history/meetings.md', array[v_line]);
end $$;
