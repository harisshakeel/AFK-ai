-- Meeting commands, Phase A (requirements-v2 C1-C8; design-v2 sections 2.1, 2.2, 2.7, 3).
--
-- The host says "AFK, task for Sam: send the deck by Friday" and the worker turns it into
-- a meeting_commands row plus the item it created. Internal kinds (task, decision, note,
-- highlight) are applied in the same transaction as the parse result; the external kind
-- (email) is proposed for the owner to approve. Nothing here runs for visitors: the
-- detect_commands job is a Claude job, so claim_job() hands it out for operator meetings
-- only, and commands are readable by the meeting's owner only.

-- 1. Who the host is, per speaker (Attendee marks it per utterance) and per meeting.
alter table public.meeting_speakers
  add column is_host boolean not null default false;

alter table public.meetings
  add column host_speaker_code text,
  add column host_detected_by text check (host_detected_by in ('platform', 'name'));

-- 2. Items that came from an explicit command, next to the AI's own.
alter table public.meeting_items
  drop constraint meeting_items_kind_check,
  add constraint meeting_items_kind_check check (kind in ('point', 'action', 'decision', 'note')),
  add column source text not null default 'ai' check (source in ('ai', 'command')),
  add column command_id uuid;

alter table public.meeting_items
  drop constraint meeting_items_order_unique,
  add constraint meeting_items_order_unique unique nulls not distinct
    (meeting_id, kind, source, template_key, section_idx, idx);

alter table public.highlights add column command_id uuid;

-- 3. The commands themselves.
create table public.meeting_commands (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     text not null references public.meetings (id) on delete cascade,
  -- the sentence it came from; required for spoken commands
  turn_id        text,
  source         text not null check (source in ('spoken', 'typed')),
  -- 'unknown': the wake word was heard but no command followed (C8, "didn't catch that")
  kind           text not null
                 check (kind in ('task', 'decision', 'note', 'highlight', 'remember', 'email',
                                 'unknown')),
  sentence       text not null check (length(sentence) between 1 and 1000),
  -- parsed arguments, validated by the kind's schema in the app; size-checked here
  args           jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(args) = 'object' and pg_column_size(args) <= 8192),
  -- detected -> applied | proposed | unparsed; proposed -> approved | dismissed;
  -- approved -> running -> done | failed; anything but done -> dismissed
  status         text not null default 'detected'
                 check (status in ('detected', 'applied', 'proposed', 'unparsed', 'approved',
                                   'running', 'done', 'failed', 'dismissed')),
  needs_approval boolean not null default false,
  item_id        uuid references public.meeting_items (id) on delete set null,
  highlight_id   uuid references public.highlights (id) on delete set null,
  -- what an adapter did (identifiers, recipients, a link): the owner's own data
  result         jsonb check (result is null or pg_column_size(result) <= 8192),
  error          text check (length(error) <= 2000),
  approved_at    timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint meeting_commands_turn_fk foreign key (meeting_id, turn_id)
    references public.transcript_turns (meeting_id, id),
  constraint meeting_commands_spoken_has_turn check (source <> 'spoken' or turn_id is not null)
);

alter table public.meeting_items
  add constraint meeting_items_command_fk foreign key (command_id)
    references public.meeting_commands (id) on delete set null;
alter table public.highlights
  add constraint highlights_command_fk foreign key (command_id)
    references public.meeting_commands (id) on delete set null;

-- Re-running detection cannot record the same spoken command twice.
create unique index meeting_commands_spoken_once
  on public.meeting_commands (meeting_id, turn_id, kind) where source = 'spoken';
create index meeting_commands_meeting_idx on public.meeting_commands (meeting_id, created_at);

create trigger meeting_commands_set_updated_at
  before update on public.meeting_commands
  for each row execute function public.set_updated_at();

-- At most 20 spoken and 20 typed commands a meeting (requirements-v2, Principles 7).
create or replace function public.cap_meeting_commands()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.meeting_commands
      where meeting_id = new.meeting_id and source = new.source) >= 20 then
    raise exception 'at most 20 % commands a meeting', new.source using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger meeting_commands_cap
  before insert on public.meeting_commands
  for each row execute function public.cap_meeting_commands();

-- RLS: the meeting's owner reads their commands; nobody else, not even through a share
-- link or on a seed meeting (demo cards are static in the app). No user writes.
alter table public.meeting_commands enable row level security;

create policy "your commands are yours to read"
  on public.meeting_commands for select to authenticated
  using (exists (
    select 1 from public.meetings m
    where m.id = meeting_id and m.owner_id = (select auth.uid())
  ));

revoke all on public.meeting_commands from anon, authenticated;
grant select on public.meeting_commands to authenticated;
grant all on public.meeting_commands to service_role;

-- 4. The job that parses commands.
alter table public.processing_jobs
  drop constraint processing_jobs_kind_check,
  add constraint processing_jobs_kind_check
    check (kind in ('ingest_media', 'detect_commands', 'analyze', 'summarize'));

-- 5. Applying the parse result, one transaction (design-v2 section 5).
-- payload: {"host": {"speakerCode", "detectedBy"} | null,
--           "commands": [{"id"?: existing typed row, "turnId"?, "source", "kind",
--                         "sentence", "status": applied|proposed|unparsed, "args", "error"?,
--                         "item"?: {"text", "ownerSpeaker"?, "ownerName"?, "dueText"?},
--                         "highlight"?: {"startSec", "endSec"}}],
--           "queueGeneration": boolean}
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
      -- A typed command that waited for the parser.
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
        continue; -- recorded by an earlier run
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
  end loop;

  -- The chain continues: analysis and summaries, now told which items are explicit.
  if coalesce((p_payload ->> 'queueGeneration')::boolean, false) then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize')
    on conflict do nothing;
  end if;
end $$;

revoke execute on function public.apply_commands(text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_commands(text, jsonb) to service_role;

-- A dismissed command leaves no trace in the notes (C4).
create or replace function public.dismiss_command(p_command_id uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_item_id uuid;
  v_highlight_id uuid;
begin
  update public.meeting_commands
  set status = 'dismissed', finished_at = now()
  where id = p_command_id and status <> 'dismissed'
  returning item_id, highlight_id into v_item_id, v_highlight_id;
  if not found then
    return false;
  end if;
  delete from public.meeting_items where id = v_item_id;
  delete from public.highlights where id = v_highlight_id;
  return true;
end $$;

-- Approval (C4). Phase A has no adapters: an approved email is sent by the owner from
-- their mail app. Phase B inserts the run job here.
create or replace function public.approve_command(p_command_id uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.meeting_commands
  set status = 'approved', approved_at = now()
  where id = p_command_id and status = 'proposed';
  return found;
end $$;

revoke execute on function public.dismiss_command(uuid) from public, anon, authenticated;
revoke execute on function public.approve_command(uuid) from public, anon, authenticated;
grant execute on function public.dismiss_command(uuid) to service_role;
grant execute on function public.approve_command(uuid) to service_role;

-- 6. Analysis never removes explicit items.
create or replace function public.apply_analysis(p_meeting_id text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_ord bigint;
  v_kind text;
  v_id uuid;
begin
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.meeting_items
  where meeting_id = p_meeting_id and kind in ('action', 'decision') and source = 'ai';

  insert into public.chapters (meeting_id, idx, title, first_turn_id)
  select p_meeting_id, (c.ord - 1)::int, c.value ->> 'title', c.value ->> 'firstTurnId'
  from jsonb_array_elements(coalesce(p_payload -> 'chapters', '[]'::jsonb)) with ordinality as c(value, ord);

  foreach v_kind in array array['action', 'decision'] loop
    for v_item, v_ord in
      select e.value, e.ord
      from jsonb_array_elements(coalesce(p_payload -> (v_kind || 's'), '[]'::jsonb)) with ordinality as e(value, ord)
    loop
      if jsonb_array_length(coalesce(v_item -> 'turnIds', '[]'::jsonb)) = 0 then
        raise exception '% % cites no turn', v_kind, v_ord using errcode = '23514';
      end if;
      insert into public.meeting_items
        (meeting_id, kind, idx, text, owner_speaker_code, owner_name, due_text)
      values (p_meeting_id, v_kind, (v_ord - 1)::int, v_item ->> 'text',
              v_item ->> 'ownerSpeaker', v_item ->> 'ownerName', v_item ->> 'dueText')
      returning id into v_id;
      insert into public.item_citations (item_id, meeting_id, turn_id)
      select distinct v_id, p_meeting_id, t.value
      from jsonb_array_elements_text(v_item -> 'turnIds') as t(value);
    end loop;
  end loop;

  update public.meetings set ai_headline = nullif(p_payload ->> 'headline', '')
  where id = p_meeting_id;
end $$;

-- 7. Ingest: keeps the host flag, clears commands keyed to the old turns, and starts the
--    chain: detect_commands for operator meetings, analysis for seed meetings, nothing
--    for anyone else.
create or replace function public.ingest_transcript(
  p_meeting_id text, p_duration_sec numeric, p_speakers jsonb, p_turns jsonb, p_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_hash text;
  v_owner uuid;
begin
  select transcript_hash, owner_id into v_hash, v_owner
  from public.meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'meeting % does not exist', p_meeting_id using errcode = 'P0002';
  end if;
  if v_hash is not distinct from p_hash then
    return false;
  end if;

  delete from public.meeting_commands where meeting_id = p_meeting_id;
  delete from public.meeting_items where meeting_id = p_meeting_id;
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.transcript_turns where meeting_id = p_meeting_id;
  delete from public.meeting_speakers where meeting_id = p_meeting_id;

  insert into public.meeting_speakers (meeting_id, code, label, idx, is_host)
  select p_meeting_id, s.value ->> 'code', s.value ->> 'label', (s.ord - 1)::int,
         coalesce((s.value ->> 'isHost')::boolean, false)
  from jsonb_array_elements(p_speakers) with ordinality as s(value, ord);

  insert into public.transcript_turns (id, meeting_id, idx, speaker_code, start_sec, end_sec, text)
  select t.value ->> 'id', p_meeting_id, (t.ord - 1)::int, t.value ->> 'speaker',
         (t.value ->> 'startSec')::numeric, (t.value ->> 'endSec')::numeric, t.value ->> 'text'
  from jsonb_array_elements(p_turns) with ordinality as t(value, ord);

  if exists (
    select 1 from public.transcript_turns
    where meeting_id = p_meeting_id and end_sec > p_duration_sec
  ) then
    raise exception 'a turn ends after the meeting' using errcode = '23514';
  end if;

  update public.meetings
  set transcript_hash = p_hash, duration_sec = p_duration_sec, ai_headline = null,
      host_speaker_code = null, host_detected_by = null
  where id = p_meeting_id;

  update public.processing_jobs
  set status = 'failed', last_error = 'superseded by a new transcript', finished_at = now(),
      claim_token = null, lease_until = null
  where meeting_id = p_meeting_id and kind in ('detect_commands', 'analyze', 'summarize')
    and status in ('queued', 'running');

  if v_owner is null then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize');
  elsif exists (select 1 from public.operators o where o.user_id = v_owner) then
    insert into public.processing_jobs (meeting_id, kind) values (p_meeting_id, 'detect_commands');
  end if;

  return true;
end $$;

-- 8. Finishing a job: the new kind publishes through apply_commands(); when it fails for
--    good the chain still goes on, so the notes never wait on a parse that cannot work.
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
