import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { queueStatus } from "@/server/jobs";
import { log } from "@/server/log";

/**
 * Health, for an uptime monitor and for the owner: the queue in numbers, when the
 * keep-alive last ran, and which services are configured. Counts and times only; no
 * identifier, no content. 503 when the database cannot be read or a due job has waited
 * longer than STALE_QUEUE_SEC, which means no kick has reached it: the chain is broken
 * or the pinger is missing (docs/going-live.md).
 */
export const dynamic = "force-dynamic";

const STALE_QUEUE_SEC = 30 * 60;

export async function GET() {
  const env = serverEnv();
  // Counts only (queue_status, the last keep-alive): nothing of any user's leaves here.
  const admin = createSupabaseAdminClient();
  const [queue, lastKeepAlive] = await Promise.all([queueStatus(admin), lastCronRun(admin)]);
  const ok = queue !== null && queue.oldestRunnableSec < STALE_QUEUE_SEC;
  return Response.json(
    {
      ok,
      queue,
      lastKeepAlive,
      configured: {
        ai: Boolean(env.ANTHROPIC_API_KEY),
        bot: Boolean(env.ATTENDEE_API_KEY && env.ATTENDEE_WEBHOOK_SECRET),
        cron: Boolean(env.CRON_SECRET),
      },
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

async function lastCronRun(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<{ at: string; hoursAgo: number } | null> {
  const { data, error } = await admin
    .from("cron_runs")
    .select("ran_at")
    .eq("job", "keepalive")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    log.error("health.cron_read_failed", new Error(error.code ?? "db_error"));
    return null;
  }
  if (!data) return null;
  const hoursAgo = Math.round((Date.now() - Date.parse(data.ran_at)) / 360_000) / 10;
  return { at: data.ran_at, hoursAgo };
}
