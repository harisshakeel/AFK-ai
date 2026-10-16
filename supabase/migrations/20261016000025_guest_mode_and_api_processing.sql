-- Guest mode and processing inside the web app (decisions):
--
--   1. The worker is gone. Jobs are run by the web app's own functions (the webhook, the
--      meeting page's refresh, the command routes, the daily keep-alive), each claiming
--      jobs with a lease that matches its own time limit. claim_job() takes the meeting
--      the caller is working on, so a page kick serves its own meeting first, and runs
--      live answers and approved commands before long notes.
--   2. Anyone may send the bot: an anonymous identity (a "guest") owns meetings like a
--      Google user. Guests have no memory files (append_memory_lines refuses them) and no
--      learned lines (complete_job queues none), so nothing of theirs is prepended to a
--      prompt and nothing is kept once they are gone.
--   3. A guest who never links a Google account is purged after thirty days with
--      everything they own; the keep-alive removes their audio first (stale_guest_audio)
--      and then the users (purge_stale_guests), which cascades.
--   4. A bot recording over the storage cap keeps its transcript and notes: "ready" no
--      longer requires an audio path.

-- 1. The lease and the queue order. The old signature goes so the generated types list one.
drop function if exists public.claim_job(text, text[], integer);

create or replace function public.claim_job(
  p_worker_id text, p_kinds text[] default null, p_lease_seconds integer default 1800,
  p_meeting_id text default null)
returns setof public.processing_jobs
language plpgsql set search_path = '' as $$
begin
  with expired as (
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        finished_at = case when attempts >= max_attempts then now() end,
        last_error = 'lease expired (the processor stopped mid-job)',
        claim_token = null, lease_until = null
    where status = 'running' and lease_until < now()
    returning meeting_id, kind, status, command_id
  ),
  failed_ingest as (
    update public.meetings m
    set status = 'failed',
        status_detail = 'The recording could not be processed after three attempts.'
    from expired e
    where e.meeting_id = m.id and e.kind = 'ingest_media' and e.status = 'failed'
      and m.status = 'transcribed'
    returning m.id
  )
  update public.meeting_commands c
  set status = 'failed', finished_at = now(),
      error = 'The run stopped mid-way. Check the connected app before trying again.'
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
    where q.status = 'queued' and q.run_after <= now()
      and (p_kinds is null or q.kind = any (p_kinds))
    order by
      (p_meeting_id is not null and q.meeting_id = p_meeting_id) desc,
      (q.kind in ('answer_in_meeting', 'run_command')) desc,
      q.run_after, q.created_at
    limit 1
    for update skip locked
  )
  returning j.*;
end $$;

revoke execute on function public.claim_job(text, text[], integer, text) from public, anon, authenticated;
grant execute on function public.claim_job(text, text[], integer, text) to service_role;

-- 2. Guests have no memory: AFK's appends are refused for an anonymous owner, and the
--    chain queues no learn job for their meetings. is_guest() is the one reader of
--    auth.users for the user roles (security definer, service role only).
create or replace function public.is_guest(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = p_user_id), false);
$$;
revoke execute on function public.is_guest(uuid) from public, anon, authenticated;
grant execute on function public.is_guest(uuid) to service_role;

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
  if public.is_guest(p_owner_id) then
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
      v_user_zone := left(v_content, v_pos - 1);
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
      -- The chain's last link (M3): learned lines, for meetings owned by a Google user.
      -- A guest has no memory files, so nothing is learned for them.
      insert into public.processing_jobs (meeting_id, kind)
      select m.id, 'learn' from public.meetings m
      where m.id = v_job.meeting_id and m.owner_id is not null
        and not public.is_guest(m.owner_id)
      on conflict do nothing;
    elsif v_job.kind = 'detect_commands' then
      perform public.apply_commands(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'learn' then
      perform public.apply_learned(v_job.meeting_id, p_payload);
    elsif v_job.kind = 'answer_in_meeting' then
      perform public.finish_live_answer(v_job.command_id, p_payload);
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
    if v_job.kind = 'answer_in_meeting' and v_job.attempts >= v_job.max_attempts then
      update public.meeting_commands
      set status = 'failed', error = left(p_error, 2000), finished_at = now()
      where id = v_job.command_id and status = 'detected';
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

-- 3. Retention: guests who never linked a Google account, with everything they own.
create or replace function public.stale_guest_audio(p_older_than interval default interval '30 days')
returns setof text language sql stable security definer set search_path = '' as $$
  select m.audio_path
  from public.meetings m
  join auth.users u on u.id = m.owner_id
  where u.is_anonymous and u.created_at < now() - p_older_than and m.audio_path is not null;
$$;

create or replace function public.purge_stale_guests(p_older_than interval default interval '30 days')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with gone as (
    delete from auth.users u
    where u.is_anonymous and u.created_at < now() - p_older_than
    returning u.id
  )
  select count(*) into v_count from gone;
  return v_count;
end $$;

revoke execute on function public.stale_guest_audio(interval) from public, anon, authenticated;
revoke execute on function public.purge_stale_guests(interval) from public, anon, authenticated;
grant execute on function public.stale_guest_audio(interval) to service_role;
grant execute on function public.purge_stale_guests(interval) to service_role;

alter table public.cron_runs
  add column purged integer not null default 0 check (purged >= 0);

-- 4. A meeting is ready once its transcript is in; the audio may be missing (a bot
--    recording over the storage cap). The page says so and plays nothing.
alter table public.meetings drop constraint meetings_ready_is_complete;
alter table public.meetings add constraint meetings_ready_is_complete check (
  status <> 'ready' or (duration_sec is not null and transcript_hash is not null)
);

create or replace function public.finish_ingest(p_meeting_id text, p_audio_path text default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.meetings
  set audio_path = p_audio_path, status = 'ready', status_detail = null
  where id = p_meeting_id and status = 'transcribed';
  return found;
end $$;
