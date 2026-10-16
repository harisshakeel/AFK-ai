-- The wrap-up (owner's call: "approvals should come up as a pop, and how was
-- the meeting, after every meeting, so they don't get ignored"). Once a meeting's notes
-- are written, the next page the owner opens shows a dialog: the headline, the numbers,
-- the cards waiting for approval, and "How was the meeting?". It comes back on every
-- visit until the owner closes it with Done, which records the review here; a rating is
-- optional and is the owner's verdict on the notes, kept for our own evaluation.

alter table public.meetings
  add column reviewed_at timestamptz,
  add column rating text check (rating in ('good', 'bad')),
  add column review_note text check (length(review_note) <= 300);

comment on column public.meetings.reviewed_at is
  'When the owner closed the wrap-up dialog for this meeting; null while it should still pop up.';

-- The one query the prompt makes on every page: the owner's newest unreviewed, written-up meeting.
create index meetings_wrap_up on public.meetings (owner_id, recorded_at desc)
  where reviewed_at is null and status = 'ready' and summarized_at is not null;

-- As the caller: only the meeting's owner, only a ready meeting. A rating given stands;
-- Done without one keeps whatever was there.
create function public.review_meeting(
  p_meeting_id text, p_rating text default null, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_rating is not null and p_rating not in ('good', 'bad') then
    raise exception 'rating must be good or bad' using errcode = '22023';
  end if;
  update public.meetings
  set reviewed_at = now(),
      rating = coalesce(p_rating, rating),
      review_note = coalesce(nullif(left(trim(p_note), 300), ''), review_note)
  where id = p_meeting_id and owner_id = auth.uid() and status = 'ready';
  return found;
end $$;

revoke execute on function public.review_meeting(text, text, text) from public, anon;
grant execute on function public.review_meeting(text, text, text) to authenticated, service_role;
