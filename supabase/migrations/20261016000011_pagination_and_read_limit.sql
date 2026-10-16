-- Two of the gaps left after the whole-codebase review (docs/system-design.md):
-- keyset pagination for the meetings lists, and a per-client limit on the public read
-- paths (search, share links, audio links).

-- 1. One page of meetings, newest first, as the caller: security invoker, so Row Level
--    Security decides what exists. The sort key is (recorded_at, created_at, id) with
--    unrecorded meetings last; the cursor is the key of the last row shown, so a page never
--    repeats or skips a row while new meetings arrive.
create or replace function public.list_meetings(
  p_own boolean,
  p_limit integer default 20,
  p_before_recorded timestamptz default null,
  p_before_created timestamptz default null,
  p_before_id text default null
)
returns table (
  id text,
  owner_id uuid,
  title text,
  recorded_at timestamptz,
  duration_sec numeric,
  ai_headline text,
  status text,
  status_detail text,
  created_at timestamptz,
  speakers jsonb
)
language sql stable security invoker set search_path = '' as $$
  select m.id, m.owner_id, m.title, m.recorded_at, m.duration_sec, m.ai_headline,
         m.status, m.status_detail, m.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label) order by s.idx)
           from public.meeting_speakers s
           where s.meeting_id = m.id
         ), '[]'::jsonb) as speakers
  from public.meetings m
  where (case when p_own then m.owner_id = (select auth.uid()) else m.owner_id is null end)
    and (
      p_before_id is null
      or (coalesce(m.recorded_at, '-infinity'::timestamptz), m.created_at, m.id)
         < (coalesce(p_before_recorded, '-infinity'::timestamptz), p_before_created, p_before_id)
    )
  order by coalesce(m.recorded_at, '-infinity'::timestamptz) desc, m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.list_meetings(boolean, integer, timestamptz, timestamptz, text)
  to anon, authenticated, service_role;

-- 2. A per-client limit on the public read paths. The server keys it by a keyed hash of
--    the client address (never the address itself); rows live for a minute.
create table public.read_hits (
  bucket text not null check (bucket ~ '^[a-z_]{1,32}$'),
  key    text not null check (key ~ '^[0-9a-f]{32}$'),
  at     timestamptz not null default now()
);

create index read_hits_bucket_key_idx on public.read_hits (bucket, key, at desc);
create index read_hits_at_idx on public.read_hits (at);

alter table public.read_hits enable row level security;
revoke all on public.read_hits from anon, authenticated;
grant all on public.read_hits to service_role;

create or replace function public.note_read_hit(p_bucket text, p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.read_hits where at < now() - interval '1 minute';
  select count(*) into v_count
  from public.read_hits
  where bucket = p_bucket and key = p_key;
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.read_hits (bucket, key) values (p_bucket, p_key);
  return true;
end $$;

revoke execute on function public.note_read_hit(text, text, integer) from public, anon, authenticated;
grant execute on function public.note_read_hit(text, text, integer) to service_role;
