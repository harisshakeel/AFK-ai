-- Connectors and execution (requirements-v2 X1, X2, X4, X5, X7, C7; design-v2 sections
-- 2.4, 2.7, 3): Gmail, Google Calendar and Slack. The host connects an app once; an
-- approved command becomes one run_command job, which the worker runs through an adapter
-- with the approved arguments and nothing else. At most once: a command has at most one
-- queued or running job, and the worker marks executed_at before it touches the outside
-- world, so a second attempt after a crash is refused unless the adapter is idempotent.
--
-- Secrets: refresh tokens and bot tokens are sealed by the app (AES-256-GCM under
-- CONNECTOR_TOKEN_KEY, held by the web server and the worker) before they reach the
-- database, and live in connector_secrets, which no user role can read. The database
-- alone cannot reveal a token. (Changed from the Vault design; the reason is in plan.md.)

-- 1. The connectors a user has, one per provider.
create table public.connectors (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('google', 'slack')),
  -- the Google email, or the Slack workspace name
  account         text not null check (length(account) between 1 and 200),
  -- the Google subject or the Slack team id
  external_id     text check (length(external_id) <= 200),
  scopes          text[] not null default '{}',
  -- non-secret settings: the Slack channel
  config          jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 4096),
  status          text not null default 'connected'
                  check (status in ('connected', 'expired', 'revoked')),
  connected_at    timestamptz not null default now(),
  last_used_at    timestamptz,
  -- Google refresh tokens expire after seven days while the OAuth app is in Testing
  expires_hint_at timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, provider)
);

create trigger connectors_set_updated_at
  before update on public.connectors
  for each row execute function public.set_updated_at();

alter table public.connectors enable row level security;

create policy "your connectors are yours to read"
  on public.connectors for select to authenticated
  using (owner_id = (select auth.uid())
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

revoke all on public.connectors from anon, authenticated;
grant select on public.connectors to authenticated;
grant all on public.connectors to service_role;

-- The sealed token. Row Level Security with no policy: only the service role reads it.
create table public.connector_secrets (
  connector_id uuid primary key references public.connectors (id) on delete cascade,
  ciphertext   text not null check (length(ciphertext) between 1 and 8192),
  updated_at   timestamptz not null default now()
);

alter table public.connector_secrets enable row level security;
revoke all on public.connector_secrets from anon, authenticated;
grant all on public.connector_secrets to service_role;

-- Connect, or reconnect: one transaction writes the row and its secret. A reconnect to
-- the same account keeps its settings (the Slack channel); a different account starts clean.
create or replace function public.store_connector(
  p_owner_id uuid, p_provider text, p_account text, p_external_id text, p_scopes text[],
  p_config jsonb, p_ciphertext text, p_expires_hint_at timestamptz default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.connectors
    (owner_id, provider, account, external_id, scopes, config, status, connected_at,
     last_used_at, expires_hint_at, revoked_at)
  values (p_owner_id, p_provider, left(p_account, 200), left(p_external_id, 200),
          coalesce(p_scopes, '{}'), coalesce(p_config, '{}'::jsonb), 'connected', now(),
          null, p_expires_hint_at, null)
  on conflict (owner_id, provider) do update
  set account = excluded.account,
      external_id = excluded.external_id,
      scopes = excluded.scopes,
      config = case
        when public.connectors.external_id is not distinct from excluded.external_id
          then public.connectors.config || excluded.config
        else excluded.config
      end,
      status = 'connected', connected_at = now(), last_used_at = null,
      expires_hint_at = excluded.expires_hint_at, revoked_at = null
  returning id into v_id;

  insert into public.connector_secrets (connector_id, ciphertext)
  values (v_id, p_ciphertext)
  on conflict (connector_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
  return v_id;
end $$;

revoke execute on function public.store_connector(uuid, text, text, text, text[], jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_connector(uuid, text, text, text, text[], jsonb, text, timestamptz)
  to service_role;

-- 2. Commands: three external kinds, the approved arguments, and the at-most-once mark.
alter table public.meeting_commands
  drop constraint meeting_commands_kind_check,
  add constraint meeting_commands_kind_check
    check (kind in ('task', 'decision', 'note', 'highlight', 'remember', 'email',
                    'followup', 'remind', 'slack', 'unknown')),
  -- what the owner confirmed on the card; the adapter runs with these and nothing else
  add column approved_args jsonb
    check (approved_args is null
           or (jsonb_typeof(approved_args) = 'object' and pg_column_size(approved_args) <= 8192)),
  -- set by the worker just before the adapter is called
  add column executed_at timestamptz;

-- 3. Jobs: run_command, keyed to its command.
alter table public.processing_jobs
  drop constraint processing_jobs_kind_check,
  add constraint processing_jobs_kind_check
    check (kind in ('ingest_media', 'detect_commands', 'analyze', 'summarize', 'run_command')),
  add column command_id uuid references public.meeting_commands (id) on delete cascade,
  add constraint processing_jobs_run_has_command
    check (kind <> 'run_command' or command_id is not null);

drop index public.processing_jobs_one_active;
-- At most one queued or running job of each per-meeting kind; at most one per command.
create unique index processing_jobs_one_active
  on public.processing_jobs (meeting_id, kind)
  where status in ('queued', 'running') and command_id is null;
create unique index processing_jobs_one_per_command
  on public.processing_jobs (command_id)
  where status in ('queued', 'running') and command_id is not null;

-- 4. apply_commands(): every external kind waits for approval. Same body as migration 12
--    but for the needs_approval expression.
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
              v_kind in ('email', 'followup', 'remind', 'slack'), left(v_cmd ->> 'error', 2000))
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

-- 5. Approval (C4, C7): stores what the owner confirmed and queues the one run job. A
--    failed command can be approved again only when the adapter never ran, or when the
--    adapter is idempotent (calendar events carry a client id).
drop function public.approve_command(uuid);

create function public.approve_command(p_command_id uuid, p_args jsonb default null)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_cmd public.meeting_commands;
begin
  select * into v_cmd from public.meeting_commands where id = p_command_id for update;
  if not found then
    return false;
  end if;
  if not (v_cmd.status = 'proposed'
          or (v_cmd.status = 'failed'
              and (v_cmd.executed_at is null or v_cmd.kind in ('followup', 'remind')))) then
    return false;
  end if;

  update public.meeting_commands
  set status = 'approved', approved_at = now(), error = null, finished_at = null,
      approved_args = coalesce(p_args, approved_args, args)
  where id = p_command_id;

  if v_cmd.needs_approval then
    insert into public.processing_jobs (meeting_id, kind, command_id, max_attempts)
    values (v_cmd.meeting_id, 'run_command', p_command_id,
            case when v_cmd.kind in ('followup', 'remind') then 3 else 1 end)
    on conflict do nothing;
  end if;
  return true;
end $$;

revoke execute on function public.approve_command(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.approve_command(uuid, jsonb) to service_role;

-- Dismissing also drops a run that has not started. A running one is left to finish.
create or replace function public.dismiss_command(p_command_id uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_item_id uuid;
  v_highlight_id uuid;
begin
  update public.meeting_commands
  set status = 'dismissed', finished_at = now()
  where id = p_command_id and status not in ('dismissed', 'running')
  returning item_id, highlight_id into v_item_id, v_highlight_id;
  if not found then
    return false;
  end if;
  delete from public.meeting_items where id = v_item_id;
  delete from public.highlights where id = v_highlight_id;
  update public.processing_jobs
  set status = 'failed', last_error = 'dismissed by the owner', finished_at = now(),
      claim_token = null, lease_until = null
  where command_id = p_command_id and status = 'queued';
  return true;
end $$;

-- 6. The at-most-once gate, called by the worker right before the adapter.
--    'go': run it. 'skip': dismissed meanwhile. 'ambiguous': an earlier attempt reached
--    the adapter and this kind cannot be retried safely. 'lost': the job claim is gone.
create or replace function public.start_command(p_command_id uuid, p_job_id uuid, p_claim_token uuid)
returns text language plpgsql set search_path = '' as $$
declare
  v_cmd public.meeting_commands;
begin
  if not exists (
    select 1 from public.processing_jobs
    where id = p_job_id and claim_token = p_claim_token and status = 'running'
      and command_id = p_command_id
  ) then
    return 'lost';
  end if;
  select * into v_cmd from public.meeting_commands where id = p_command_id for update;
  if not found or v_cmd.status not in ('approved', 'running') then
    return 'skip';
  end if;
  if v_cmd.executed_at is not null and v_cmd.kind not in ('followup', 'remind') then
    return 'ambiguous';
  end if;
  update public.meeting_commands
  set status = 'running', started_at = coalesce(started_at, now()), executed_at = now(),
      error = null
  where id = p_command_id;
  return 'go';
end $$;

revoke execute on function public.start_command(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_command(uuid, uuid, uuid) to service_role;

-- 7. The result: on the command, in history/actions.md, and the connector's last use.
--    payload: {"result": {...}, "line": "- [date time] ...", "provider": "google" | "slack"}
--    or {"skipped": true} when the command was dismissed before the run.
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
end $$;

revoke execute on function public.finish_command(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_command(uuid, jsonb) to service_role;

-- 8. claim_job(): run_command needs no Claude, so it serves every owner; a run whose
--    worker died mid-way fails its command rather than leaving it "running" for ever.
create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
begin
  with expired as (
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        last_error = 'lease expired (worker stopped mid-job)',
        claim_token = null, lease_until = null
    where status = 'running' and lease_until < now()
    returning meeting_id, kind, status, command_id
  ),
  failed_ingest as (
    update public.meetings m
    set status = 'failed',
        status_detail = 'The recording could not be processed. The worker stopped three times.'
    from expired e
    where e.meeting_id = m.id and e.kind = 'ingest_media' and e.status = 'failed'
      and m.status = 'transcribed'
    returning m.id
  )
  update public.meeting_commands c
  set status = 'failed', finished_at = now(),
      error = 'The worker stopped mid-way. Check the connected app before trying again.'
  from expired e
  where e.command_id = c.id and e.kind = 'run_command' and e.status = 'failed'
    and c.status = 'running';

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
      -- ingest and run_command run no AI, so they serve every owner; Claude runs serve
      -- seed and operators
      and (q.kind in ('ingest_media', 'run_command')
           or m.owner_id is null
           or exists (select 1 from public.operators o where o.user_id = m.owner_id))
    order by q.run_after, q.created_at
    limit 1
    for update of q skip locked
  )
  returning j.*;
end $$;

-- 9. complete_job(): the run_command outcome lands on the command.
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
    elsif v_job.kind = 'run_command' then
      perform public.finish_command(v_job.command_id, p_payload);
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
    if v_job.kind = 'run_command' then
      if v_job.attempts >= v_job.max_attempts then
        update public.meeting_commands
        set status = 'failed', error = left(p_error, 2000), finished_at = now()
        where id = v_job.command_id and status in ('running', 'approved');
      else
        update public.meeting_commands
        set status = 'approved', error = left(p_error, 2000)
        where id = v_job.command_id and status = 'running';
      end if;
    end if;
  elsif p_outcome = 'release' then
    update public.processing_jobs
    set status = 'queued', attempts = greatest(attempts - 1, 0),
        run_after = coalesce(p_retry_at, now() + interval '15 minutes'),
        claim_token = null, lease_until = null, last_error = left(p_error, 2000)
    where id = p_job_id;
    if v_job.kind = 'run_command' then
      update public.meeting_commands
      set status = 'approved', error = left(p_error, 2000)
      where id = v_job.command_id and status = 'running';
    end if;
  else
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  return true;
end $$;
