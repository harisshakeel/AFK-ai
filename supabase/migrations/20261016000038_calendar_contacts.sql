-- The people on a calendar invite (2026-10-16, owner's call: "keep whoever joins a meeting
-- with us as a record, their name and email, so Claude can address them"). The meeting
-- platforms give a bot names, never addresses; the invite on the host's Google Calendar
-- gives both. When AFK is sent to a meeting that is on the calendar (by its link, or by
-- the event it was scheduled from), the invitees are recorded as people AFK knows, with
-- the source 'calendar', unused until a card to them is approved. Guests have none.

alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source in ('approval', 'people_file', 'google_contacts', 'google_other', 'calendar'));

create or replace function public.learn_contacts(
  p_owner_id uuid, p_people jsonb, p_source text, p_used boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_item  jsonb;
  v_email text;
  v_name  text;
  v_count integer := 0;
begin
  if p_owner_id is null or public.is_guest(p_owner_id) then
    return 0;
  end if;
  if p_source not in ('approval', 'people_file', 'google_contacts', 'google_other', 'calendar') then
    raise exception 'unknown contact source %', p_source using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    v_email := lower(trim(v_item ->> 'email'));
    v_name := left(regexp_replace(trim(coalesce(v_item ->> 'name', '')), '\s+', ' ', 'g'), 120);
    if v_email is null or v_email !~ '^[^\s@<>,;:"()]+@[^\s@<>,;:"()]+\.[^\s@<>,;:"()]+$' then
      continue;
    end if;
    if v_name = '' then
      -- "sam.lee" stands in for a name until the host says one.
      v_name := initcap(replace(replace(split_part(v_email, '@', 1), '.', ' '), '_', ' '));
    end if;
    insert into public.contacts (owner_id, email, name, source, uses, last_used_at)
    values (p_owner_id, v_email, v_name, p_source,
            case when p_used then 1 else 0 end,
            case when p_used then now() else null end)
    on conflict (owner_id, email) do update set
      uses = public.contacts.uses + (case when p_used then 1 else 0 end),
      last_used_at = case when p_used then now() else public.contacts.last_used_at end,
      -- Another name for the same address is kept, up to eight, never the name itself.
      aliases = case
        when lower(excluded.name) = lower(public.contacts.name)
          or lower(excluded.name) = any (array(select lower(a) from unnest(public.contacts.aliases) a))
        then public.contacts.aliases
        else (public.contacts.aliases || excluded.name)[1:8]
      end,
      updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
