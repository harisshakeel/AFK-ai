-- import_generated() keeps the guard migration 7 gave it (and migration 30 copied over
-- from the original): exported output is loaded only while a job waits for it, so a
-- re-import never replaces items and never loses visitors' ticks on them. The marks a
-- meeting keeps of its generation are set with it.

create or replace function public.import_generated(
  p_meeting_id text, p_transcript_hash text, p_kind text, p_payload jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.meetings where id = p_meeting_id and transcript_hash = p_transcript_hash
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.processing_jobs
    where meeting_id = p_meeting_id and kind = p_kind and status in ('queued', 'failed')
  ) then
    return false;
  end if;
  if p_kind = 'analyze' then
    perform public.apply_analysis(p_meeting_id, p_payload);
    update public.meetings set analyzed_at = now() where id = p_meeting_id;
  elsif p_kind = 'summarize' then
    perform public.apply_summaries(p_meeting_id, p_payload);
    update public.meetings set summarized_at = now() where id = p_meeting_id;
  else
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;
  update public.processing_jobs
  set status = 'done', finished_at = now(), last_error = null,
      report = jsonb_build_object('source', 'data/ai export')
  where meeting_id = p_meeting_id and kind = p_kind and status in ('queued', 'failed');
  return true;
end $$;
