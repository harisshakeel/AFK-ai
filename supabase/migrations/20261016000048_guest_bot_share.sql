-- Guests together may use at most half of the day's bots (security review, 2026-10-17;
-- owner's decision).
--
-- A guest identity is free to make and the per-place cap is five a day per address, so
-- four addresses could take all twenty of the deployment's daily bots and leave none
-- for anyone. Guests now share half of bot_daily_cap; Google users can use the whole of
-- it, so a signed-in user always finds room. Each request records whether a guest made
-- it, and the trigger is otherwise as migration 29 left it.

alter table public.bot_requests add column guest boolean not null default false;

create or replace function public.cap_bot_requests()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_recent integer;
  v_by_place integer;
  v_cap integer;
  v_guest boolean;
begin
  if new.owner_id is null or new.source ->> 'kind' is distinct from 'bot' then
    return new;
  end if;
  -- One lock for every bot request: the counts below are then exact.
  perform pg_advisory_xact_lock(hashtext('bot_requests'));
  delete from public.bot_requests where at < now() - interval '24 hours';
  select count(*) into v_recent from public.bot_requests where owner_id = new.owner_id;
  if v_recent >= 5 then
    raise exception 'at most 5 bot meetings a day per user' using errcode = 'P0003';
  end if;
  if new.sender_key is not null then
    select count(*) into v_by_place from public.bot_requests where client_key = new.sender_key;
    if v_by_place >= 5 then
      raise exception 'at most 5 bot meetings a day from one place' using errcode = 'P0003';
    end if;
  end if;
  select coalesce(value::integer, 20) into v_cap from public.app_settings where key = 'bot_daily_cap';
  v_cap := coalesce(v_cap, 20);
  if (select count(*) from public.bot_requests) >= v_cap then
    raise exception 'the bot is fully booked for today' using errcode = 'P0004';
  end if;
  v_guest := public.is_guest(new.owner_id);
  if v_guest and (select count(*) from public.bot_requests where guest) >= ceil(v_cap / 2.0) then
    raise exception 'guests have used their half of today''s bots' using errcode = 'P0008';
  end if;
  insert into public.bot_requests (owner_id, client_key, guest)
  values (new.owner_id, new.sender_key, v_guest);
  return new;
end $$;
