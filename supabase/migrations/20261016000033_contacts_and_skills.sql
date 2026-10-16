-- Contacts and skill files (owner's decisions in docs/plan.md).
--
--   1. Three more memory files, the skills: how AFK drafts an email, a Slack post and a
--      calendar event for this host (tone, sign-off, channels, hours). Same table, same
--      rules, same "below the rule" split for anything AFK appends.
--   2. contacts: the people AFK knows an address for, per Google user. Learned from the
--      recipients the host confirmed on a card (finish_command), from the host's own
--      people file when it is read, and from Google's contacts when imported. Each row
--      carries where it came from, how often it was used and when, and the other names
--      the host has called that person, so a spoken "Sam" can be offered as a best guess
--      with its reason. The host reads and deletes their own rows; every write goes
--      through learn_contacts() with the service role. Guests have none.

-- 1.
alter table public.memory_files drop constraint memory_files_path_check;
alter table public.memory_files add constraint memory_files_path_check check (path in (
  'profile.md', 'context/people.md', 'context/projects.md', 'context/glossary.md',
  'history/meetings.md', 'history/actions.md',
  'skills/email.md', 'skills/slack.md', 'skills/calendar.md'));

-- 2.
create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  email        text not null check (email = lower(email) and length(email) <= 254
                                    and email ~ '^[^\s@<>,;:"()]+@[^\s@<>,;:"()]+\.[^\s@<>,;:"()]+$'),
  name         text not null check (length(name) between 1 and 120),
  aliases      text[] not null default '{}' check (cardinality(aliases) <= 8),
  source       text not null check (source in ('approval', 'people_file', 'google_contacts', 'google_other')),
  uses         integer not null default 0 check (uses >= 0),
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (owner_id, email)
);

comment on table public.contacts is
  'People AFK knows an address for, per Google user: learned from approved cards, the people file and Google contacts. Suggested on cards as a best guess with the reason; never sent to without approval.';

create index contacts_owner_rank on public.contacts (owner_id, uses desc, last_used_at desc nulls last);

alter table public.contacts enable row level security;

create policy contacts_select_own on public.contacts
  for select to authenticated
  using (owner_id = auth.uid() and public.is_google_user());
create policy contacts_delete_own on public.contacts
  for delete to authenticated
  using (owner_id = auth.uid() and public.is_google_user());

grant select, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;

-- [{name, email}, …] learned for one owner: a new address is added with its source, a
-- known one counts a use and keeps the new name as an alias. Guests learn nothing.
-- p_used false records the person without counting a use (an import, a file read).
create function public.learn_contacts(
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
  if p_source not in ('approval', 'people_file', 'google_contacts', 'google_other') then
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

revoke execute on function public.learn_contacts(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.learn_contacts(uuid, jsonb, text, boolean) to service_role;

-- finish_command(): the recipients the host confirmed are learned as contacts.
create or replace function public.finish_command(p_command_id uuid, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_owner uuid;
  v_line text;
begin
  if coalesce((p_payload ->> 'skipped')::boolean, false) then
    return;
  end if;
  update public.meeting_commands c
  set status = 'done', result = p_payload -> 'result', finished_at = now(), error = null
  where c.id = p_command_id and c.status in ('running', 'approved');
  if not found then
    return;
  end if;
  select m.owner_id into v_owner
  from public.meeting_commands c join public.meetings m on m.id = c.meeting_id
  where c.id = p_command_id;
  v_line := p_payload ->> 'line';
  if v_owner is not null and v_line is not null then
    perform public.append_memory_lines(v_owner, 'history/actions.md', array[v_line]);
    update public.connectors
    set last_used_at = now()
    where owner_id = v_owner and provider = p_payload ->> 'provider';
  end if;
  if v_owner is not null and jsonb_typeof(p_payload -> 'learned') = 'array' then
    perform public.learn_contacts(v_owner, p_payload -> 'learned', 'approval', true);
  end if;
end $$;

-- 3. rewrite_command(): the host asks for a draft to be written again with a note. The
--    command goes back to "detected" with the note in its args, and the parse job is
--    queued; the parser reads the note and the host confirms the new draft as before.
--    Runs as the caller: only the meeting's owner, only a proposed or unparsed draft of
--    a kind the model writes.
create function public.rewrite_command(p_command_id uuid, p_note text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_meeting text;
begin
  select c.meeting_id into v_meeting
  from public.meeting_commands c
  join public.meetings m on m.id = c.meeting_id
  where c.id = p_command_id
    and m.owner_id = auth.uid()
    and c.kind in ('email', 'followup', 'remind')
    and c.status in ('proposed', 'unparsed')
  for update of c;
  if v_meeting is null then
    return false;
  end if;
  update public.meeting_commands
  set status = 'detected',
      args = coalesce(args, '{}'::jsonb) || jsonb_build_object('rewriteNote', left(trim(p_note), 300)),
      error = null
  where id = p_command_id;
  insert into public.processing_jobs (meeting_id, kind)
  values (v_meeting, 'detect_commands')
  on conflict do nothing;
  return true;
end $$;

revoke execute on function public.rewrite_command(uuid, text) from public, anon;
grant execute on function public.rewrite_command(uuid, text) to authenticated, service_role;
