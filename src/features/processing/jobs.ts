import { z } from "zod";

import { AttendeeError, createAttendeeClient } from "../capture/attendee.ts";
import { convertAttendeeTranscript } from "../capture/attendee-transcript.ts";
import { transcriptHash } from "../meetings/transcript-hash.ts";
import type { Database, Json } from "../../lib/database.types.ts";
import { fetchAll as fetchAllRows } from "../../lib/fetch-all.ts";
import { analysisSchema, summariesSchema } from "../summaries/ai-output-schema.ts";
import { groundAnalysis, groundSummaries } from "../summaries/grounding.ts";
import {
  analysisInstruction,
  explicitItemsBlock,
  formatTranscript,
  summariesInstruction,
  type ExplicitItem,
} from "../summaries/prompts.ts";
import type { Db, ProcessingDeps } from "./config.ts";
import { loadMemory } from "./memory.ts";
import { probeRecording, RecordingReadError } from "./recording-probe.ts";
import { romanizeTurns } from "./romanize.ts";

export type Job = Database["public"]["Tables"]["processing_jobs"]["Row"];

/** Outcome of a job handler. The runner turns it into complete_job(). */
export type JobResult = { payload: Json | null; report: Record<string, Json> };

/** A failure that is not the job's fault (network, provider down): retry later, no attempt used. */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

/**
 * The database refused what a job tried to store (a check, bad input, a raised
 * exception): the same input would be refused the same way on every retry, so the runner
 * rejects the job at once instead of paying for it again.
 */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedError";
  }
}

/** A Postgres error code that means the data was refused, not that the store broke. */
export function isRefusal(code: string): boolean {
  return /^(22|23)[0-9A-Z]{3}$|^P0\d{3}$/.test(code);
}

/**
 * The error for a transcript ingest_transcript() did not take: a refusal ends the ingest
 * at once (each retry would fetch from Attendee and romanize again); a store that broke
 * for a reason a retry can mend uses an attempt.
 */
export function transcriptRejection(error: { code?: string; message: string }): Error {
  const message = `transcript was rejected: ${error.message}`;
  return isRefusal(error.code ?? "") ? new RefusedError(message) : new Error(message);
}

/** Every row of a paged query; a failed page is transient (the database, not the job). */
export const fetchAll = <T>(page: Parameters<typeof fetchAllRows<T>>[0]) =>
  fetchAllRows<T>(page, (message) => new TransientError(message));

/**
 * Right before a job's work leaves the system (a chat line, an email), ask
 * start_job_effect() whether this attempt may send it: "go" once per job, "done_before"
 * when an earlier attempt reached the send, "lost" when the claim no longer holds. A
 * gate that cannot be asked is transient: nothing has been sent yet.
 */
export async function startJobEffect(
  db: Db,
  job: Pick<Job, "id" | "claim_token">,
): Promise<"go" | "done_before" | "lost"> {
  if (!job.claim_token) return "lost";
  const { data, error } = await db.rpc("start_job_effect", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  if (error) throw new TransientError(`start_job_effect failed: ${error.message}`);
  return data === "go" || data === "done_before" ? data : "lost";
}

export async function loadMeeting(db: Db, meetingId: string) {
  const { data: meeting, error } = await db
    .from("meetings")
    .select(
      "id, owner_id, title, recorded_at, duration_sec, transcript_hash, status, bot_id, sender_names, analyzed_at, summarized_at",
    )
    .eq("id", meetingId)
    .maybeSingle();
  if (error) throw new TransientError(`database read failed: ${error.message}`);
  return meeting;
}

/** The items the host stated with commands, for the analysis prompt (requirement C3). */
async function loadExplicitItems(
  db: Db,
  meetingId: string,
  speakers: ReadonlyArray<{ code: string; label: string }>,
): Promise<ExplicitItem[]> {
  const { data, error } = await db
    .from("meeting_items")
    .select("kind, text, owner_speaker_code, owner_name, due_text")
    .eq("meeting_id", meetingId)
    .eq("source", "command")
    .order("idx");
  if (error) throw new TransientError(`items read failed: ${error.message}`);
  const isExplicitKind = (kind: string): kind is ExplicitItem["kind"] =>
    kind === "action" || kind === "decision" || kind === "note";
  const items: ExplicitItem[] = [];
  for (const row of data ?? []) {
    if (!isExplicitKind(row.kind)) continue;
    items.push({
      kind: row.kind,
      text: row.text,
      ownerLabel: row.owner_speaker_code
        ? (speakers.find((speaker) => speaker.code === row.owner_speaker_code)?.label ?? null)
        : row.owner_name,
      dueText: row.due_text,
    });
  }
  return items;
}

export async function loadTranscript(db: Db, meetingId: string) {
  const [speakers, turns] = await Promise.all([
    fetchAll((from, to) =>
      db
        .from("meeting_speakers")
        .select("code, label, is_host")
        .eq("meeting_id", meetingId)
        .order("idx")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from("transcript_turns")
        .select("id, speaker_code, start_sec, end_sec, text")
        .eq("meeting_id", meetingId)
        .order("idx")
        .range(from, to),
    ),
  ]);
  return {
    speakers: speakers.map((speaker) => ({
      code: speaker.code,
      label: speaker.label,
      isHost: speaker.is_host,
    })),
    turns: turns.map((turn) => ({
      id: turn.id,
      speaker: turn.speaker_code,
      startSec: Number(turn.start_sec),
      endSec: Number(turn.end_sec),
      text: turn.text,
    })),
  };
}

export type Transcript = Awaited<ReturnType<typeof loadTranscript>>;

/**
 * The transcript block every Claude run on a meeting sends first: byte-identical across
 * the analysis, the summaries, the command parse and the learned lines, so they read
 * one cached prefix.
 */
export function transcriptPrompt(
  meeting: { title: string; recorded_at: string | null; duration_sec: number | string | null },
  transcript: Transcript,
): string {
  return formatTranscript({
    title: meeting.title,
    recordedAt: meeting.recorded_at,
    durationSec: Number(meeting.duration_sec),
    speakers: transcript.speakers,
    turns: transcript.turns,
  });
}

/** Counts and timings for a job's report: never content. */
export function runReport(run: {
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
}): Record<string, Json> {
  return {
    model: run.model,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheReadTokens: run.cacheReadTokens,
    costUsd: run.costUsd,
  };
}

// ---------------------------------------------------------------------------------------
// analyze / summarize: one Claude call each, validated, grounded, then published.

export async function runGeneration(
  deps: ProcessingDeps,
  job: Job,
  kind: "analyze" | "summarize",
  options: { timeoutMs?: number } = {},
): Promise<JobResult | null> {
  const { db, claude } = deps;
  const meeting = await loadMeeting(db, job.meeting_id);
  if (!meeting || meeting.duration_sec === null || meeting.transcript_hash === null) return null;
  const transcript = await loadTranscript(db, meeting.id);

  if (transcript.turns.length === 0) {
    const empty =
      kind === "analyze"
        ? { headline: "", chapters: [], actions: [], decisions: [] }
        : { templates: [] };
    return { payload: empty, report: { turns: 0, note: "nothing was said" } };
  }

  // What the host told AFK about themselves (M7): owned meetings only; seed has no owner.
  // Items the host stated with a command (C3): already recorded, so the analysis is told
  // not to return them again.
  const [memory, explicit] = await Promise.all([
    meeting.owner_id ? loadMemory(db, meeting.owner_id).then((m) => m.block) : "",
    kind === "analyze" ? loadExplicitItems(db, meeting.id, transcript.speakers) : [],
  ]);
  const data = transcriptPrompt(meeting, transcript);
  const extra = memory + explicitItemsBlock(explicit);
  // Two calls that differ only in name, instruction and schema; the union keeps the
  // output typed by the schema that produced it.
  const call = { data, extra, timeoutMs: options.timeoutMs };
  const { data: output, run } =
    kind === "analyze"
      ? await claude.runStructured({
          ...call,
          name: "analysis",
          instruction: analysisInstruction(),
          schema: analysisSchema,
        })
      : await claude.runStructured({
          ...call,
          name: "summaries",
          instruction: summariesInstruction(),
          schema: summariesSchema,
        });
  const grounded =
    "chapters" in output ? groundAnalysis(output, transcript) : groundSummaries(output, transcript);

  const report: Record<string, Json> = {
    ...runReport(run),
    turns: transcript.turns.length,
    explicitItems: explicit.length,
    dropped: grounded.report.dropped,
    cleared: grounded.report.cleared,
  };

  return { payload: grounded.payload as unknown as Json, report };
}

// ---------------------------------------------------------------------------------------
// ingest_media: a bot meeting's transcript and recording, from Attendee into AFK.

/**
 * A failed read of the recording's header. A refusal uses an attempt, as Attendee's own
 * refusals do, so three of them end the ingest instead of releasing it for ever; an
 * outage, a rate limit, a timeout or a lost connection is retried without one.
 */
export function probeFailure(error: unknown): Error {
  const message = `recording read failed: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`;
  return error instanceof RecordingReadError && error.permanent
    ? new Error(message)
    : new TransientError(message);
}

/** The probe's few range requests; then the transcript and the publish need the rest. */
const PROBE_TIMEOUT_MS = 30_000;
const INGEST_TAIL_MS = 20_000;

export async function runIngestMedia(
  deps: ProcessingDeps,
  job: Job,
  options: { timeoutMs: number },
): Promise<JobResult | null> {
  const { db, config, claude, log } = deps;
  const meeting = await loadMeeting(db, job.meeting_id);
  if (!meeting || meeting.status !== "transcribed")
    return { payload: null, report: { skipped: "meeting not awaiting ingest" } };
  if (!meeting.bot_id) throw new Error("meeting has no bot");
  if (!config.attendee) {
    throw new TransientError(
      "ATTENDEE_API_KEY is not configured, so the recording cannot be fetched",
    );
  }

  const attendee = createAttendeeClient(config.attendee);
  const [utterances, recording] = await Promise.all([
    attendee.getTranscript(meeting.bot_id),
    attendee.getRecording(meeting.bot_id),
  ]).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // A refusal (bad key, unknown bot, no recording) or an unexpected shape will not
    // mend itself: that uses an attempt. Outages and rate limits are retried for free.
    const refused =
      error instanceof AttendeeError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429;
    if (refused || error instanceof z.ZodError) {
      throw new Error(`Attendee did not provide the recording: ${message.slice(0, 200)}`);
    }
    throw new TransientError(`Attendee fetch failed: ${message.slice(0, 200)}`);
  });

  // The recording stays at Attendee, where the page plays it from (media-url.ts); only
  // its length is read here, from the file's own header in a few small ranges. Cut off
  // in time, the job is released without an attempt for the next kick's full budget.
  const probeMs = Math.min(PROBE_TIMEOUT_MS, options.timeoutMs - INGEST_TAIL_MS);
  if (probeMs < 5_000) {
    throw new TransientError("not enough time left in this run to read the recording");
  }
  const probe = await probeRecording(recording.url, {
    signal: AbortSignal.timeout(probeMs),
  }).catch((error: unknown) => {
    throw probeFailure(error);
  });

  // The file's own length, else the last thing said plus a second.
  const spoken = utterances.reduce(
    (latest, utterance) => Math.max(latest, utterance.timestamp_ms + utterance.duration_ms),
    0,
  );
  const fromTranscript =
    recording.start_timestamp_ms && spoken > recording.start_timestamp_ms
      ? (spoken - recording.start_timestamp_ms) / 1000 + 1
      : null;
  const length = probe.durationSec ?? fromTranscript;
  if (length === null) {
    // No readable header, and nothing said to measure by: a one-second meeting would hide that.
    throw new Error(
      "could not read the recording's length (no header, and no speech to time it by)",
    );
  }
  const durationSec = Math.round(length * 1000) / 1000;

  const converted = convertAttendeeTranscript(
    meeting.id,
    utterances,
    recording.start_timestamp_ms,
    durationSec,
  );
  // Urdu or Hindi spoken in the call arrives in Devanagari (Deepgram's multilingual
  // model): those turns are rewritten in Roman Urdu before the transcript is stored
  // (romanize.ts). The only Claude call this job makes, and one it does without.
  const romanized = await romanizeTurns(claude, converted.turns, {
    timeoutMs: options.timeoutMs - probeMs - INGEST_TAIL_MS,
    log,
    meetingId: meeting.id,
  });
  const turns = romanized.turns;
  const hash = transcriptHash({ durationSec, speakers: converted.speakers, turns });
  const { error: ingestError } = await db.rpc("ingest_transcript", {
    p_meeting_id: meeting.id,
    p_duration_sec: durationSec,
    p_speakers: converted.speakers,
    p_turns: turns,
    p_hash: hash,
  });
  if (ingestError) {
    if (ingestError.code === "P0002") return null; // deleted meanwhile
    throw transcriptRejection(ingestError);
  }

  // The bot id is the recording's address at Attendee (media-url.ts mints links from it).
  const { data: published, error: finishError } = await db.rpc("finish_ingest", {
    p_meeting_id: meeting.id,
    p_video_ref: meeting.bot_id,
  });
  if (finishError)
    throw new TransientError(`could not publish the meeting: ${finishError.message}`);
  // Deleted or failed while we worked: nothing was written here to take back.
  if (!published) return null;
  return {
    payload: null,
    report: {
      turns: turns.length,
      speakers: converted.speakers.length,
      durationSec,
      bytes: probe.bytes,
      lengthFrom: probe.lengthFrom ?? "transcript",
      ...romanized.report,
    },
  };
}
