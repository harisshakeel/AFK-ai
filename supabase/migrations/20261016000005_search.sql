-- Search across meetings (requirement F8): transcripts, titles, summary points, action
-- items and decisions. security invoker, so the caller's RLS decides which meetings
-- appear. websearch_to_tsquery accepts anything a person types ("quoted phrases", -not,
-- or) without raising. Snippets mark matches with ⟦ ⟧, which the app turns into <mark>
-- elements as text, never as HTML.
create or replace function public.search_meetings(p_query text, p_limit integer default 60)
returns table (
  meeting_id   text,
  kind         text,
  ref_id       text,
  start_sec    numeric,
  speaker_code text,
  snippet      text,
  rank         real
)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_query, ''), 200)) as query
  ),
  hits as (
    select t.meeting_id, 'turn'::text as kind, t.id as ref_id, t.start_sec, t.speaker_code,
           ts_headline('english', t.text, q.query,
             'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=1') as snippet,
           ts_rank(t.tsv, q.query) as rank
    from public.transcript_turns t, q
    where t.tsv @@ q.query
    union all
    select i.meeting_id, i.kind, i.id::text,
           (select min(tt.start_sec)
              from public.item_citations c
              join public.transcript_turns tt on tt.meeting_id = c.meeting_id and tt.id = c.turn_id
             where c.item_id = i.id),
           null,
           ts_headline('english', i.text, q.query,
             'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=1'),
           -- what the AI concluded ranks a little above a passing mention
           ts_rank(i.tsv, q.query) * 1.5
    from public.meeting_items i, q
    where i.tsv @@ q.query
    union all
    select m.id, 'title', m.id, null, null,
           ts_headline('english', m.title, q.query, 'StartSel=⟦, StopSel=⟧, HighlightAll=true'),
           ts_rank(to_tsvector('english', m.title), q.query) * 2
    from public.meetings m, q
    where to_tsvector('english', m.title) @@ q.query
  )
  select * from hits
  order by rank desc, meeting_id, start_sec nulls first
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;

revoke execute on function public.search_meetings(text, integer) from public;
grant execute on function public.search_meetings(text, integer) to anon, authenticated, service_role;
