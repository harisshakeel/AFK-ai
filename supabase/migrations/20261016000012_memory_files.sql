-- Memory: what AFK knows about a user (requirements-v2 M1-M7, M10; design-v2 section 2.3).
-- Phase A2, resumed from the parked branch after the hand-in; numbered after the hardening
-- and pagination migrations it was written beside.
--
-- Six markdown files per signed-in user, readable and editable by them. AFK appends
-- below a rule it never crosses, through append_memory_lines() (service role only).
-- Memory is personal data: owner-only rules, never logged, never in seed data, deleted
-- with the account.

create table public.memory_files (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  path       text not null check (path in (
               'profile.md', 'context/people.md', 'context/projects.md', 'context/glossary.md',
               'history/meetings.md', 'history/actions.md')),
  content    text not null check (octet_length(content) <= 32768),
  updated_by text not null default 'you' check (updated_by in ('you', 'afk')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, path)
);

-- A user's own writes: through the Data API, as themselves, content only; the trigger
-- stamps who and when and counts the write against their limit.
create or replace function public.memory_files_user_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('request.jwt.claims', true) is not null
     and (select auth.uid()) is not null then
    new.updated_by := 'you';
    new.updated_at := now();
    if not public.note_visitor_write() then
      raise exception 'too many changes; wait a minute' using errcode = 'P0005';
    end if;
  end if;
  return new;
end $$;

create trigger memory_files_user_write
  before insert or update on public.memory_files
  for each row execute function public.memory_files_user_write();

alter table public.memory_files enable row level security;

create policy "your memory is yours to read"
  on public.memory_files for select to authenticated
  using (owner_id = (select auth.uid())
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

create policy "you can write your own memory"
  on public.memory_files for insert to authenticated
  with check (owner_id = (select auth.uid())
              and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

create policy "you can change your own memory"
  on public.memory_files for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "you can erase your own memory"
  on public.memory_files for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.memory_files from anon, authenticated;
grant select (owner_id, path, content, updated_by, created_at, updated_at) on public.memory_files
  to authenticated;
grant insert (owner_id, path, content) on public.memory_files to authenticated;
grant update (content) on public.memory_files to authenticated;
grant delete on public.memory_files to authenticated;
grant all on public.memory_files to service_role;

-- AFK's writes (service role): append dated lines under "## Learned by AFK", creating
-- the file from p_template when it does not exist, never touching the user's zone above
-- the "---" rule, trimming the oldest learned lines to stay within 32 KB. History files
-- have no user zone: the whole file is AFK's, oldest lines trimmed first.
create or replace function public.append_memory_lines(
  p_owner_id uuid, p_path text, p_lines text[], p_template text default '')
returns void language plpgsql set search_path = '' as $$
declare
  v_content text;
  v_user_zone text;
  v_learned text[];
  v_marker constant text := E'\n---\n\n## Learned by AFK\n';
  v_pos integer;
  v_line text;
  v_result text;
begin
  if p_lines is null or array_length(p_lines, 1) is null then
    return;
  end if;
  select content into v_content from public.memory_files
  where owner_id = p_owner_id and path = p_path for update;
  if not found then
    v_content := coalesce(p_template, '');
    insert into public.memory_files (owner_id, path, content, updated_by)
    values (p_owner_id, p_path, v_content, 'afk');
  end if;

  if p_path like 'history/%' then
    v_user_zone := '';
    v_learned := array_remove(string_to_array(v_content, E'\n'), '');
  else
    v_pos := position(v_marker in v_content);
    if v_pos = 0 then
      v_user_zone := rtrim(v_content, E'\n') || E'\n';
      v_learned := array[]::text[];
    else
      v_user_zone := left(v_content, v_pos - 1) || E'\n';
      v_learned := array_remove(
        string_to_array(substring(v_content from v_pos + length(v_marker)), E'\n'), '');
    end if;
  end if;

  foreach v_line in array p_lines loop
    v_line := left(regexp_replace(v_line, E'[\\r\\n]+', ' ', 'g'), 500);
    if length(trim(v_line)) > 0 then
      v_learned := array_append(v_learned, trim(v_line));
    end if;
  end loop;

  loop
    v_result := case
      when p_path like 'history/%' then array_to_string(v_learned, E'\n') || E'\n'
      else v_user_zone || v_marker || E'\n' || array_to_string(v_learned, E'\n') || E'\n'
    end;
    exit when octet_length(v_result) <= 32768 or array_length(v_learned, 1) is null;
    v_learned := v_learned[2:array_length(v_learned, 1)];
  end loop;

  update public.memory_files
  set content = v_result, updated_by = 'afk', updated_at = now()
  where owner_id = p_owner_id and path = p_path;
end $$;

revoke execute on function public.append_memory_lines(uuid, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.append_memory_lines(uuid, text, text[], text) to service_role;

-- One line per processed meeting in history/meetings.md, written when the summaries are
-- published for an operator's meeting (no Claude: from the stored analysis).
create or replace function public.note_meeting_in_history(p_meeting_id text)
returns void language plpgsql set search_path = '' as $$
declare
  v_owner uuid;
  v_line text;
begin
  select m.owner_id into v_owner from public.meetings m where m.id = p_meeting_id;
  if v_owner is null then
    return;
  end if;
  select '- [' || coalesce(to_char(m.recorded_at, 'YYYY-MM-DD'), 'undated') || '] '
         || m.title
         || coalesce(': ' || m.ai_headline, '')
         || ' (' || (select count(*) from public.meeting_items i
                     where i.meeting_id = m.id and i.kind = 'action') || ' action items)'
  into v_line
  from public.meetings m where m.id = p_meeting_id;
  perform public.append_memory_lines(v_owner, 'history/meetings.md', array[v_line]);
end $$;

revoke execute on function public.note_meeting_in_history(text) from public, anon, authenticated;
grant execute on function public.note_meeting_in_history(text) to service_role;

-- complete_job(): after the summaries of an operator's meeting, note it in history.
create or replace function public.complete_job(
  p_job_id uuid, p_claim_token uuid, p_outcome text,
  p_payload jsonb default null, p_error text default null, p_report jsonb default null,
  p_retry_at timestamptz default null)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_job public.processing_jobs;
begin
  select * into v_job from public.processing_jobs
  where id = p_job_id and claim_token = p_claim_token and status = 'running'
  for update;
  if not found then
    return false;
  end if;

  if p_outcome = 'done' then
    if v_job.kind = 'analyze' then
      perform public.apply_analysis(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'summarize' then
      perform public.apply_summaries(v_job.meeting_id, p_payload);
      perform public.note_meeting_in_history(v_job.meeting_id);
    elsif v_job.kind = 'detect_commands' then
      perform public.apply_commands(v_job.meeting_id, p_payload);
    end if;
    update public.processing_jobs
    set status = 'done', finished_at = now(), claim_token = null, lease_until = null,
        last_error = null, report = p_report
    where id = p_job_id;
  elsif p_outcome = 'failed' then
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        run_after = now() + make_interval(secs => 60 * power(4, attempts - 1)::int),
        claim_token = null, lease_until = null,
        last_error = left(p_error, 2000), report = p_report
    where id = p_job_id;
    if v_job.kind = 'ingest_media' and v_job.attempts >= v_job.max_attempts then
      update public.meetings
      set status = 'failed', status_detail = 'Could not fetch the recording or transcript'
      where id = v_job.meeting_id and status = 'transcribed';
    end if;
    if v_job.kind = 'detect_commands' and v_job.attempts >= v_job.max_attempts then
      insert into public.processing_jobs (meeting_id, kind)
      values (v_job.meeting_id, 'analyze'), (v_job.meeting_id, 'summarize')
      on conflict do nothing;
    end if;
  elsif p_outcome = 'release' then
    update public.processing_jobs
    set status = 'queued', attempts = greatest(attempts - 1, 0),
        run_after = coalesce(p_retry_at, now() + interval '15 minutes'),
        claim_token = null, lease_until = null, last_error = left(p_error, 2000)
    where id = p_job_id;
  else
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  return true;
end $$;

-- apply_commands(): a /remember command appends its line to the file the parser chose.
-- Same body as migration 9 plus the "memory" field: {"path", "line"}.
create or replace function public.apply_commands(p_meeting_id text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_owner uuid;
  v_cmd jsonb;
  v_kind text;
  v_item_kind text;
  v_status text;
  v_id uuid;
  v_item_id uuid;
  v_highlight_id uuid;
  v_item jsonb;
  v_highlight jsonb;
  v_memory jsonb;
begin
  select owner_id into v_owner from public.meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'meeting % does not exist', p_meeting_id using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_payload -> 'host') = 'object' then
    update public.meetings
    set host_speaker_code = p_payload #>> '{host,speakerCode}',
        host_detected_by = p_payload #>> '{host,detectedBy}'
    where id = p_meeting_id;
  end if;

  for v_cmd in select value from jsonb_array_elements(coalesce(p_payload -> 'commands', '[]'::jsonb))
  loop
    v_kind := v_cmd ->> 'kind';
    v_status := coalesce(v_cmd ->> 'status', 'unparsed');
    v_id := null;

    if (v_cmd ->> 'id') is not null then
      select id into v_id from public.meeting_commands
      where id = (v_cmd ->> 'id')::uuid and meeting_id = p_meeting_id and status = 'detected'
      for update;
      if v_id is null then
        continue;
      end if;
      update public.meeting_commands
      set args = coalesce(v_cmd -> 'args', '{}'::jsonb), status = v_status,
          error = left(v_cmd ->> 'error', 2000)
      where id = v_id;
    else
      insert into public.meeting_commands
        (meeting_id, turn_id, source, kind, sentence, args, status, needs_approval, error)
      values (p_meeting_id, v_cmd ->> 'turnId', coalesce(v_cmd ->> 'source', 'spoken'), v_kind,
              left(v_cmd ->> 'sentence', 1000), coalesce(v_cmd -> 'args', '{}'::jsonb), v_status,
              v_kind = 'email', left(v_cmd ->> 'error', 2000))
      on conflict (meeting_id, turn_id, kind) where source = 'spoken' do nothing
      returning id into v_id;
      if v_id is null then
        continue;
      end if;
    end if;

    v_item := v_cmd -> 'item';
    if v_status = 'applied' and jsonb_typeof(v_item) = 'object'
       and v_kind in ('task', 'decision', 'note') then
      v_item_kind := case v_kind when 'task' then 'action' else v_kind end;
      insert into public.meeting_items
        (meeting_id, kind, source, command_id, idx, text, owner_speaker_code, owner_name, due_text)
      values (p_meeting_id, v_item_kind, 'command', v_id,
              (select coalesce(max(i.idx), -1) + 1 from public.meeting_items i
               where i.meeting_id = p_meeting_id and i.source = 'command' and i.kind = v_item_kind),
              left(v_item ->> 'text', 1000), v_item ->> 'ownerSpeaker',
              left(v_item ->> 'ownerName', 80), left(v_item ->> 'dueText', 80))
      returning id into v_item_id;
      if (v_cmd ->> 'turnId') is not null then
        insert into public.item_citations (item_id, meeting_id, turn_id)
        values (v_item_id, p_meeting_id, v_cmd ->> 'turnId');
      end if;
      update public.meeting_commands set item_id = v_item_id where id = v_id;
    end if;

    v_highlight := v_cmd -> 'highlight';
    if v_status = 'applied' and jsonb_typeof(v_highlight) = 'object'
       and v_kind = 'highlight' and v_owner is not null then
      insert into public.highlights (meeting_id, owner_id, start_sec, end_sec, note, command_id)
      values (p_meeting_id, v_owner, (v_highlight ->> 'startSec')::numeric,
              (v_highlight ->> 'endSec')::numeric, left(v_cmd ->> 'sentence', 500), v_id)
      returning id into v_highlight_id;
      update public.meeting_commands set highlight_id = v_highlight_id where id = v_id;
    end if;

    v_memory := v_cmd -> 'memory';
    if v_status = 'applied' and jsonb_typeof(v_memory) = 'object'
       and v_kind = 'remember' and v_owner is not null then
      perform public.append_memory_lines(v_owner, v_memory ->> 'path',
                                         array[v_memory ->> 'line'], v_memory ->> 'template');
    end if;
  end loop;

  if coalesce((p_payload ->> 'queueGeneration')::boolean, false) then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize')
    on conflict do nothing;
  end if;
end $$;
