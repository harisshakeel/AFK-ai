-- A meeting's address has a budget of wrong PINs across every client (security review,
-- 2026-10-17).
--
-- open_meeting_link() locked a code for one client after five wrong PINs, and a client
-- is an address. With a code that leaked, a couple of thousand addresses could try every
-- one of the ten thousand PINs in minutes. Now fifty wrong tries in a day, from anyone,
-- switch the link off (the owner's own switch): about a 0.5% chance for a guesser, and
-- the owner makes a new link and PIN. Also, a lock that ran out gives five tries again,
-- rather than every later wrong try locking for another fifteen minutes (audit F17).
-- The function is otherwise unchanged; its grants stand.

create or replace function public.open_meeting_link(p_code text, p_pin text, p_client_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_try    public.meeting_link_tries%rowtype;
  v_link   public.meeting_links%rowtype;
  v_failures constant integer := 5;
  v_lock     constant interval := interval '15 minutes';
  v_budget   constant integer := 50;
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
    -- Every fifth wrong try locks, so a lock that ran out gives five tries again (audit
    -- F17); the count itself goes on, for the budget across clients below.
    locked_until = case when (public.meeting_link_tries.failures + 1) % v_failures = 0
                        then now() + v_lock else null end,
    updated_at = now()
  returning * into v_try;
  -- Across every client: the per-client lock is per address, and many addresses together
  -- could try all ten thousand PINs. Fifty wrong tries, summed over the clients that tried
  -- in the last day (each client's whole count), switch the link off; the owner sees it
  -- off and can make a new link and PIN.
  if (select coalesce(sum(t.failures), 0) from public.meeting_link_tries t
      where t.code = p_code and t.updated_at > now() - interval '1 day') >= v_budget then
    update public.meeting_links set enabled = false where code = p_code and enabled;
  end if;
  if v_try.locked_until is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'lockedUntil', v_try.locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'wrong',
                            'triesLeft', v_failures - v_try.failures % v_failures);
end $$;

-- Switching a link on is the owner's word that it may be tried again: its wrong tries
-- are cleared, or the next wrong PIN would switch it straight back off.
create or replace function public.set_meeting_link_enabled(p_meeting_id text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  update public.meeting_links l
  set enabled = p_enabled
  from public.meetings m
  where l.meeting_id = p_meeting_id and m.id = l.meeting_id and m.owner_id = (select auth.uid())
  returning l.code into v_code;
  if v_code is null then
    return false;
  end if;
  if p_enabled then
    delete from public.meeting_link_tries where code = v_code;
  end if;
  return true;
end $$;
