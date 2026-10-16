-- Hardening from the whole-codebase review (docs/plan.md). Everything a route
-- handler enforced for visitor writes is now enforced in the database too, because the
-- three visitor-writable tables are reachable through the Data API with the publishable
-- key, not only through the routes.

-- 1. The write limit, the clip bounds and the share token are decided by the database.
--    Runs for user roles only (auth.uid() set); the service role is the worker and the
--    import, which have their own rules.
create or replace function public.enforce_visitor_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.note_visitor_write() then
    raise exception 'too many changes; wait a minute' using errcode = 'P0005';
  end if;
  return new;
end $$;

create trigger highlights_visitor_write
  before insert or update on public.highlights
  for each row execute function public.enforce_visitor_write();
create trigger share_links_visitor_write
  before insert or update on public.share_links
  for each row execute function public.enforce_visitor_write();
create trigger item_states_visitor_write
  before insert or update on public.item_states
  for each row execute function public.enforce_visitor_write();

-- A clip never runs past the recording.
create or replace function public.clamp_highlight()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_duration numeric;
begin
  select duration_sec into v_duration from public.meetings where id = new.meeting_id;
  if v_duration is null then
    -- Unreadable (RLS) or not yet recorded: leave it to the policies and constraints.
    return new;
  end if;
  if new.end_sec > v_duration then
    new.end_sec := v_duration;
  end if;
  if new.end_sec <= new.start_sec then
    raise exception 'a highlight must end after it starts' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger highlights_clamp
  before insert or update on public.highlights
  for each row execute function public.clamp_highlight();

-- The share token is always the database's 32 random bytes, whatever the client sent.
create or replace function public.mint_share_token()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Two v4 uuids: 244 random bits, 64 hex characters, no extension needed.
  new.token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  return new;
end $$;

create trigger share_links_mint_token
  before insert on public.share_links
  for each row execute function public.mint_share_token();

-- 2. The deployment-wide bot cap, atomically, next to the per-user one.
create table public.app_settings (
  key   text primary key check (key ~ '^[a-z_]{1,40}$'),
  value text not null check (length(value) <= 200)
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
insert into public.app_settings (key, value) values ('bot_daily_cap', '20');

create or replace function public.cap_bot_requests()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_recent integer;
  v_cap integer;
begin
  if new.owner_id is null or new.source ->> 'kind' is distinct from 'bot' then
    return new;
  end if;
  -- One row per owner is enough to serialise concurrent requests from the same user;
  -- the global count takes a shared advisory lock so two requests cannot both pass.
  perform pg_advisory_xact_lock(hashtext('bot_requests'));
  delete from public.bot_requests where at < now() - interval '24 hours';
  select count(*) into v_recent from public.bot_requests where owner_id = new.owner_id;
  if v_recent >= 5 then
    raise exception 'at most 5 bot meetings a day per user' using errcode = 'P0003';
  end if;
  select coalesce(value::integer, 20) into v_cap from public.app_settings where key = 'bot_daily_cap';
  if (select count(*) from public.bot_requests) >= coalesce(v_cap, 20) then
    raise exception 'the bot is fully booked for today' using errcode = 'P0004';
  end if;
  insert into public.bot_requests (owner_id) values (new.owner_id);
  return new;
end $$;

-- 3. A typed command returns the id it created, inside the same transaction and under
--    the meeting's row lock, so two typed commands at once cannot swap ids.
create or replace function public.apply_typed_command(p_meeting_id text, p_command jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.apply_commands(
    p_meeting_id,
    jsonb_build_object('commands', jsonb_build_array(p_command), 'queueGeneration', false));
  select id into v_id from public.meeting_commands
  where meeting_id = p_meeting_id and source = 'typed'
  order by created_at desc limit 1;
  return v_id;
end $$;

revoke execute on function public.apply_typed_command(text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_typed_command(text, jsonb) to service_role;
