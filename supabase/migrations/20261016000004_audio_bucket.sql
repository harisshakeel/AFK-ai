-- The private "audio" bucket (requirements F2, F7; NFR Privacy).
--
-- No storage.objects policies on purpose: nobody reads or writes objects through the
-- Data API. The server signs short-lived URLs only after an RLS read of the meeting (or a
-- valid share token for a seed meeting), and the import and worker upload with the
-- service role. Objects live under '<meeting_id>/'. 50 MB per object (Supabase Free cap);
-- an hour at 64 kbps AAC is about 16 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800, array['audio/mp4', 'audio/x-m4a', 'audio/mpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
