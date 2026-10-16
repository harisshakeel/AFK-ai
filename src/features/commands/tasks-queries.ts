import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase-server";

import { COMMAND_SELECT, toCommandView, type CommandView } from "./command-view";

/**
 * Every command AFK heard or was typed across the signed-in user's meetings (the Tasks
 * page), newest first. Read as the user: Row Level Security returns only their own
 * meetings' commands, so a visitor or another user gets nothing.
 */
export type TaskRow = CommandView & {
  meetingId: string;
  meetingTitle: string;
  recordedAt: string | null;
};

export const TASKS_LIMIT = 200;

export async function listTasks({ status }: { status?: CommandView["status"] } = {}): Promise<
  TaskRow[]
> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("meeting_commands")
    .select(`${COMMAND_SELECT}, meetings!inner(id, title, recorded_at)`)
    .order("created_at", { ascending: false })
    .limit(TASKS_LIMIT);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`could not load tasks: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...toCommandView(row),
    meetingId: row.meetings.id,
    meetingTitle: row.meetings.title,
    recordedAt: row.meetings.recorded_at,
  }));
}

/** How many cards wait for the caller's approval, and since when, for the sidebar's badge. */
export type Awaiting = { count: number; oldestAt: string | null };

export async function countAwaitingApproval(): Promise<Awaiting> {
  const supabase = await createSupabaseServerClient();
  const { data, count, error } = await supabase
    .from("meeting_commands")
    .select("created_at", { count: "exact" })
    .eq("status", "proposed")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return { count: 0, oldestAt: null };
  return { count: count ?? 0, oldestAt: data?.[0]?.created_at ?? null };
}
