-- AI for every signed-in user, behind one switch (docs/going-live.md, part 2).
--
-- Off (the default), Claude runs only for seed meetings and for operators, because the
-- worker runs Claude under the owner's subscription, whose terms are for the owner's own
-- use. On, every signed-in user's meeting gets notes, commands, learned lines and live
-- answers. The switch is meant to be turned on only once the worker holds a Claude Console
-- API key (ANTHROPIC_API_KEY), which bills each run at API prices to the owner's account.
-- Only the service role can read or flip it; users can ask whether it applies to them.

-- app_settings exists since the hardening migration (key text, value text, service role
-- only); the switch is one more row in it.
insert into public.app_settings (key, value) values ('ai_for_everyone', 'false')
on conflict (key) do nothing;

create or replace function public.ai_for_everyone()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    (select s.value::boolean from public.app_settings s where s.key = 'ai_for_everyone'),
    false);
$$;
revoke execute on function public.ai_for_everyone() from public, anon, authenticated;
grant execute on function public.ai_for_everyone() to service_role;

/** Whether a meeting owned by p_owner (null = seed) may cause Claude runs. */
create or replace function public.ai_enabled_for(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner is null
      or exists (select 1 from public.operators o where o.user_id = p_owner)
      or public.ai_for_everyone();
$$;
revoke execute on function public.ai_enabled_for(uuid) from public, anon, authenticated;
grant execute on function public.ai_enabled_for(uuid) to service_role;

/** The caller's own answer: signed in, not anonymous, and covered by the gate. */
create or replace function public.ai_enabled_for_me()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and (select auth.uid()) is not null
     and public.ai_enabled_for((select auth.uid()));
$$;
revoke execute on function public.ai_enabled_for_me() from public;
grant execute on function public.ai_enabled_for_me() to anon, authenticated, service_role;

/** The switch. Service role only: run it from the SQL editor or a trusted script. */
create or replace function public.set_ai_for_everyone(p_on boolean)
returns boolean language sql set search_path = '' as $$
  insert into public.app_settings (key, value)
  values ('ai_for_everyone', case when p_on then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value
  returning value::boolean;
$$;
revoke execute on function public.set_ai_for_everyone(boolean) from public, anon, authenticated;
grant execute on function public.set_ai_for_everyone(boolean) to service_role;

-- The three places that decide who gets Claude runs now ask the gate.

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
      -- whoever the gate allows (seed, operators, everyone once the switch is on)
      and (q.kind in ('ingest_media', 'run_command') or public.ai_enabled_for(m.owner_id))
    order by q.run_after, q.created_at
    limit 1
    for update of q skip locked
  )
  returning j.*;
end $$;

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
  delete from public.live_utterances where meeting_id = p_meeting_id;

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
  where meeting_id = p_meeting_id
    and kind in ('detect_commands', 'analyze', 'summarize', 'learn')
    and status in ('queued', 'running');

  if v_owner is null then
    insert into public.processing_jobs (meeting_id, kind)
    values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize');
  elsif public.ai_enabled_for(v_owner) then
    insert into public.processing_jobs (meeting_id, kind) values (p_meeting_id, 'detect_commands');
  end if;

  return true;
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
      insert into public.processing_jobs (meeting_id, kind)
      select m.id, 'learn'
      from public.meetings m
      where m.id = v_job.meeting_id
        and m.owner_id is not null
        and public.ai_enabled_for(m.owner_id)
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
