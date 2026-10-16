-- Video recordings. The bot records the call as MP4 (Attendee: speaker
-- view, 720p) and the recording stays at Attendee: a Vercel function cannot hold an
-- hour of video, Supabase Free caps an object at 50 MB, and Attendee serves the file
-- through short-lived links that the page mints from the bot's id and renews. A meeting
-- therefore has one of two recordings: an audio object of its own (the seed meetings,
-- `audio_path`) or a video at the provider (`video_ref`). Never both.
--
--   1. meetings.video_ref, with the one-recording rule.
--   2. finish_ingest() takes either; the parameter list changes, so the old one is dropped.
--   3. purge_stale_guests() also returns the purged guests' bot ids, so the keep-alive
--      can ask Attendee to delete their recordings and transcripts.

-- 1.
alter table public.meetings
  add column video_ref text check (video_ref ~ '^[A-Za-z0-9_-]{4,80}$'),
  add constraint meetings_one_recording check (audio_path is null or video_ref is null);

comment on column public.meetings.video_ref is
  'The recording at the bot provider (the Attendee bot id); the page mints a short-lived link from it. Null for seed meetings, which have audio_path.';

-- 2.
drop function public.finish_ingest(text, text);

create function public.finish_ingest(
  p_meeting_id text, p_audio_path text default null, p_video_ref text default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.meetings
  set audio_path = p_audio_path, video_ref = p_video_ref, status = 'ready', status_detail = null
  where id = p_meeting_id and status = 'transcribed';
  return found;
end $$;

revoke execute on function public.finish_ingest(text, text, text) from public, anon, authenticated;
grant execute on function public.finish_ingest(text, text, text) to service_role;

-- 3.
drop function public.purge_stale_guests(interval);

create function public.purge_stale_guests(p_older_than interval default interval '30 days')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_users uuid[];
  v_paths text[];
  v_bots text[];
begin
  select coalesce(array_agg(u.id), '{}'::uuid[]) into v_users
  from auth.users u
  where u.is_anonymous
    and u.created_at < now() - p_older_than
    and not exists (
      select 1 from public.meetings m
      where m.owner_id = u.id and m.status in ('requested', 'recording'));
  select coalesce(array_agg(m.audio_path), '{}'::text[]) into v_paths
  from public.meetings m
  where m.owner_id = any (v_users) and m.audio_path is not null;
  -- Every bot of theirs, not only the ones with a video: Attendee holds the transcript
  -- and the recording of each, whatever its format.
  select coalesce(array_agg(m.bot_id order by m.bot_id), '{}'::text[]) into v_bots
  from public.meetings m
  where m.owner_id = any (v_users) and m.bot_id is not null;
  delete from auth.users u where u.id = any (v_users);
  return jsonb_build_object(
    'users', coalesce(array_length(v_users, 1), 0),
    'audio_paths', to_jsonb(v_paths),
    'bot_ids', to_jsonb(v_bots));
end $$;

revoke execute on function public.purge_stale_guests(interval) from public, anon, authenticated;
grant execute on function public.purge_stale_guests(interval) to service_role;
