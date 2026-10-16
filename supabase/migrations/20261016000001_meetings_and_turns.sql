-- Meetings, their speakers and their transcripts (requirements F0, F1, F2, F3, F8, F9).
--
-- Access model:
--   * A meeting with owner_id = null is a public seed meeting. Anyone, signed in or not,
--     may read it once it is ready.
--   * A meeting with an owner belongs to an operator and is private to them.
--   * Nothing here is writable through the anon/authenticated roles. The seed import and
--     the worker write with the service role; operator routes use server-side RPCs.
--
-- Time: every *_sec column is seconds from the start of the recording, numeric(10,3).
-- duration_sec is the single timeline length: seeks, the speaker strip and clips are
-- clamped to it (docs/requirements.md F0, Sync).

create table public.meetings (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  owner_id        uuid references auth.users (id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  recorded_at     timestamptz,
  -- null until a transcript is ingested (a bot meeting before its call ends)
  duration_sec    numeric(10,3) check (duration_sec > 0),
  -- provenance and licence of the recording (see data/README.md)
  source          jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  -- object path inside the private "audio" bucket, e.g. "bmr007/v1.m4a"
  audio_path      text check (audio_path ~ '^[A-Za-z0-9/_.-]{3,200}$'),
  -- capture lifecycle only; AI generation state lives in processing_jobs
  status          text not null default 'requested'
                  check (status in ('requested', 'recording', 'transcribed', 'ready', 'failed')),
  status_detail   text check (length(status_detail) <= 500),
  -- the Attendee bot for an operator meeting; the webhook's lookup key
  bot_id          text unique check (bot_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  meeting_url     text check (length(meeting_url) <= 500),
  -- sha256 over the ingested speakers and turns; an equal hash makes re-import a no-op
  transcript_hash text check (transcript_hash ~ '^[0-9a-f]{64}$'),
  -- one-line AI summary for the meetings list; cleared when the transcript changes
  ai_headline     text check (length(ai_headline) between 1 and 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint meetings_ready_is_complete check (
    status <> 'ready'
    or (duration_sec is not null and audio_path is not null and transcript_hash is not null)
  )
);

create index meetings_owner_recorded_idx
  on public.meetings (owner_id, recorded_at desc nulls last);

-- One bot at a time per operator (a double click must not start two paid bots).
create unique index meetings_one_active_bot_per_owner
  on public.meetings (owner_id) where status in ('requested', 'recording');

-- Speakers are labels inside one meeting, never principals.
create table public.meeting_speakers (
  meeting_id text not null references public.meetings (id) on delete cascade,
  code       text not null check (length(code) between 1 and 80),
  label      text not null check (length(label) between 1 and 80),
  -- order of first appearance
  idx        integer not null check (idx >= 0),
  primary key (meeting_id, code),
  constraint meeting_speakers_meeting_idx_unique unique (meeting_id, idx)
);

-- Immutable once written: replaced only as a whole by ingest_transcript().
create table public.transcript_turns (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,99}$'),
  meeting_id   text not null references public.meetings (id) on delete cascade,
  idx          integer not null check (idx >= 0),
  speaker_code text not null,
  start_sec    numeric(10,3) not null check (start_sec >= 0),
  end_sec      numeric(10,3) not null,
  text         text not null check (length(text) between 1 and 20000),
  -- English full-text search over what was said (F3 find-in-meeting, F8 search)
  tsv          tsvector generated always as (to_tsvector('english', text)) stored,
  constraint transcript_turns_end_after_start check (end_sec >= start_sec),
  constraint transcript_turns_meeting_idx_unique unique (meeting_id, idx),
  -- target of composite foreign keys that must stay inside one meeting
  constraint transcript_turns_meeting_id_unique unique (meeting_id, id),
  constraint transcript_turns_speaker_fk foreign key (meeting_id, speaker_code)
    references public.meeting_speakers (meeting_id, code)
);

-- Playback sync and "what is under the playhead" lookups
create index transcript_turns_meeting_start_idx
  on public.transcript_turns (meeting_id, start_sec);
create index transcript_turns_tsv_idx on public.transcript_turns using gin (tsv);

-- Keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- The one readability rule. Used by every policy below and by the write checks on
-- tables that point at a meeting (highlights, ticks), so a foreign key can never be used
-- to attach something to a meeting the caller cannot see. security definer so it can
-- read meetings from inside other tables' policies; it only ever answers for auth.uid().
create or replace function public.can_read_meeting(p_meeting_id text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id
      and ((m.owner_id is null and m.status = 'ready') or m.owner_id = (select auth.uid()))
  );
$$;

revoke execute on function public.can_read_meeting(text) from public;
grant execute on function public.can_read_meeting(text) to anon, authenticated, service_role;

-- Row Level Security: read-only; seed meetings for everyone once ready, own meetings otherwise.
alter table public.meetings enable row level security;
alter table public.meeting_speakers enable row level security;
alter table public.transcript_turns enable row level security;

create policy "ready seed meetings and your own meetings are readable"
  on public.meetings for select to anon, authenticated
  using ((owner_id is null and status = 'ready') or owner_id = (select auth.uid()));

create policy "speakers follow their meeting"
  on public.meeting_speakers for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

create policy "turns follow their meeting"
  on public.transcript_turns for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

-- Explicit grants: read through the Data API, write only with the service role.
revoke all on public.meetings, public.meeting_speakers, public.transcript_turns
  from anon, authenticated;
grant select on public.meetings, public.meeting_speakers, public.transcript_turns
  to anon, authenticated;
grant all on public.meetings, public.meeting_speakers, public.transcript_turns
  to service_role;
