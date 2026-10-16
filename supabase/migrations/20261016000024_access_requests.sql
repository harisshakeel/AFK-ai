-- Access requests: the landing's "Get added to test users" form (owner's decision).
-- While Google keeps the app in Testing, only the test users the owner lists
-- by hand can sign in (docs/going-live.md), so a visitor leaves the email they would sign
-- in with and the owner adds it. The visitor's own identity (anonymous or signed in)
-- writes the row, under the visitor write limit; nobody reads the list from the browser.
-- The owner reads it in the Supabase dashboard.

create table public.access_requests (
  id           uuid primary key default gen_random_uuid(),
  -- Stored lower-cased and trimmed by the route; the check keeps it that way.
  email        text not null unique
    check (
      email = lower(btrim(email))
      and length(email) <= 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  -- Kept for the write check; an anonymous identity may be deleted later, the request stays.
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.access_requests enable row level security;

-- Insert only, as yourself. There is no select, update or delete policy, and no select
-- privilege either: no visitor, anonymous or signed in, can read or change the list.
create policy "you can ask to be added as a test user"
  on public.access_requests for insert to authenticated
  with check (requested_by = (select auth.uid()));

revoke all on public.access_requests from anon, authenticated;
-- The email only: who asked is the default, and no visitor may write it as someone else.
grant insert (email) on public.access_requests to authenticated;
grant all on public.access_requests to service_role;
