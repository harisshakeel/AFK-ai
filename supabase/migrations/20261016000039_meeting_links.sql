-- Every meeting has an address (2026-10-16, owner's decision): a code for its URL
-- (/m/<code>) and a four-digit PIN, made with the meeting row so the address exists
-- from the start, shown to the owner alone. Behind them a visitor sees the recording,
-- the transcript and the summary, and nothing of the owner's: no action items, tasks,
-- commands, highlights or memory. The owner can switch the link off and on, or mint a
-- new code and PIN. The code carries 56 random bits, so it cannot be guessed; the PIN is
-- for a link that was passed on, and wrong tries are counted per link and visitor.

-- 1. The link, one per meeting.
create table public.meeting_links (
  meeting_id  text primary key references public.meetings (id) on delete cascade,
  code        text not null unique check (code ~ '^[a-z0-9]{12}$'),
  pin         text not null check (pin ~ '^[0-9]{4}$'),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

comment on table public.meeting_links is
  'The public address of a meeting: /m/<code> behind a four-digit PIN. Made with the meeting; the owner reads it, nobody writes it from the browser.';

-- Twelve characters from a 32-letter alphabet (no 0, 1, l, o), drawn from fifteen hex
-- digits of a v4 UUID, one of them the fixed version digit: 56 random bits.
create function public.new_link_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_bits bit(60);
  v_code text := '';
  i integer;
begin
  v_bits := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60);
  for i in 0..11 loop
    v_code := v_code || substr(v_alphabet, substring(v_bits from i * 5 + 1 for 5)::integer + 1, 1);
  end loop;
  return v_code;
end $$;

-- Four digits from thirty-two random bits.
create function public.new_link_pin()
returns text language sql volatile set search_path = '' as $$
  select lpad(
    (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 10000)::text,
    4, '0');
$$;

revoke execute on function public.new_link_code() from public, anon, authenticated;
revoke execute on function public.new_link_pin() from public, anon, authenticated;

-- 2. Made with the meeting.
create function public.make_meeting_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.meeting_links (meeting_id, code, pin)
  values (new.id, public.new_link_code(), public.new_link_pin())
  on conflict (meeting_id) do nothing;
  return new;
end $$;

create trigger meetings_make_link
  after insert on public.meetings
  for each row execute function public.make_meeting_link();

insert into public.meeting_links (meeting_id, code, pin)
select id, public.new_link_code(), public.new_link_pin() from public.meetings
on conflict (meeting_id) do nothing;

-- 3. The owner reads their meeting's link; no browser role writes.
alter table public.meeting_links enable row level security;

create policy "a meeting's link is its owner's to read"
  on public.meeting_links for select to authenticated
  using (exists (
    select 1 from public.meetings m
    where m.id = meeting_id and m.owner_id = (select auth.uid())));

revoke all on public.meeting_links from anon, authenticated;
grant select on public.meeting_links to authenticated;
grant all on public.meeting_links to service_role;

-- The owner's two actions, as the caller.
create function public.rotate_meeting_link(p_meeting_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.meeting_links l
  set code = public.new_link_code(), pin = public.new_link_pin(), enabled = true, rotated_at = now()
  from public.meetings m
  where l.meeting_id = p_meeting_id and m.id = l.meeting_id and m.owner_id = (select auth.uid());
  return found;
end $$;

create function public.set_meeting_link_enabled(p_meeting_id text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.meeting_links l
  set enabled = p_enabled
  from public.meetings m
  where l.meeting_id = p_meeting_id and m.id = l.meeting_id and m.owner_id = (select auth.uid());
  return found;
end $$;

revoke execute on function public.rotate_meeting_link(text) from public, anon;
revoke execute on function public.set_meeting_link_enabled(text, boolean) from public, anon;
grant execute on function public.rotate_meeting_link(text) to authenticated, service_role;
grant execute on function public.set_meeting_link_enabled(text, boolean) to authenticated, service_role;

-- 4. Opening a link: the PIN, with wrong tries counted per link and visitor (a keyed
-- hash of the address, never the address). Five wrong tries lock that pair for fifteen
-- minutes; a right one clears it. An unknown or switched-off code answers like a wrong
-- PIN, so nothing tells codes apart from outside.
create table public.meeting_link_tries (
  code         text not null,
  client_key   text not null check (client_key ~ '^[0-9a-f]{32}$'),
  failures     integer not null default 0 check (failures >= 0),
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (code, client_key)
);

alter table public.meeting_link_tries enable row level security;
revoke all on public.meeting_link_tries from anon, authenticated;
grant all on public.meeting_link_tries to service_role;

create function public.open_meeting_link(p_code text, p_pin text, p_client_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_try    public.meeting_link_tries%rowtype;
  v_link   public.meeting_links%rowtype;
  v_failures constant integer := 5;
  v_lock     constant interval := interval '15 minutes';
begin
  perform pg_advisory_xact_lock(hashtext('link-try:' || p_code || ':' || p_client_key));
  select * into v_try from public.meeting_link_tries
  where code = p_code and client_key = p_client_key;
  if found and v_try.locked_until is not null and v_try.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_try.locked_until);
  end if;

  select l.* into v_link from public.meeting_links l
  join public.meetings m on m.id = l.meeting_id
  where l.code = p_code and l.enabled and l.pin = p_pin and m.status = 'ready';
  if found then
    delete from public.meeting_link_tries where code = p_code and client_key = p_client_key;
    return jsonb_build_object('ok', true, 'meetingId', v_link.meeting_id);
  end if;

  insert into public.meeting_link_tries (code, client_key, failures, locked_until)
  values (p_code, p_client_key, 1, null)
  on conflict (code, client_key) do update set
    failures = public.meeting_link_tries.failures + 1,
    locked_until = case when public.meeting_link_tries.failures + 1 >= v_failures
                        then now() + v_lock else null end,
    updated_at = now()
  returning * into v_try;
  if v_try.locked_until is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_try.locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'triesLeft', v_failures - v_try.failures);
end $$;

revoke execute on function public.open_meeting_link(text, text, text) from public, anon, authenticated;
grant execute on function public.open_meeting_link(text, text, text) to service_role;

-- Tries older than a day are forgotten by the keep-alive.
create function public.prune_link_tries()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.meeting_link_tries where updated_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.prune_link_tries() from public, anon, authenticated;
grant execute on function public.prune_link_tries() to service_role;

-- 5. What a link holder sees, once the server has checked the PIN's grant: the meeting,
-- its speakers and turns, the summary points and the notes said on the call. Nothing
-- else of the meeting and nothing of the owner.
create function public.get_shared_meeting(p_code text)
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
    ), '[]'::jsonb)
  )
  from public.meeting_links l
  join public.meetings m on m.id = l.meeting_id
  where p_code ~ '^[a-z0-9]{12}$'
    and l.code = p_code
    and l.enabled
    and m.status = 'ready';
$$;

revoke execute on function public.get_shared_meeting(text) from public, anon, authenticated;
grant execute on function public.get_shared_meeting(text) to service_role;
