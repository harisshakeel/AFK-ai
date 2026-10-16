import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase-server";

/**
 * Search across meetings (requirement F8): one call to search_meetings(), which runs as
 * the visitor so RLS limits it to meetings they can read, then grouped by meeting.
 */
export type SearchHit = {
  kind: "turn" | "point" | "action" | "decision" | "note" | "title";
  refId: string;
  startSec: number | null;
  speakerLabel: string | null;
  /** Text with matches wrapped in ⟦ ⟧ by Postgres; rendered as <mark> elements. */
  snippet: string;
};

export type SearchGroup = {
  meetingId: string;
  title: string;
  recordedAt: string | null;
  hits: SearchHit[];
};

/** The most hits one search returns; past it the page says "120+". */
export const SEARCH_LIMIT = 120;

export async function searchMeetings(
  query: string,
  { ownOnly = false }: { ownOnly?: boolean } = {},
): Promise<SearchGroup[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_meetings", {
    p_query: query,
    p_limit: SEARCH_LIMIT,
    // Signed in, the list shows only your own meetings; search matches it.
    p_own_only: ownOnly,
  });
  if (error) throw new Error(`search failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const meetingIds = [...new Set(data.map((hit) => hit.meeting_id))];
  const [meetings, speakers] = await Promise.all([
    supabase.from("meetings").select("id, title, recorded_at").in("id", meetingIds),
    supabase
      .from("meeting_speakers")
      .select("meeting_id, code, label")
      .in("meeting_id", meetingIds),
  ]);
  if (meetings.error) throw new Error(`search failed: ${meetings.error.message}`);
  const labelOf = new Map(
    (speakers.data ?? []).map((speaker) => [
      `${speaker.meeting_id}:${speaker.code}`,
      speaker.label,
    ]),
  );

  // Groups keep the order of their best hit (the RPC sorts by rank).
  const groups = new Map<string, SearchGroup>();
  for (const hit of data) {
    const meeting = meetings.data.find((candidate) => candidate.id === hit.meeting_id);
    if (!meeting) continue;
    const group = groups.get(hit.meeting_id) ?? {
      meetingId: meeting.id,
      title: meeting.title,
      recordedAt: meeting.recorded_at,
      hits: [],
    };
    group.hits.push({
      kind: hit.kind as SearchHit["kind"],
      refId: hit.ref_id,
      startSec: hit.start_sec === null ? null : Number(hit.start_sec),
      speakerLabel: hit.speaker_code
        ? (labelOf.get(`${hit.meeting_id}:${hit.speaker_code}`) ?? null)
        : null,
      snippet: hit.snippet,
    });
    groups.set(hit.meeting_id, group);
  }
  return [...groups.values()];
}
