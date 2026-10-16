-- Highlights and clips, share links, and per-person ticks on action items
-- (requirements F5, F6, F7; NFRs Visitor boundary, Persistence).
--
-- Every visitor has a Supabase identity (anonymous or signed in), so all three tables
-- are owned by auth.uid(). The write checks call can_read_meeting(), so a foreign key can
-- never be used to attach a highlight or a tick to a meeting the caller cannot read.

-- A highlight is a clip: the half-open range [start_sec, end_sec) of one meeting.
-- Routes clamp end_sec to the meeting's duration_sec before writing.
create table public.highlights (
  id         uuid primary key default gen_random_uuid(),
  meeting_id text not null references public.meetings (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_sec  numeric(10,3) not null check (start_sec >= 0),
  end_sec    numeric(10,3) not null,
  note       text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlights_end_after_start check (end_sec > start_sec),
  constraint highlights_max_length check (end_sec - start_sec <= 600)
);

create index highlights_owner_meeting_idx on public.highlights (owner_id, meeting_id);

create trigger highlights_set_updated_at
  before update on public.highlights
  for each row execute function public.set_updated_at();

alter table public.highlights enable row level security;

create policy "your highlights are yours to read"
  on public.highlights for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "you can highlight meetings you can read"
  on public.highlights for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_read_meeting(meeting_id));

create policy "you can adjust your highlights"
  on public.highlights for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.can_read_meeting(meeting_id));

create policy "you can delete your highlights"
  on public.highlights for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.highlights from anon, authenticated;
grant select, delete on public.highlights to authenticated;
grant insert (meeting_id, start_sec, end_sec, note) on public.highlights to authenticated;
-- moving a highlight to another meeting or owner is not a thing
grant update (start_sec, end_sec, note) on public.highlights to authenticated;
grant all on public.highlights to service_role;

-- A share link exposes one highlight and nothing else of the meeting. The token is
-- generated on the server (32 random bytes, hex). Revoking keeps the row for the owner.
create table public.share_links (
  token        text primary key check (token ~ '^[0-9a-f]{64}$'),
  highlight_id uuid not null references public.highlights (id) on delete cascade,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- One live link per highlight: "Share" again returns the same link.
create unique index share_links_one_live_per_highlight
  on public.share_links (highlight_id) where revoked_at is null;

alter table public.share_links enable row level security;

create policy "your share links are yours to read"
  on public.share_links for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "you can share your own highlights"
  on public.share_links for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.highlights h
      where h.id = highlight_id and h.owner_id = (select auth.uid())
    )
  );

create policy "you can revoke your share links"
  on public.share_links for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.share_links from anon, authenticated;
grant select on public.share_links to authenticated;
grant insert (token, highlight_id) on public.share_links to authenticated;
grant update (revoked_at) on public.share_links to authenticated;
grant all on public.share_links to service_role;

-- Ticks on action items. Generated items are shared and read-only; each person's ticks
-- are their own rows, so two visitors never see each other's ticks.
create table public.item_states (
  item_id    uuid not null references public.meeting_items (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (item_id, owner_id)
);

create trigger item_states_set_updated_at
  before update on public.item_states
  for each row execute function public.set_updated_at();

-- Only action items can be ticked, and only on a meeting the caller can read.
create or replace function public.can_tick_item(p_item_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meeting_items i
    where i.id = p_item_id and i.kind = 'action' and public.can_read_meeting(i.meeting_id)
  );
$$;

revoke execute on function public.can_tick_item(uuid) from public;
grant execute on function public.can_tick_item(uuid) to authenticated, service_role;

alter table public.item_states enable row level security;

create policy "your ticks are yours to read"
  on public.item_states for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "you can tick action items you can read"
  on public.item_states for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_tick_item(item_id));

create policy "you can change your ticks"
  on public.item_states for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.can_tick_item(item_id));

create policy "you can clear your ticks"
  on public.item_states for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.item_states from anon, authenticated;
grant select, delete on public.item_states to authenticated;
grant insert (item_id, done) on public.item_states to authenticated;
grant update (done) on public.item_states to authenticated;
grant all on public.item_states to service_role;

-- The share page's only read. Callable by anyone holding a token; returns nothing for an
-- unknown or revoked token, and never more than the clip: its range, the meeting's title
-- and length, the speakers, and the turns that overlap the clip (shown whole). audio_path
-- is returned only for public seed meetings; a private meeting's share is transcript-only.
create or replace function public.get_shared_clip(p_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'highlightId', h.id,
    'startSec', h.start_sec,
    'endSec', least(h.end_sec, m.duration_sec),
    'note', h.note,
    'meeting', jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'recordedAt', m.recorded_at,
      'durationSec', m.duration_sec,
      'isPublic', m.owner_id is null,
      'source', case when m.owner_id is null then m.source else null end
    ),
    'audioPath', case when m.owner_id is null then m.audio_path else null end,
    'speakers', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label) order by s.idx)
      from public.meeting_speakers s where s.meeting_id = m.id
    ), '[]'::jsonb),
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'speaker', t.speaker_code, 'startSec', t.start_sec,
               'endSec', t.end_sec, 'text', t.text) order by t.start_sec, t.end_sec)
      from public.transcript_turns t
      where t.meeting_id = m.id and t.start_sec < h.end_sec and t.end_sec > h.start_sec
    ), '[]'::jsonb)
  )
  from public.share_links l
  join public.highlights h on h.id = l.highlight_id
  join public.meetings m on m.id = h.meeting_id
  where p_token ~ '^[0-9a-f]{64}$'
    and l.token = p_token
    and l.revoked_at is null
    and m.status = 'ready'
    -- the sharer must still be able to read the meeting
    and (m.owner_id is null or m.owner_id = h.owner_id);
$$;

revoke execute on function public.get_shared_clip(text) from public;
grant execute on function public.get_shared_clip(text) to anon, authenticated, service_role;
