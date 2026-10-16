-- At most 60 changes a minute per visitor (NFR Limits). Every visitor write goes through
-- a route handler, which calls note_visitor_write() first and answers 429 when it
-- returns false. The log keeps one row per write for a minute.
create table public.visitor_writes (
  owner_id uuid not null references auth.users (id) on delete cascade,
  at       timestamptz not null default now()
);

create index visitor_writes_owner_at_idx on public.visitor_writes (owner_id, at desc);

alter table public.visitor_writes enable row level security;
revoke all on public.visitor_writes from anon, authenticated;
grant all on public.visitor_writes to service_role;

create or replace function public.note_visitor_write(p_limit integer default 60)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;
  delete from public.visitor_writes where owner_id = v_uid and at < now() - interval '1 minute';
  select count(*) into v_count from public.visitor_writes where owner_id = v_uid;
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.visitor_writes (owner_id) values (v_uid);
  return true;
end $$;

revoke execute on function public.note_visitor_write(integer) from public, anon;
grant execute on function public.note_visitor_write(integer) to authenticated, service_role;
