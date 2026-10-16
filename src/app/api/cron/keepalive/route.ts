import { z } from "zod";

import { createAttendeeClient } from "@/features/capture/attendee";
import { autoJoinFromCalendars } from "@/server/calendar-autojoin";
import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { jsonError, requireCronSecret } from "@/server/http";
import { JOB_FUNCTION_SECONDS, processAndChain } from "@/server/jobs";
import { log } from "@/server/log";

/**
 * Daily keep-alive (NFR Availability): Supabase Free pauses a project after a week with
 * no activity, which would take the demo down. Vercel Cron calls this once a day with
 * `Authorization: Bearer $CRON_SECRET`; it runs one real query and leaves a row in
 * `cron_runs`, so whether it ran can be read from the database, not only from Vercel.
 * Housekeeping rides along: the write-limit log is pruned, finished jobs and stale live
 * utterances are pruned, bots that never reported back are closed, guests who never
 * linked a Google account are purged after thirty days (the rows first, then their
 * audio, then Attendee is told to forget their bots), and any job still waiting is run
 * with the time that is left, chaining to a fresh function when that is not enough.
 */
// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

export async function GET(request: Request) {
  const started = Date.now();
  const refused = requireCronSecret(request);
  if (refused) return refused;
  // The keep-alive is our own server task, not a visitor's request.
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("meetings")
    .select("id", { count: "exact", head: true });
  if (error) {
    log.error("cron.keepalive_failed", new Error(error.code ?? "db_error"));
    return jsonError(503, "Database unavailable.");
  }
  // Housekeeping while we are here: the write-limit log only prunes a visitor's own rows
  // when they write again, so departed visitors' rows would otherwise stay for good.
  const pruned = await admin
    .from("visitor_writes")
    .delete({ count: "exact" })
    .lt("at", new Date(Date.now() - 60_000).toISOString());
  if (pruned.error) log.error("cron.prune_failed", new Error(pruned.error.code ?? "db_error"));
  // A bot whose webhook never came: closed after six hours (F9), so the owner can send
  // the next one.
  const sweep = await admin.rpc("sweep_stale_bots");
  if (sweep.error) log.error("cron.sweep_failed", new Error(sweep.error.code ?? "db_error"));
  const swept = sweep.data ?? 0;
  // The three retention jobs are independent; the windows are the SQL defaults
  // (thirty days for guests and finished jobs, a day for live utterances).
  const [purged, jobsPruned, utterancesPruned, scheduled] = await Promise.all([
    purgeStaleGuests(admin),
    prune(admin, "prune_finished_jobs"),
    prune(admin, "prune_live_utterances"),
    // Calendar auto-join: bots scheduled for the next day and a half of
    // meetings of the people who asked for it.
    autoJoinFromCalendars(admin),
    // PIN tries on meeting links older than a day.
    prune(admin, "prune_link_tries"),
  ]);
  const trace = await admin.from("cron_runs").insert({
    job: "keepalive",
    meetings: count ?? 0,
    pruned: pruned.count ?? 0,
    swept,
    purged,
    jobs_pruned: jobsPruned,
    utterances_pruned: utterancesPruned,
  });
  if (trace.error) log.error("cron.trace_failed", new Error(trace.error.code ?? "db_error"));
  log.info("cron.keepalive", {
    meetings: count ?? 0,
    pruned: pruned.count ?? 0,
    swept,
    purged,
    jobsPruned,
    utterancesPruned,
    scheduled,
  });

  // Anything still queued (a chain that broke, a job released by an outage).
  const budgetMs = (JOB_FUNCTION_SECONDS - 30) * 1000 - (Date.now() - started);
  const jobs = budgetMs > 60_000 ? await processAndChain({ budgetMs }) : null;
  return Response.json({ ok: true, meetings: count ?? 0, swept, purged, jobs });
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function prune(
  admin: Admin,
  fn: "prune_finished_jobs" | "prune_live_utterances" | "prune_link_tries",
): Promise<number> {
  const { data, error } = await admin.rpc(fn);
  if (error) {
    log.error("cron.prune_failed", new Error(error.code ?? "db_error"), { kind: fn });
    return 0;
  }
  return data ?? 0;
}

const purgeResultSchema = z.object({
  users: z.number().int().nonnegative(),
  audio_paths: z.array(z.string().min(1)),
  bot_ids: z.array(z.string().min(1)),
});

/**
 * Guests (anonymous identities) older than the retention window who never continued
 * with Google, except one whose bot is still in a call. The rows go first (deleting the
 * user cascades them) and the audio objects after, from the paths the purge returns: a
 * removal that fails is then a leak in storage to log, never a meeting pointing at a
 * file that is gone. Attendee, which holds their bots' recordings and transcripts, is
 * then told to forget each bot. Returns how many users went.
 */
async function purgeStaleGuests(admin: Admin): Promise<number> {
  const purged = await admin.rpc("purge_stale_guests");
  if (purged.error) {
    log.error("cron.purge_failed", new Error(purged.error.code ?? "db_error"));
    return 0;
  }
  const result = purgeResultSchema.safeParse(purged.data);
  if (!result.success) {
    log.error("cron.purge_failed", new Error("unexpected purge result"));
    return 0;
  }
  const paths = result.data.audio_paths;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const removed = await admin.storage.from("audio").remove(batch);
    if (removed.error) {
      log.error("cron.guest_audio_remove_failed", removed.error, { count: batch.length });
    }
  }
  const env = serverEnv();
  if (env.ATTENDEE_API_KEY && result.data.bot_ids.length > 0) {
    const attendee = createAttendeeClient({
      apiKey: env.ATTENDEE_API_KEY,
      baseUrl: env.ATTENDEE_API_URL,
    });
    const outcomes = await Promise.allSettled(
      result.data.bot_ids.map((botId) => attendee.deleteData(botId)),
    );
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    if (failed > 0) {
      log.error("cron.guest_bot_forget_failed", new Error("delete_data refused"), {
        count: failed,
      });
    }
  }
  return result.data.users;
}
