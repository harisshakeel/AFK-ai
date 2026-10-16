import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase-server";

import { isoWeek, type RecordInput } from "./afk-record";

/**
 * Everything the dashboard draws, all from the signed-in user's own rows (Row Level
 * Security): their meetings with each call's length and week, their items, their
 * commands, their highlights. The record (XP, level, streak, badges, the charts) is
 * computed from this in afk-record.ts. Nothing here is estimated.
 */
/** What a visitor with no workspace yet would have: nothing, counted honestly. */
export function emptyRecordInput(): RecordInput {
  return {
    meetings: 0,
    calls: [],
    decisions: 0,
    actions: 0,
    doneActions: 0,
    spokenCommands: 0,
    typedCommands: 0,
    doneCommands: 0,
    awaitingApproval: 0,
    highlights: 0,
    now: new Date(),
  };
}

export async function dashboardRecordInput(userId: string): Promise<RecordInput> {
  const supabase = await createSupabaseServerClient();
  const [meetings, actions, decisions, done, commands, highlights] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, title, duration_sec, recorded_at, status")
      .eq("owner_id", userId),
    supabase
      .from("meeting_items")
      .select("id, meetings!inner(owner_id)", { count: "exact", head: true })
      .eq("kind", "action")
      .eq("meetings.owner_id", userId),
    supabase
      .from("meeting_items")
      .select("id, meetings!inner(owner_id)", { count: "exact", head: true })
      .eq("kind", "decision")
      .eq("meetings.owner_id", userId),
    supabase
      .from("item_states")
      .select("item_id, meeting_items!inner(kind, meetings!inner(owner_id))", {
        count: "exact",
        head: true,
      })
      .eq("done", true)
      .eq("meeting_items.kind", "action")
      .eq("meeting_items.meetings.owner_id", userId),
    // The owner's commands only (RLS); a few hundred rows at most.
    supabase.from("meeting_commands").select("source, status"),
    supabase.from("highlights").select("id", { count: "exact", head: true }).eq("owner_id", userId),
  ]);
  for (const result of [meetings, actions, decisions, done, commands, highlights]) {
    if (result.error) throw new Error(`could not load the dashboard: ${result.error.message}`);
  }
  const rows = meetings.data ?? [];
  const commandRows = commands.data ?? [];
  const count = (test: (row: { source: string; status: string }) => boolean) =>
    commandRows.filter(test).length;
  return {
    meetings: rows.length,
    calls: rows
      .filter((row) => row.status === "ready" && row.recorded_at && row.duration_sec !== null)
      .map((row) => ({
        id: row.id,
        title: row.title,
        sec: Number(row.duration_sec),
        week: isoWeek(new Date(row.recorded_at as string)),
      })),
    decisions: decisions.count ?? 0,
    actions: actions.count ?? 0,
    doneActions: Math.min(actions.count ?? 0, done.count ?? 0),
    spokenCommands: count((row) => row.source === "spoken" || row.source === "live"),
    typedCommands: count((row) => row.source === "typed"),
    doneCommands: count((row) => row.status === "done"),
    awaitingApproval: count((row) => row.status === "proposed"),
    highlights: highlights.count ?? 0,
    now: new Date(),
  };
}
