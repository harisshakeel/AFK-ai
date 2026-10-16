-- The live sender's tie rule (audit F2). After the call, two speakers who both match
-- the sender's names are a tie and nobody is the sender (sender.ts, findSender). During
-- the call the webhook saw only the speaker in front of it, so a "Haris" who joined
-- Haris Shakeel's call could command AFK. The webhook now asks for the names heard so
-- far and applies the same rule to them; a few distinct names per call, so one small
-- read for each line the sender addresses to AFK.

create function public.live_speaker_names(p_meeting_id text)
returns setof text
language sql
stable
set search_path = ''
as $$
  select distinct speaker_name
  from public.live_utterances
  where meeting_id = p_meeting_id and coalesce(speaker_name, '') <> ''
  limit 200
$$;

revoke execute on function public.live_speaker_names(text) from public, anon, authenticated;
grant execute on function public.live_speaker_names(text) to service_role;
