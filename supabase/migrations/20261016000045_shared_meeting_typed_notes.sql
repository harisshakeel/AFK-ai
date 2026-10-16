-- A meeting's address shows only the notes said on the call, never the ones the owner
-- typed (security review, 2026-10-17).
--
-- get_shared_meeting() returned every meeting_items row of kind 'note', and a typed
-- /note makes the same row as a spoken one. The PIN page promises that the host's notes
-- stay with the host, and "Share the notes" sends the code and PIN to everyone on the
-- call, so a line typed after the call ("Sam is on a PIP") reached them as "Notes from
-- the call". The function is unchanged but for that filter; its grants stand.

create or replace function public.get_shared_meeting(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'meeting', jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'recordedAt', m.recorded_at,
      'durationSec', m.duration_sec,
      'headline', m.ai_headline,
      'audioPath', m.audio_path,
      'videoRef', m.video_ref
    ),
    'speakers', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label) order by s.idx)
      from public.meeting_speakers s where s.meeting_id = m.id
    ), '[]'::jsonb),
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'speaker', t.speaker_code, 'startSec', t.start_sec,
               'endSec', t.end_sec, 'text', t.text) order by t.idx)
      from public.transcript_turns t where t.meeting_id = m.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'kind', i.kind, 'templateKey', i.template_key,
               'sectionIdx', i.section_idx, 'section', i.section, 'idx', i.idx,
               'text', i.text,
               'turnIds', coalesce((
                 select jsonb_agg(c.turn_id order by t2.idx)
                 from public.item_citations c
                 join public.transcript_turns t2 on t2.id = c.turn_id
                 where c.item_id = i.id), '[]'::jsonb))
             order by i.template_key, i.section_idx, i.idx)
      from public.meeting_items i
      where i.meeting_id = m.id and i.kind in ('point', 'note')
        -- A note the owner typed is theirs; only notes said on the call are shared.
        and not exists (
          select 1 from public.meeting_commands c
          where c.id = i.command_id and c.source = 'typed')
    ), '[]'::jsonb)
  )
  from public.meeting_links l
  join public.meetings m on m.id = l.meeting_id
  where p_code ~ '^[a-z0-9]{12}$'
    and l.code = p_code
    and l.enabled
    and m.status = 'ready';
$$;
