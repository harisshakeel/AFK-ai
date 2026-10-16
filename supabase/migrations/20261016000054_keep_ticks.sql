-- A new analysis keeps the ticks on the actions it words the same way. apply_analysis()
-- replaces a meeting's AI actions and decisions with new rows, and item_states cascades
-- from the item, so every visitor's ticks went with the old rows (plan, known gaps). The
-- ticks on the old AI actions are read first and put back on the new action with the same
-- text (case and outer spaces aside), with the time they were made. An action reworded,
-- or gone, loses its tick: it is no longer the same item.

create or replace function public.apply_analysis(p_meeting_id text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_ord bigint;
  v_kind text;
  v_id uuid;
  v_ticks jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'text', lower(btrim(i.text)), 'owner', s.owner_id, 'done', s.done,
           'at', s.updated_at)), '[]'::jsonb)
  into v_ticks
  from public.item_states s
  join public.meeting_items i on i.id = s.item_id
  where i.meeting_id = p_meeting_id and i.kind = 'action' and i.source = 'ai';

  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.meeting_items
  where meeting_id = p_meeting_id and kind in ('action', 'decision') and source = 'ai';

  insert into public.chapters (meeting_id, idx, title, first_turn_id)
  select p_meeting_id, (c.ord - 1)::int, c.value ->> 'title', c.value ->> 'firstTurnId'
  from jsonb_array_elements(coalesce(p_payload -> 'chapters', '[]'::jsonb)) with ordinality as c(value, ord);

  foreach v_kind in array array['action', 'decision'] loop
    for v_item, v_ord in
      select e.value, e.ord
      from jsonb_array_elements(coalesce(p_payload -> (v_kind || 's'), '[]'::jsonb)) with ordinality as e(value, ord)
    loop
      if jsonb_array_length(coalesce(v_item -> 'turnIds', '[]'::jsonb)) = 0 then
        raise exception '% % cites no turn', v_kind, v_ord using errcode = '23514';
      end if;
      insert into public.meeting_items
        (meeting_id, kind, idx, text, owner_speaker_code, owner_name, due_text)
      values (p_meeting_id, v_kind, (v_ord - 1)::int, v_item ->> 'text',
              v_item ->> 'ownerSpeaker', v_item ->> 'ownerName', v_item ->> 'dueText')
      returning id into v_id;
      insert into public.item_citations (item_id, meeting_id, turn_id)
      select distinct v_id, p_meeting_id, t.value
      from jsonb_array_elements_text(v_item -> 'turnIds') as t(value);
    end loop;
  end loop;

  -- Two old actions with one text give each visitor their latest tick on it.
  insert into public.item_states (item_id, owner_id, done, updated_at)
  select distinct on (i.id, (t ->> 'owner')::uuid)
         i.id, (t ->> 'owner')::uuid, (t ->> 'done')::boolean, (t ->> 'at')::timestamptz
  from jsonb_array_elements(v_ticks) as t
  join public.meeting_items i
    on i.meeting_id = p_meeting_id and i.kind = 'action' and i.source = 'ai'
   and lower(btrim(i.text)) = t ->> 'text'
  order by i.id, (t ->> 'owner')::uuid, (t ->> 'at')::timestamptz desc
  on conflict (item_id, owner_id) do nothing;

  update public.meetings set ai_headline = nullif(p_payload ->> 'headline', '')
  where id = p_meeting_id;
end $$;
