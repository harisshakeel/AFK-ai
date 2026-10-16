-- At most three access requests per identity (security review, 2026-10-17).
--
-- The table's only bound was the visitor write limit, sixty rows a minute, and one
-- request may carry many rows through the Data API. With identities free to make, one
-- address could add tens of megabytes a day to a database on the Free plan until it
-- turned read-only. A person asks once, or fixes a typo; three is plenty.

create index access_requests_requested_by_idx on public.access_requests (requested_by);

-- Security definer: visitors may insert but not read the table, and the count reads it.
-- Under a lock on the identity, so concurrent inserts cannot all pass the count; earlier
-- rows of the same statement are seen, so one multi-row insert is capped as well.
create function public.cap_access_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.requested_by is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('access_requests:' || new.requested_by::text));
  if (select count(*) from public.access_requests where requested_by = new.requested_by) >= 3 then
    raise exception 'at most 3 access requests per visitor' using errcode = 'P0007';
  end if;
  return new;
end $$;
revoke execute on function public.cap_access_requests() from public, anon, authenticated;

create trigger access_requests_cap
  before insert on public.access_requests
  for each row execute function public.cap_access_requests();
