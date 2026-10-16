import type { CommandStatus } from "@/features/commands/command-view";
import type { GenerationState } from "@/features/summaries/notes-panel";

/**
 * Where a meeting's notes stand, from its job rows, and what the page does about it:
 * kick the runner when a job can be claimed, and refresh itself while work is under way.
 */
export type JobRow = { kind: string; status: string; updated_at: string };

/** Queued this long, nothing has reached the job: something is holding it up. */
const QUEUED_STALE_AFTER_MS = 15 * 60_000;
/**
 * Running this long, the function working on it was cut off: every job function lives
 * at most 300 s and its lease outlives the budget by 60 s, so the lease has run out and
 * the next claim takes the job back. A running row changes only when it finishes.
 */
const RUNNING_STALE_AFTER_MS = 6 * 60_000;

/** The analyze and summarize states, from job rows newest first. */
export function generationStates(jobRows: ReadonlyArray<JobRow>, nowMs: number): GenerationState[] {
  // An owned meeting is parsed for commands before its notes are written: while that
  // runs, the notes count as queued. No job at all means nothing was ever asked for.
  const parsing = jobRows.find(
    (job) =>
      job.kind === "detect_commands" && (job.status === "queued" || job.status === "running"),
  );
  const latest = (kind: "analyze" | "summarize"): GenerationState => {
    const job =
      jobRows.find((candidate) => candidate.kind === kind) ??
      (parsing ? { ...parsing, status: "queued" } : undefined);
    const status = (job?.status as GenerationState["status"] | undefined) ?? "none";
    const updatedAt = job?.updated_at ?? null;
    const age = updatedAt === null ? 0 : nowMs - Date.parse(updatedAt);
    return {
      kind,
      status,
      updatedAt,
      stale:
        (status === "queued" && age > QUEUED_STALE_AFTER_MS) ||
        (status === "running" && age > RUNNING_STALE_AFTER_MS),
    };
  };
  return [latest("analyze"), latest("summarize")];
}

/**
 * Whether the page should run the meeting's jobs after it renders: a recording to fetch,
 * a queued job, or a running one whose function was cut off. A job another function is
 * working on is left to it.
 */
export function needsKick(
  meetingStatus: string,
  generation: ReadonlyArray<GenerationState>,
): boolean {
  return (
    meetingStatus === "transcribed" ||
    generation.some(
      (state) => state.status === "queued" || (state.status === "running" && state.stale),
    )
  );
}

/** Commands that change by themselves: a draft being written, an approved run. */
const MOVING: ReadonlySet<CommandStatus> = new Set(["detected", "approved", "running"]);

/** Whether something on a ready meeting's page will change without the visitor doing anything. */
export function hasPendingWork(
  generation: ReadonlyArray<GenerationState>,
  commands: ReadonlyArray<{ status: CommandStatus }>,
): boolean {
  return (
    generation.some((state) => state.status === "queued" || state.status === "running") ||
    commands.some((command) => MOVING.has(command.status))
  );
}
