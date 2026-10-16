import { COMMAND_SELECT, toCommandView } from "@/features/commands/command-view";
import type { TaskRow } from "@/features/commands/tasks-queries";
import { EMPTY_SKILLS } from "@/features/memory/files";
import { loadSkillSettings } from "@/features/memory/memory-queries";
import { listConnectors, loadAddressBook } from "@/server/connectors/store";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { requireVisitor } from "@/server/http";

/**
 * The wrap-up (docs/data-flows.md §28): the caller's newest meeting whose notes are
 * written and which they have not yet closed with Done, with what the dialog shows:
 * the headline, the numbers, the cards waiting for approval and what their forms need.
 * With none, the nudge: a meeting already wrapped up whose cards have waited a day and
 * which has not been nudged for a day. Read as the caller under Row Level Security;
 * `{ meeting: null }` when nothing waits.
 */
export const dynamic = "force-dynamic";

const STALE_MS = 24 * 60 * 60 * 1000;

type MeetingRow = {
  id: string;
  title: string;
  ai_headline: string | null;
  recorded_at: string | null;
  duration_sec: number | string | null;
};

export async function GET() {
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const supabase = await createSupabaseServerClient();
  const none = Response.json({ meeting: null }, { headers: { "cache-control": "no-store" } });

  let mode: "wrap-up" | "nudge" = "wrap-up";
  const { data: fresh } = await supabase
    .from("meetings")
    .select("id, title, ai_headline, recorded_at, duration_sec")
    .eq("owner_id", visitor.userId)
    .eq("status", "ready")
    .not("summarized_at", "is", null)
    .is("reviewed_at", null)
    .order("recorded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  let meeting: MeetingRow | null = fresh;
  if (!meeting) {
    // The nudge: the oldest card that has waited a day, on a meeting not nudged for a day.
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    // The oldest stale cards, then their meetings (RLS already keeps both to the caller's).
    const { data: stale } = await supabase
      .from("meeting_commands")
      .select("meeting_id, created_at")
      .eq("status", "proposed")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(20);
    const meetingIds = [...new Set((stale ?? []).map((row) => row.meeting_id))];
    if (meetingIds.length > 0) {
      const { data: candidates } = await supabase
        .from("meetings")
        .select("id, title, ai_headline, recorded_at, duration_sec, nudged_at")
        .in("id", meetingIds)
        .eq("owner_id", visitor.userId)
        .or(`nudged_at.is.null,nudged_at.lt.${cutoff}`);
      const first = meetingIds.find((id) => candidates?.some((row) => row.id === id));
      const row = candidates?.find((candidate) => candidate.id === first);
      if (row) {
        mode = "nudge";
        meeting = row;
      }
    }
  }
  if (!meeting) return none;
  const chosen = meeting;

  const [actions, decisions, commands, connectors, addressBook, skills] = await Promise.all([
    supabase
      .from("meeting_items")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", chosen.id)
      .eq("kind", "action"),
    supabase
      .from("meeting_items")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", chosen.id)
      .eq("kind", "decision"),
    supabase
      .from("meeting_commands")
      .select(COMMAND_SELECT)
      .eq("meeting_id", chosen.id)
      .eq("status", "proposed")
      .order("created_at"),
    listConnectors(),
    loadAddressBook(),
    visitor.isAnonymous ? Promise.resolve(EMPTY_SKILLS) : loadSkillSettings(),
  ]);
  const waiting: TaskRow[] = (commands.data ?? []).map((row) => ({
    ...toCommandView(row),
    meetingId: chosen.id,
    meetingTitle: chosen.title,
    recordedAt: chosen.recorded_at,
  }));
  // A nudge with nothing left waiting has nothing to say.
  if (mode === "nudge" && waiting.length === 0) return none;
  return Response.json(
    {
      mode,
      meeting: {
        id: chosen.id,
        title: chosen.title,
        headline: chosen.ai_headline,
        recordedAt: chosen.recorded_at,
        durationSec: chosen.duration_sec === null ? null : Number(chosen.duration_sec),
        actions: actions.count ?? 0,
        decisions: decisions.count ?? 0,
      },
      waiting,
      connectors,
      addressBook,
      skills,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
