import { createAttendeeClient } from "../capture/attendee.ts";
import {
  answerInstruction,
  answerSchema,
  formatAnswerInput,
  groundAnswer,
  type ContextLine,
} from "../commands/answer.ts";
import type { Db, ProcessingDeps } from "./config.ts";
import {
  TransientError,
  fetchAll,
  loadTranscript,
  runReport,
  startJobEffect,
  type Job,
  type JobResult,
} from "./jobs.ts";
import { loadMemory, speaksInCalls } from "./memory.ts";

/**
 * answer_in_meeting (requirement L2): a host's live question or recap. The answer comes
 * from what the bot has heard so far (or, after the call, from the final transcript),
 * cites the moment, and goes to the meeting chat; it is spoken too when the host's
 * profile says "AFK speaks in calls: yes" (L3) and Attendee has speech credentials.
 * Whatever happens with the chat, the answer lands on the command's card. An answer
 * with no surviving citation is replaced by the fixed line, so a planted sentence
 * cannot steer what the bot says in the host's name.
 */
const NOT_DISCUSSED = "That wasn't discussed yet.";

export async function runAnswerInMeeting(
  deps: ProcessingDeps,
  job: Job,
  options: { timeoutMs?: number } = {},
): Promise<JobResult | null> {
  const { db, claude, config } = deps;
  if (!job.command_id) throw new Error("answer_in_meeting job has no command");
  const { data: command, error } = await db
    .from("meeting_commands")
    .select(
      "id, meeting_id, kind, status, sentence, args, meetings!inner(title, owner_id, bot_id, status)",
    )
    .eq("id", job.command_id)
    .maybeSingle();
  if (error) throw new TransientError(`database read failed: ${error.message}`);
  // Answered, dismissed or gone meanwhile: nothing to do.
  if (!command || command.status !== "detected") return null;
  if (command.kind !== "ask" && command.kind !== "recap") {
    throw new Error(`kind ${command.kind} is not a live question`);
  }
  const ownerId = command.meetings.owner_id;
  if (!ownerId) throw new Error("the meeting has no owner");

  const [lines, memory] = await Promise.all([
    contextLines(db, command.meeting_id),
    loadMemory(db, ownerId),
  ]);
  const args = (command.args ?? {}) as { question?: unknown };
  const question =
    typeof args.question === "string" && args.question.trim()
      ? args.question.trim()
      : command.sentence;
  const { data, run } = await claude.runStructured({
    name: "answer",
    data: formatAnswerInput(question, lines),
    extra: memory.block,
    instruction: answerInstruction(command.kind),
    schema: answerSchema,
    maxTokens: 2_000,
    timeoutMs: Math.min(options.timeoutMs ?? 120_000, 120_000),
  });
  const grounded = groundAnswer(data, lines);
  // Nothing goes into the call that the lines heard so far do not support.
  const text = grounded.cited.length > 0 ? grounded.text : NOT_DISCUSSED;

  // Into the call, while the bot is still there, once: an attempt after one that
  // reached the chat (and then failed or was cut off), or after the webhook's fallback
  // line went out (claim_live_fallback), answers on the card only. A failed post is not
  // the answer's failure: the card keeps it.
  let posted = false;
  let spoken = false;
  const botId = command.meetings.bot_id;
  const inCall = Boolean(botId && command.meetings.status === "recording" && config.attendee);
  const gate = inCall ? await startJobEffect(db, job) : null;
  if (gate === "lost") return null;
  const postedBefore = gate === "done_before";
  if (botId && config.attendee && gate === "go") {
    const attendee = createAttendeeClient(config.attendee);
    try {
      await attendee.sendChatMessage(botId, text);
      posted = true;
    } catch {
      posted = false;
    }
    if (posted && speaksInCalls(memory)) {
      try {
        await attendee.speak(botId, text);
        spoken = true;
      } catch {
        spoken = false;
      }
    }
  }
  return {
    payload: { kind: "answer", text, posted, spoken, cited: grounded.cited },
    report: {
      ...runReport(run),
      lines: lines.length,
      cited: grounded.cited.length,
      droppedCitations: grounded.dropped,
      uncited: grounded.cited.length === 0,
      posted,
      spoken,
      ...(postedBefore ? { postedBefore } : {}),
    },
  };
}

/** What has been heard so far: live utterances during the call, the transcript after it. */
async function contextLines(db: Db, meetingId: string): Promise<ContextLine[]> {
  const live = await fetchAll((from, to) =>
    db
      .from("live_utterances")
      .select("seq, speaker_name, is_host, timestamp_ms, text")
      .eq("meeting_id", meetingId)
      .order("seq")
      .range(from, to),
  );
  if (live.length > 0) {
    const start = live[0]!.timestamp_ms;
    return live.map((row) => ({
      seq: Number(row.seq),
      atSec: Math.max(0, (Number(row.timestamp_ms) - Number(start)) / 1000),
      speaker: row.speaker_name || (row.is_host ? "Host" : "Someone"),
      text: row.text,
    }));
  }
  const transcript = await loadTranscript(db, meetingId);
  const labels = new Map(transcript.speakers.map((speaker) => [speaker.code, speaker.label]));
  return transcript.turns.map((turn, index) => ({
    seq: index,
    atSec: turn.startSec,
    speaker: labels.get(turn.speaker) ?? turn.speaker,
    text: turn.text,
  }));
}
