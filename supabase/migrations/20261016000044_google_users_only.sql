-- A Google user is an identity with Google among its sign-in providers, not any identity
-- that is not anonymous (security review, 2026-10-17).
--
-- Memory, contacts and connectors belong to Google accounts only, but every check asked
-- "is this session anonymous?". The project also allowed email-and-password sign-up, so
-- anyone who confirmed an address of their own had a non-anonymous identity: memory,
-- contacts, connectors and the learn job, and no thirty-day purge. Email sign-up is now
-- off (supabase/config.toml and the dashboard), and the checks ask for Google itself.
-- app_metadata is written by Supabase Auth only (raw_app_meta_data in auth.users, the
-- app_metadata claim in the token); user_metadata is the one a user can change.

-- 1. The test for the caller, which every memory_files and contacts policy uses.
create or replace function public.is_google_user()
returns boolean language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and coalesce(((select auth.jwt()) -> 'app_metadata' -> 'providers') ? 'google', false);
$$;

-- 2. Connectors asked the old question inline; they ask the shared one now.
drop policy "your connectors are yours to read" on public.connectors;
create policy "your connectors are yours to read"
  on public.connectors for select to authenticated
  using (owner_id = (select auth.uid()) and public.is_google_user());

-- 3. The test for an owner, which the job chain and the memory writers use. A meeting
--    with no owner (a seed) is not a guest's, as before; an owner with no Google
--    identity is, so their meetings queue no learn job and AFK writes no memory for them.
create or replace function public.is_guest(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
     and not coalesce((
       select u.raw_app_meta_data -> 'providers' ? 'google'
       from auth.users u where u.id = p_user_id), false);
$$;
