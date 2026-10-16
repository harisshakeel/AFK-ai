import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { createClaudeRunner, type ClaudeRunner } from "@/features/processing/claude";
import { buildProcessingConfig, type Db } from "@/features/processing/config";
import { runJobs, shouldChain, type JobKind, type RunSummary } from "@/features/processing/runner";
import { productionOrigin, serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { log } from "@/server/log";

/**
 * Processing runs inside the web app's own functions (there is no worker process): a route or
 * page that has reason to think a job is waiting kicks the runner after its response,
 * with the budget its function has. Every kick claims jobs under a lease, so two kicks
 * at once take different jobs and a cut-off kick loses its lease soon after.
 *
 * Who kicks: the Attendee webhook (a finished call, a live question), the meeting page
 * while its notes are queued, the typed-command and approval routes, the kick route
 * (`/api/jobs/kick`, for a pinger and for the chain), and the daily keep-alive for
 * anything left over. Set `maxDuration` to JOB_FUNCTION_SECONDS on each. A kick takes
 * any kind of job: claim_job() serves the kicked meeting first and live answers and
 * approved commands before notes, and a function with a full budget carries on with
 * whatever else is due.
 *
 * The chain: a run that used its whole budget with runnable jobs still waiting calls
 * the kick route once, so a fresh function carries on. Nothing then waits for a human
 * or for the daily cron; the chain ends when the queue is empty or when the runner
 * stopped for a reason a new function would not change (no API key, the provider
 * down).
 */
export const JOB_FUNCTION_SECONDS = 300;
/** What a kick may spend, under the function's limit: the response went out already. */
const KICK_BUDGET_MS = (JOB_FUNCTION_SECONDS - 30) * 1000;

export type KickOptions = {
  meetingId?: string;
  kinds?: ReadonlyArray<JobKind>;
  budgetMs?: number;
  /** Which link of a chain this run is, for the log; the first kick is 0. */
  hop?: number;
};

// One client and one runner per warm function instance: a kick reuses them.
let adminClient: Db | undefined;
let claudeRunner: ClaudeRunner | undefined;

function admin(): Db {
  // A job's calls can be long (a whole transcript in one statement): two minutes each.
  adminClient ??= createSupabaseAdminClient({ deadlineMs: 120_000 });
  return adminClient;
}

function claude(): ClaudeRunner {
  const env = serverEnv();
  claudeRunner ??= createClaudeRunner({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL });
  return claudeRunner;
}

/** Run what the budget allows, then hand the rest to a fresh function when there is a rest. */
export async function processAndChain(
  options: KickOptions = {},
): Promise<RunSummary & { chained: boolean }> {
  const db = admin();
  const summary = await runJobs(
    {
      db,
      config: buildProcessingConfig(
        `web-${process.env.VERCEL_REGION ?? "local"}-${randomUUID().slice(0, 8)}`,
        serverEnv(),
        productionOrigin(),
      ),
      claude: claude(),
      log: (event, fields) => log.info(event, fields),
    },
    {
      meetingId: options.meetingId,
      kinds: options.kinds,
      budgetMs: options.budgetMs ?? KICK_BUDGET_MS,
    },
  );
  const hop = options.hop ?? 0;
  if (summary.ran > 0 || summary.stop !== "idle") {
    log.info("jobs.run", { meetingId: options.meetingId, hop, ...summary });
  }
  let chained = false;
  if (summary.stop === "budget") {
    const status = await queueStatus(db);
    if (status && shouldChain(summary, status.runnable)) chained = await chain(options, hop + 1);
  }
  return { ...summary, chained };
}

/** Run the jobs after the response has gone out. Failures are logged, never thrown. */
export function kickJobs(options: KickOptions = {}): void {
  after(async () => {
    try {
      await processAndChain(options);
    } catch (error) {
      log.error("jobs.kick_failed", error, { meetingId: options.meetingId });
    }
  });
}

type QueueStatus = {
  /** Queued and due now. */
  runnable: number;
  /** Queued for later (a release's retry time). */
  scheduled: number;
  running: number;
  /** Failed for good in the last day. */
  failedDay: number;
  /** How long the oldest due job has been waiting. */
  oldestRunnableSec: number;
};

/** The queue in numbers, for the health route and the chain; null when it cannot be read. */
export async function queueStatus(db: Db): Promise<QueueStatus | null> {
  const { data, error } = await db.rpc("queue_status");
  const row = data?.[0];
  if (error || !row) {
    log.error("jobs.status_failed", new Error(error?.code ?? "db_error"));
    return null;
  }
  return {
    runnable: Number(row.runnable),
    scheduled: Number(row.scheduled),
    running: Number(row.running),
    failedDay: Number(row.failed_day),
    oldestRunnableSec: Number(row.oldest_runnable_sec),
  };
}

/**
 * The next link: one request to the production site's kick route, authorised with the
 * cron secret. The route answers at once and runs the jobs after its response, so this
 * function is free to end. The kicked meeting keeps its priority; the kinds do not
 * carry over, since a fresh function has a full budget for anything due.
 */
async function chain(options: KickOptions, hop: number): Promise<boolean> {
  const env = serverEnv();
  if (!env.CRON_SECRET) {
    log.warn("jobs.chain_unconfigured", { hop });
    return false;
  }
  try {
    const response = await fetch(new URL("/api/jobs/kick", productionOrigin()), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ meetingId: options.meetingId, hop }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) log.warn("jobs.chain_refused", { hop, status: response.status });
    else log.info("jobs.chained", { hop, status: response.status });
    return response.ok;
  } catch (error) {
    log.error("jobs.chain_failed", error, { hop });
    return false;
  }
}
