import { z } from "zod";

import {
  highlightRange,
  parseNoteWords,
  parseRememberWords,
  parseSlackWords,
  parseTaskWords,
  parseTyped,
  turnAt,
} from "@/features/commands/parse";
import { commandSpec } from "@/features/commands/registry";
import { isTypedCommandCap, TYPED_CAP_MESSAGE } from "@/features/commands/typed-cap";
import { fetchAll } from "@/lib/fetch-all";
import { normaliseClip } from "@/lib/time-rules";
import type { Json } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";
import { kickJobs } from "@/server/jobs";
import { log } from "@/server/log";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/**
 * A typed command on the Tasks tab (requirement C5): the same `/task`, `/decision`,
 * `/note`, `/highlight`, `/remember` and `/email` as the spoken ones, applied with the
 * same rules. Internal kinds are parsed here, deterministically, and applied through
 * apply_commands(); an email draft needs the model, so it is recorded as "detected" and
 * the parse job is queued.
 */
type Context = { params: Promise<{ meetingId: string }> };

// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

const bodySchema = z.object({
  text: z.string().trim().min(2).max(1000),
  /** The playhead: the typed command is cited to the turn under it. */
  atSec: z.number().finite().min(0).optional(),
});

export async function POST(request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  // Guests own meetings too; only the memory command needs a Google account.
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  const parsed = parseTyped(body.data.text);
  if ("error" in parsed) return jsonError(400, parsed.error);
  if (parsed.kind === "remember" && visitor.isGuest) {
    return jsonError(
      403,
      "AFK keeps a memory only for people signed in with Google. Continue with Google to use /remember.",
    );
  }

  // Read as the visitor: only the owner's own meeting is found.
  const { data: meeting, error: meetingError } = await visitor.supabase
    .from("meetings")
    .select("id, owner_id, title, recorded_at, duration_sec, host_speaker_code")
    .eq("id", meetingId)
    .maybeSingle();
  if (meetingError) return dbFailure("meeting.read_failed", meetingError);
  if (!meeting || meeting.owner_id !== visitor.userId || meeting.duration_sec === null) {
    return jsonError(404, "Not found.");
  }
  const durationSec = Number(meeting.duration_sec);
  const atSec = Math.min(body.data.atSec ?? 0, durationSec);

  // Every turn, a page at a time: the long meeting has more than PostgREST returns at once.
  const read = await Promise.all([
    fetchAll((from, to) =>
      visitor.supabase
        .from("transcript_turns")
        .select("id, speaker_code, start_sec, end_sec")
        .eq("meeting_id", meeting.id)
        .order("idx")
        .range(from, to),
    ),
    visitor.supabase
      .from("meeting_speakers")
      .select("code, label")
      .eq("meeting_id", meeting.id)
      .order("idx"),
  ]).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (read instanceof Error) return failure("command.typed_read_failed", read, meetingId);
  const [turnRows, { data: speakerRows }] = read;
  const turns = turnRows.map((turn) => ({
    id: turn.id,
    speaker: turn.speaker_code,
    startSec: Number(turn.start_sec),
    endSec: Number(turn.end_sec),
  }));
  const speakers = speakerRows ?? [];
  const turnId = turnAt(turns, atSec);
  // The meeting was read as the visitor above and its owner checked: the admin client
  // writes the command rows and jobs, which visitors have no grant to insert.
  const admin = createSupabaseAdminClient();
  const sentence = body.data.text.trim();

  // The kinds that need the model: the row now, then the job, run right after this
  // response. A question is answered on the card (L2, after the call); a draft waits
  // for the parse, then approval.
  if (
    parsed.kind === "ask" ||
    parsed.kind === "recap" ||
    parsed.kind === "email" ||
    parsed.kind === "followup" ||
    parsed.kind === "remind"
  ) {
    const live = parsed.kind === "ask" || parsed.kind === "recap";
    const { data: row, error } = await admin
      .from("meeting_commands")
      .insert({
        meeting_id: meeting.id,
        turn_id: turnId,
        source: "typed",
        kind: parsed.kind,
        sentence,
        status: "detected",
        needs_approval: !live,
        ...(live ? { args: { question: parsed.rest.trim() || sentence } } : {}),
      })
      .select("id")
      .single();
    if (error) {
      if (isTypedCommandCap(error)) return jsonError(429, TYPED_CAP_MESSAGE);
      return failure("command.typed_insert_failed", error, meetingId);
    }
    const { error: jobError } = await admin.from("processing_jobs").insert(
      live
        ? {
            meeting_id: meeting.id,
            kind: "answer_in_meeting",
            command_id: row.id,
            max_attempts: 2,
          }
        : { meeting_id: meeting.id, kind: "detect_commands" },
    );
    // 23505 on the parse: one is queued, and will read this row, or running, and its
    // finish queues another for a row it did not see (migration 53, audit F8).
    if (jobError && (live || jobError.code !== "23505")) {
      return failure("command.typed_job_failed", jobError, meetingId);
    }
    log.info("command.typed", { meetingId, kind: parsed.kind });
    kickJobs({ meetingId: meeting.id });
    return Response.json({ commandId: row.id, status: "detected" }, { status: 201 });
  }

  const command: Record<string, unknown> = {
    source: "typed",
    turnId,
    kind: parsed.kind,
    sentence,
    status: "applied",
    args: {},
  };
  if (parsed.kind === "task") {
    const task = parseTaskWords(parsed.rest, speakers, meeting.host_speaker_code);
    command.args = task;
    command.item = task;
  } else if (parsed.kind === "decision" || parsed.kind === "note") {
    const text = parseNoteWords(parsed.rest);
    if (!text) return jsonError(400, `Say what to record after ${commandSpec(parsed.kind).slash}.`);
    command.args = { text };
    command.item = { text };
  } else if (parsed.kind === "highlight") {
    const range = turnId
      ? highlightRange(turns, turnId, meeting.host_speaker_code, durationSec)
      : null;
    if (!range) return jsonError(400, "Play to the moment you want to clip, then type /highlight.");
    // The clip ends at the playhead, not at the start of the turn under it, within the
    // same bounds as every other highlight (at most ten minutes, inside the recording).
    const clip = normaliseClip(
      { startSec: range.startSec, endSec: Math.max(range.startSec + 1, atSec) },
      durationSec,
    );
    command.args = clip;
    command.highlight = clip;
  } else if (parsed.kind === "slack") {
    // The message is the host's own words; the channel is confirmed on approval.
    const message = parseSlackWords(parsed.rest);
    if (!message) return jsonError(400, "Say what to post after /slack.");
    command.status = "proposed";
    command.args = { message };
  } else if (parsed.kind === "remember") {
    // The same line a spoken "AFK, remember: …" produces: dated, ending with the meeting,
    // appended under "Learned by AFK" in the file the words point to.
    const remember = parseRememberWords(parsed.rest, meeting.title, atSec, meeting.recorded_at);
    if (!remember) return jsonError(400, "Say what AFK should remember after /remember.");
    command.args = { text: remember.text, path: remember.path };
    command.memory = { path: remember.path, line: remember.line, template: remember.template };
  } else {
    return jsonError(400, `${commandSpec(parsed.kind).slash} isn't available yet.`);
  }

  // Ownership checked above; apply_typed_command() writes the command and what it creates
  // in one transaction, under the meeting's row lock, and returns the new row's id.
  const { data: commandId, error } = await admin.rpc("apply_typed_command", {
    p_meeting_id: meeting.id,
    p_command: command as unknown as Json,
  });
  if (error) {
    if (isTypedCommandCap(error)) return jsonError(429, TYPED_CAP_MESSAGE);
    if (error.code === "23514") return jsonError(400, "Those values aren't allowed.");
    return failure("command.typed_apply_failed", error, meetingId);
  }
  log.info("command.typed", { meetingId, kind: parsed.kind });
  return Response.json({ commandId, status: command.status }, { status: 201 });
}

function failure(event: string, error: { code?: string; message: string }, meetingId: string) {
  log.error(event, new Error(error.code ?? "db_error"), { meetingId });
  return jsonError(500, "That didn't save. Try again.");
}
