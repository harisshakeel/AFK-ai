import type { Json } from "../../lib/database.types.ts";
import { AdapterError } from "../connectors/adapters/adapter.ts";
import { runAnswerInMeeting } from "./answer-in-meeting.ts";
import { ClaudeTimeoutError, ConfigurationError, ProviderUnavailableError } from "./claude.ts";
import type { ProcessingDeps } from "./config.ts";
import { runDetectCommands } from "./detect-commands.ts";
import {
  type Job,
  type JobResult,
  RefusedError,
  TransientError,
  isRefusal,
  runGeneration,
  runIngestMedia,
} from "./jobs.ts";
import { runLearn } from "./learn.ts";
import { runNotifyOwner } from "./notify-owner.ts";
import { runCommand } from "./run-command.ts";

/**
 * The job runner (NFR Import resilience): leases the next runnable job with claim_job(),
 * runs it, and finishes it with complete_job(), which publishes the output only while
 * the claim holds. It runs inside a web function with a time limit, so it takes jobs
 * only while its budget allows another one, and leases each for no longer than the
 * budget left plus a margin: a function cut off mid-job loses its lease soon after, and
 * the next kick picks the job up.
 *   - a provider outage or rate limit releases the job without using an attempt
 *   - a misconfiguration (no API key) releases the job and ends this run
 *   - a handler with nothing to publish (the meeting changed meanwhile) skips the job
 *   - output the database refuses (a check, a malformed payload, a raised exception) is
 *     rejected: the job fails for good at once, so the same refusal is not paid for
 *     three times; a store that broke for a reason a retry mends (a timeout, a lost
 *     connection) counts as an attempt
 *   - any other error counts as an attempt; the database retries with backoff, up to 3
 */
export const JOB_KINDS = [
  "ingest_media",
  "detect_commands",
  "analyze",
  "summarize",
  "learn",
  "answer_in_meeting",
  "run_command",
  "notify_owner",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Time to leave for finishing a job and answering, below the function's own limit. */
const HEADROOM_MS = 20_000;
/** No job is started with less than this left: a Claude call needs room to finish. */
const MIN_RUN_MS = 45_000;
/**
 * A Claude call given at least this long that still times out is too long for any run:
 * it uses an attempt. One given less was cut short by the run and is released.
 */
const FULL_CALL_MS = 200_000;
/** The lease outlives the budget by this much, so a cut-off job is freed promptly. */
const LEASE_MARGIN_SEC = 60;

type RunOptions = {
  /** Serve this meeting's jobs first. */
  meetingId?: string;
  kinds?: ReadonlyArray<JobKind>;
  /** Milliseconds this run may spend in all. */
  budgetMs: number;
  /** Aborted between jobs: the current job finishes, no other is claimed. */
  signal?: AbortSignal;
};

/**
 * Why a run ended: the queue was empty (idle), the budget ran out with work possibly
 * left (budget), or something a fresh function would not change (no API key, the
 * provider down, the database refusing the claim).
 */
export type StopReason =
  | "idle"
  | "budget"
  | "misconfigured"
  | "provider"
  | "claim_failed"
  /** The caller's signal asked for no more jobs. */
  | "stopped";

export type RunSummary = {
  ran: number;
  done: number;
  failed: number;
  released: number;
  stop: StopReason;
};

/**
 * Whether a run that stopped should hand the rest of the queue to a fresh function:
 * only a budget stop with work still due. A released job is due again only after its
 * retry time and a failing job spends its attempts, so a chain always ends.
 */
export function shouldChain(summary: Pick<RunSummary, "stop">, runnable: number): boolean {
  return summary.stop === "budget" && runnable > 0;
}

export async function runJobs(deps: ProcessingDeps, options: RunOptions): Promise<RunSummary> {
  const { db, config, log } = deps;
  const started = Date.now();
  const summary: RunSummary = { ran: 0, done: 0, failed: 0, released: 0, stop: "idle" };
  const remaining = () => options.budgetMs - (Date.now() - started) - HEADROOM_MS;

  for (;;) {
    if (options.signal?.aborted) {
      summary.stop = "stopped";
      break;
    }
    if (remaining() <= MIN_RUN_MS) {
      summary.stop = "budget";
      break;
    }
    const { data, error } = await db.rpc("claim_job", {
      p_worker_id: config.workerId,
      p_kinds: options.kinds ? [...options.kinds] : undefined,
      p_lease_seconds: Math.ceil(remaining() / 1000) + LEASE_MARGIN_SEC,
      p_meeting_id: options.meetingId,
    });
    if (error) {
      log("jobs.claim_failed", { code: error.code ?? "db_error" });
      summary.stop = "claim_failed";
      break;
    }
    const job = data?.[0];
    if (!job) break;
    summary.ran += 1;
    const jobStarted = Date.now();
    const fields = { jobId: job.id, kind: job.kind, meetingId: job.meeting_id };
    log("job.started", { ...fields, attempt: job.attempts });
    const timeoutMs = Math.max(10_000, remaining() - 5_000);
    try {
      const result = await handle(deps, job, timeoutMs);
      if (result === null) {
        // Nothing to publish: the meeting changed meanwhile. The job is over, not failed.
        const outcome = await complete(deps, job, "skipped", { report: { skipped: true } });
        log(outcome === "published" ? "job.skipped" : "job.discarded", {
          ...fields,
          ms: Date.now() - jobStarted,
        });
        continue;
      }
      const outcome = await complete(deps, job, "done", {
        payload: result.payload,
        report: result.report,
      });
      if (outcome === "published") {
        summary.done += 1;
        log("job.done", { ...fields, ms: Date.now() - jobStarted, ...flatten(result.report) });
      } else if (typeof outcome === "object") {
        // The database refused the output: running the job again would produce the same
        // output and the same refusal, so it ends here. Anything else is an attempt.
        const refused = isRefusal(outcome.code);
        await complete(deps, job, refused ? "rejected" : "failed", {
          error: `the output could not be stored (${outcome.code || "no code"})`,
          report: result.report,
        });
        summary.failed += 1;
        log("job.failed", { ...fields, reason: refused ? "store_refused" : "store" });
      } else {
        log("job.discarded", { ...fields, ms: Date.now() - jobStarted });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ConfigurationError) {
        await complete(deps, job, "release", {
          error: message,
          retryAt: new Date(Date.now() + 10 * 60_000),
        });
        summary.released += 1;
        summary.stop = "misconfigured";
        log("jobs.misconfigured", { jobId: job.id, reason: message });
        break;
      }
      if (error instanceof ClaudeTimeoutError) {
        if (timeoutMs >= FULL_CALL_MS) {
          await complete(deps, job, "failed", { error: message });
          summary.failed += 1;
          log("job.failed", { ...fields, reason: "timeout" });
          continue;
        }
        // Cut short by this run, not slow on its own: due again at once, and the run
        // stops as out of budget, so the chain hands it to a fresh function with the
        // whole budget (where a second timeout uses an attempt).
        await complete(deps, job, "release", { error: message, retryAt: new Date() });
        summary.released += 1;
        summary.stop = "budget";
        log("job.released", { ...fields, reason: "timeout in a short run" });
        break;
      }
      if (error instanceof ProviderUnavailableError) {
        await complete(deps, job, "release", { error: message, retryAt: error.retryAt });
        summary.released += 1;
        summary.stop = "provider";
        log("job.released", { ...fields, reason: message });
        break;
      }
      if (error instanceof RefusedError) {
        // The database refused the job's input before its output: same answer on retry.
        await complete(deps, job, "rejected", { error: message });
        summary.failed += 1;
        log("job.failed", { ...fields, reason: "store_refused" });
        continue;
      }
      if (error instanceof TransientError || (error instanceof AdapterError && error.retryable)) {
        // The service was unreachable before anything happened: later, no attempt used.
        await complete(deps, job, "release", {
          error: message,
          retryAt: new Date(Date.now() + 5 * 60_000),
        });
        summary.released += 1;
        log("job.released", { ...fields, reason: message });
      } else {
        await complete(deps, job, "failed", { error: message });
        summary.failed += 1;
        log("job.failed", { ...fields, reason: message.slice(0, 300) });
      }
    }
  }
  return summary;
}

async function handle(
  deps: ProcessingDeps,
  job: Job,
  timeoutMs: number,
): Promise<JobResult | null> {
  switch (job.kind) {
    case "analyze":
    case "summarize":
      return runGeneration(deps, job, job.kind, { timeoutMs });
    case "ingest_media":
      return runIngestMedia(deps, job, { timeoutMs });
    case "detect_commands":
      return runDetectCommands(deps, job, { timeoutMs });
    case "learn":
      return runLearn(deps, job, { timeoutMs });
    case "answer_in_meeting":
      return runAnswerInMeeting(deps, job, { timeoutMs });
    case "run_command":
      return runCommand(deps, job);
    case "notify_owner":
      return runNotifyOwner(deps, job);
    default:
      throw new Error(`unknown job kind ${job.kind}`);
  }
}

/**
 * published: the database took the outcome. lost: the claim no longer held (the
 * meeting was deleted, or the lease had expired and another run took the job). An
 * error: the call failed, with PostgREST's code (a SQLSTATE, a PGRST code, or none when
 * the request never got an answer). Finishing a job must never take the run down: the
 * lease still protects the job.
 */
type Completion = "published" | "lost" | { code: string };

/**
 * The SQLSTATE classes in which the database refused the data itself: a data exception
 * (22), a broken constraint (23), a raised exception or a missing row (P0). The same
 * output gets the same answer. A timeout, a deadlock or a lost connection does not.
 */
async function complete(
  deps: ProcessingDeps,
  job: Job,
  outcome: "done" | "skipped" | "failed" | "rejected" | "release",
  fields: {
    payload?: Json | null;
    error?: string;
    report?: Record<string, Json>;
    retryAt?: Date;
  } = {},
): Promise<Completion> {
  if (!job.claim_token) return "lost";
  const { data, error } = await deps.db.rpc("complete_job", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_outcome: outcome,
    p_payload: fields.payload ?? undefined,
    p_error: fields.error,
    p_report: fields.report,
    p_retry_at: fields.retryAt?.toISOString(),
  });
  if (error) {
    deps.log("job.complete_failed", { jobId: job.id, code: error.code ?? "db_error" });
    return { code: error.code ?? "" };
  }
  return data === true ? "published" : "lost";
}

/** Only the scalar parts of a report go into a log line; lists and nested objects stay in the database. */
function flatten(report: Record<string, Json>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(report)) {
    if (value === null || typeof value !== "object") out[key] = value;
  }
  return out;
}
