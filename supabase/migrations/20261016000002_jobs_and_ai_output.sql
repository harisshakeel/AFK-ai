-- Operators, processing jobs and AI output (requirements F0, F3, F4, F5, F9; NFRs Headless
-- Claude, Import resilience, AI grounding).
--
-- Who may cause a Claude run: only seed meetings (owner_id is null) and meetings owned by
-- an operator. claim_job() enforces this, so a job row for anyone else is never picked up.
--
-- Job lifecycle: queued -> running (leased) -> done | failed. A running job whose lease
-- expires goes back to queued, or to failed once max_attempts is used up. A worker can
-- only finish a job while it still holds the claim (claim_token), so a late or duplicate
-- worker can never overwrite newer output or bring back a deleted meeting.

-- Operators: allowlisted people who may send the bot. Rows are added by hand with the
-- service role once the person has signed in (no personal data in the repository).
create table public.operators (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.operators enable row level security;
revoke all on public.operators from anon, authenticated;
grant all on public.operators to service_role;

create or replace function public.is_operator()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.operators o where o.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_operator() from public;
grant execute on function public.is_operator() to anon, authenticated, service_role;

create table public.processing_jobs (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   text not null references public.meetings (id) on delete cascade,
  -- ingest_media: fetch a bot meeting's transcript and recording
  -- analyze: chapters, action items, decisions and the headline
  -- summarize: every summary template
  kind         text not null check (kind in ('ingest_media', 'analyze', 'summarize')),
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after    timestamptz not null default now(),
  lease_until  timestamptz,
  claim_token  uuid,
  worker_id    text check (length(worker_id) <= 100),
  last_error   text check (length(last_error) <= 2000),
  -- counts and timings only, never transcript text
  report       jsonb,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  updated_at   timestamptz not null default now(),
  constraint processing_jobs_running_has_lease check (
    status <> 'running' or (lease_until is not null and claim_token is not null)
  )
);

-- At most one queued or running job of each kind per meeting.
create unique index processing_jobs_one_active
  on public.processing_jobs (meeting_id, kind) where status in ('queued', 'running');
create index processing_jobs_queued_idx
  on public.processing_jobs (run_after) where status = 'queued';
create index processing_jobs_meeting_idx on public.processing_jobs (meeting_id);

create trigger processing_jobs_set_updated_at
  before update on public.processing_jobs
  for each row execute function public.set_updated_at();

-- Chapters store only where they start; a chapter ends where the next one starts, or at
-- the meeting's duration_sec (derived, never stored).
create table public.chapters (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    text not null references public.meetings (id) on delete cascade,
  idx           integer not null check (idx >= 0),
  title         text not null check (length(title) between 1 and 120),
  first_turn_id text not null,
  constraint chapters_meeting_idx_unique unique (meeting_id, idx),
  constraint chapters_first_turn_fk foreign key (meeting_id, first_turn_id)
    references public.transcript_turns (meeting_id, id)
);

-- Everything the AI states about a meeting: summary points (per template and section),
-- action items and decisions. Each one cites at least one turn through item_citations.
create table public.meeting_items (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id         text not null references public.meetings (id) on delete cascade,
  kind               text not null check (kind in ('point', 'action', 'decision')),
  -- summary points only: which template and which section of it
  template_key       text check (template_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  section_idx        integer check (section_idx >= 0),
  section            text check (length(section) between 1 and 80),
  idx                integer not null check (idx >= 0),
  text               text not null check (length(text) between 1 and 1000),
  -- action items only. The owner is a speaker in the meeting, or a name said in a cited
  -- turn, or neither ("No owner mentioned"); never both. due_text is quoted as said.
  owner_speaker_code text,
  owner_name         text check (length(owner_name) between 1 and 80),
  due_text           text check (length(due_text) between 1 and 80),
  tsv                tsvector generated always as (to_tsvector('english', text)) stored,
  constraint meeting_items_point_fields check (
    (kind = 'point') = (template_key is not null and section_idx is not null and section is not null)
  ),
  constraint meeting_items_action_fields check (
    kind = 'action' or (owner_speaker_code is null and owner_name is null and due_text is null)
  ),
  constraint meeting_items_one_owner check (owner_speaker_code is null or owner_name is null),
  constraint meeting_items_order_unique unique nulls not distinct
    (meeting_id, kind, template_key, section_idx, idx),
  constraint meeting_items_owner_speaker_fk foreign key (meeting_id, owner_speaker_code)
    references public.meeting_speakers (meeting_id, code)
);

create index meeting_items_meeting_idx on public.meeting_items (meeting_id, kind);
create index meeting_items_tsv_idx on public.meeting_items using gin (tsv);

-- Normalized citations: the database guarantees every citation names a real turn of the
-- same meeting. No cascade from turns: turns are only replaced by ingest_transcript(),
-- which deletes the items first.
create table public.item_citations (
  item_id    uuid not null references public.meeting_items (id) on delete cascade,
  meeting_id text not null,
  turn_id    text not null,
  primary key (item_id, turn_id),
  constraint item_citations_turn_fk foreign key (meeting_id, turn_id)
    references public.transcript_turns (meeting_id, id)
);

create index item_citations_turn_idx on public.item_citations (meeting_id, turn_id);

-- An item and its citations must belong to the same meeting.
create or replace function public.item_citations_same_meeting()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meeting_items i where i.id = new.item_id and i.meeting_id = new.meeting_id
  ) then
    raise exception 'citation % points outside its item''s meeting', new.turn_id
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger item_citations_same_meeting
  before insert or update on public.item_citations
  for each row execute function public.item_citations_same_meeting();

-- RLS: AI output is readable with its meeting; jobs are visible to the meeting's owner
-- (so the page can say "Generating" or "Processor offline"). No write policies anywhere.
alter table public.processing_jobs enable row level security;
alter table public.chapters enable row level security;
alter table public.meeting_items enable row level security;
alter table public.item_citations enable row level security;

create policy "jobs are visible with their meeting"
  on public.processing_jobs for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

create policy "chapters follow their meeting"
  on public.chapters for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

create policy "items follow their meeting"
  on public.meeting_items for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

create policy "citations follow their meeting"
  on public.item_citations for select to anon, authenticated
  using (public.can_read_meeting(meeting_id));

revoke all on public.processing_jobs, public.chapters, public.meeting_items, public.item_citations
  from anon, authenticated;
grant select (id, meeting_id, kind, status, attempts, max_attempts, run_after, created_at,
              started_at, finished_at, updated_at)
  on public.processing_jobs to anon, authenticated;
grant select on public.chapters, public.meeting_items, public.item_citations
  to anon, authenticated;
grant all on public.processing_jobs, public.chapters, public.meeting_items, public.item_citations
  to service_role;

-- ---------------------------------------------------------------------------------------
-- Writing generated output. Internal helpers, called only from the RPCs below.

-- payload: {"headline": text, "chapters": [{"title", "firstTurnId"}],
--           "actions": [{"text", "ownerSpeaker"?, "ownerName"?, "dueText"?, "turnIds": []}],
--           "decisions": [{"text", "turnIds": []}]}
create or replace function public.apply_analysis(p_meeting_id text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_ord bigint;
  v_kind text;
  v_id uuid;
begin
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.meeting_items where meeting_id = p_meeting_id and kind in ('action', 'decision');

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

-- payload: {"templates": [{"key", "sections": [{"heading", "points": [{"text", "turnIds": []}]}]}]}
create or replace function public.apply_summaries(p_meeting_id text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_template jsonb;
  v_section jsonb;
  v_section_ord bigint;
  v_point jsonb;
  v_point_ord bigint;
  v_id uuid;
begin
  delete from public.meeting_items where meeting_id = p_meeting_id and kind = 'point';

  for v_template in select value from jsonb_array_elements(coalesce(p_payload -> 'templates', '[]'::jsonb))
  loop
    for v_section, v_section_ord in
      select value, ord from jsonb_array_elements(v_template -> 'sections') with ordinality as s(value, ord)
    loop
      for v_point, v_point_ord in
        select value, ord from jsonb_array_elements(v_section -> 'points') with ordinality as p(value, ord)
      loop
        if jsonb_array_length(coalesce(v_point -> 'turnIds', '[]'::jsonb)) = 0 then
          raise exception 'summary point cites no turn' using errcode = '23514';
        end if;
        insert into public.meeting_items
          (meeting_id, kind, template_key, section_idx, section, idx, text)
        values (p_meeting_id, 'point', v_template ->> 'key', (v_section_ord - 1)::int,
                v_section ->> 'heading', (v_point_ord - 1)::int, v_point ->> 'text')
        returning id into v_id;
        insert into public.item_citations (item_id, meeting_id, turn_id)
        select distinct v_id, p_meeting_id, t.value
        from jsonb_array_elements_text(v_point -> 'turnIds') as t(value);
      end loop;
    end loop;
  end loop;
end $$;

revoke execute on function public.apply_analysis(text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_summaries(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- RPCs for the worker and the seed import (service role only).

-- Replace a meeting's transcript in one transaction. Returns false when the transcript
-- is unchanged (same hash), so re-running an import is a no-op. A changed transcript
-- removes everything generated from the old one and queues fresh generation.
-- p_speakers: [{"code", "label"}] in order of first appearance.
-- p_turns: [{"id", "speaker", "startSec", "endSec", "text"}] ordered by (startSec, endSec).
create or replace function public.ingest_transcript(
  p_meeting_id text, p_duration_sec numeric, p_speakers jsonb, p_turns jsonb, p_hash text)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_hash text;
begin
  select transcript_hash into v_hash from public.meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'meeting % does not exist', p_meeting_id using errcode = 'P0002';
  end if;
  if v_hash is not distinct from p_hash then
    return false;
  end if;

  delete from public.meeting_items where meeting_id = p_meeting_id;
  delete from public.chapters where meeting_id = p_meeting_id;
  delete from public.transcript_turns where meeting_id = p_meeting_id;
  delete from public.meeting_speakers where meeting_id = p_meeting_id;

  insert into public.meeting_speakers (meeting_id, code, label, idx)
  select p_meeting_id, s.value ->> 'code', s.value ->> 'label', (s.ord - 1)::int
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
  set transcript_hash = p_hash, duration_sec = p_duration_sec, ai_headline = null
  where id = p_meeting_id;

  -- Fresh generation for the new transcript; an older queued or running job of the same
  -- kind is retired so its output (keyed to the old turns) can never be published.
  update public.processing_jobs
  set status = 'failed', last_error = 'superseded by a new transcript', finished_at = now(),
      claim_token = null, lease_until = null
  where meeting_id = p_meeting_id and kind in ('analyze', 'summarize')
    and status in ('queued', 'running');
  insert into public.processing_jobs (meeting_id, kind)
  values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize');

  return true;
end $$;

-- Lease the oldest runnable job. Expired leases are recovered first. Only seed meetings
-- and operator meetings are eligible.
create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
begin
  update public.processing_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      finished_at = case when attempts >= max_attempts then now() end,
      last_error = 'lease expired (worker stopped mid-job)',
      claim_token = null, lease_until = null
  where status = 'running' and lease_until < now();

  return query
  update public.processing_jobs j
  set status = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = now(), worker_id = p_worker_id
  where j.id = (
    select q.id
    from public.processing_jobs q
    join public.meetings m on m.id = q.meeting_id
    where q.status = 'queued' and q.run_after <= now()
      and (p_kinds is null or q.kind = any (p_kinds))
      and (m.owner_id is null or exists (select 1 from public.operators o where o.user_id = m.owner_id))
    order by q.run_after, q.created_at
    limit 1
    for update of q skip locked
  )
  returning j.*;
end $$;

-- Finish a claimed job. Returns false, changing nothing, when the claim no longer holds
-- (lease reclaimed, job retired, or the meeting and its jobs were deleted): the worker
-- then discards its output.
-- p_outcome:
--   done    - publish p_payload for the job's kind, mark done
--   failed  - a real failure: retry with backoff until max_attempts, then failed
--   release - not the job's fault (usage limit, network): requeue at p_retry_at without
--             using up an attempt
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

-- Load AI output that was generated earlier and exported to data/ai/ (seed meetings), so
-- a fresh database needs no Claude run. Applies only if the transcript is the one the
-- output was generated from; marks the matching queued job done.
create or replace function public.import_generated(
  p_meeting_id text, p_transcript_hash text, p_kind text, p_payload jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meetings where id = p_meeting_id and transcript_hash = p_transcript_hash
  ) then
    return false;
  end if;
  if p_kind = 'analyze' then
    perform public.apply_analysis(p_meeting_id, p_payload);
  elsif p_kind = 'summarize' then
    perform public.apply_summaries(p_meeting_id, p_payload);
  else
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;
  update public.processing_jobs
  set status = 'done', finished_at = now(), last_error = null,
      report = jsonb_build_object('source', 'data/ai export')
  where meeting_id = p_meeting_id and kind = p_kind and status = 'queued';
  return true;
end $$;

-- After the worker uploads a bot meeting's audio: publish it, unless the meeting was
-- deleted or failed meanwhile (then the worker removes the uploaded object).
create or replace function public.finish_ingest(p_meeting_id text, p_audio_path text)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.meetings
  set audio_path = p_audio_path, status = 'ready', status_detail = null
  where id = p_meeting_id and status = 'transcribed';
  return found;
end $$;

-- The webhook's single write. Moves a recording bot's meeting on and queues the ingest.
-- Returns the meeting id, or null for a replay, an out-of-order event or a deleted
-- meeting (the webhook then answers 200 and does nothing). Never inserts a meeting.
create or replace function public.mark_bot_finished(
  p_bot_id text, p_succeeded boolean, p_detail text default null)
returns text language plpgsql set search_path = '' as $$
declare
  v_meeting_id text;
begin
  update public.meetings
  set status = case when p_succeeded then 'transcribed' else 'failed' end,
      status_detail = left(p_detail, 500)
  where bot_id = p_bot_id and status in ('requested', 'recording')
  returning id into v_meeting_id;
  if v_meeting_id is not null and p_succeeded then
    insert into public.processing_jobs (meeting_id, kind)
    values (v_meeting_id, 'ingest_media')
    on conflict do nothing;
  end if;
  return v_meeting_id;
end $$;

revoke execute on function public.ingest_transcript(text, numeric, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.claim_job(text, text[], integer) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, uuid, text, jsonb, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.import_generated(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_ingest(text, text) from public, anon, authenticated;
revoke execute on function public.mark_bot_finished(text, boolean, text) from public, anon, authenticated;
grant execute on function public.ingest_transcript(text, numeric, jsonb, jsonb, text) to service_role;
grant execute on function public.claim_job(text, text[], integer) to service_role;
grant execute on function public.complete_job(uuid, uuid, text, jsonb, text, jsonb, timestamptz) to service_role;
grant execute on function public.import_generated(text, text, text, jsonb) to service_role;
grant execute on function public.finish_ingest(text, text) to service_role;
grant execute on function public.mark_bot_finished(text, boolean, text) to service_role;
grant execute on function public.apply_analysis(text, jsonb) to service_role;
grant execute on function public.apply_summaries(text, jsonb) to service_role;
