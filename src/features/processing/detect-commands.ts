import { commandParseSchema } from "../commands/ai-schema.ts";
import { detectCommands } from "../commands/detect.ts";
import { fillEmailNames, hostName } from "../commands/fill-names.ts";
import { linkUrl } from "../meeting-link/link-code.ts";
import { findSender, senderNames } from "../commands/sender.ts";
import { groundCommandParse, isModelKind } from "../commands/grounding.ts";
import {
  highlightRange,
  parseNoteWords,
  parseRememberWords,
  parseSlackWords,
  parseTaskWords,
} from "../commands/parse.ts";
import {
  commandsInstruction,
  formatCommandsExtra,
  type CommandForPrompt,
} from "../commands/prompts.ts";
import type { CommandKind } from "../commands/registry.ts";
import type { Json } from "../../lib/database.types.ts";
import type { Db, ProcessingDeps } from "./config.ts";
import { skillsBlock } from "../memory/files.ts";
import { loadMemory } from "./memory.ts";
import {
  TransientError,
  loadMeeting,
  loadTranscript,
  runReport,
  transcriptPrompt,
  type Job,
  type JobResult,
} from "./jobs.ts";

/**
 * detect_commands (requirements-v2 C1-C3, C8): find the sender's "AFK, …" sentences in a
 * finished transcript, apply the ones that need no model word for word (decision, note,
 * highlight), and call Claude once for the rest (tasks, email drafts), grounding what it
 * returns. The result is one payload for apply_commands(), which also queues the
 * analysis so the chain goes on.
 */
const SPOKEN_CAP = 20;

type PayloadCommand = {
  id?: string;
  turnId: string | null;
  source: "spoken" | "typed";
  kind: CommandKind | "unknown";
  sentence: string;
  status: "applied" | "proposed" | "unparsed" | "skipped";
  args: Record<string, Json>;
  error?: string;
  item?: {
    text: string;
    ownerSpeaker?: string | null;
    ownerName?: string | null;
    dueText?: string | null;
  };
  highlight?: { startSec: number; endSec: number };
  memory?: { path: string; line: string; template: string };
};

/** Whether the meeting's owner is a guest (no memory files): the database knows. */
async function ownerIsGuest(db: Db, ownerId: string | null): Promise<boolean> {
  if (!ownerId) return false;
  const { data, error } = await db.rpc("is_guest", { p_user_id: ownerId });
  if (error) throw new TransientError(`could not read the owner: ${error.message}`);
  return data === true;
}

export async function runDetectCommands(
  deps: ProcessingDeps,
  job: Job,
  options: { timeoutMs?: number } = {},
): Promise<JobResult | null> {
  const { db, claude, config } = deps;
  const meeting = await loadMeeting(db, job.meeting_id);
  if (!meeting || meeting.duration_sec === null || meeting.transcript_hash === null) return null;
  // Everything the parse needs, in one round: the transcript, whether the owner is a
  // guest (a guest has no memory files, so "AFK, remember" has nowhere to go), and the
  // commands already recorded: the ones waiting for the model (a draft typed on the
  // Tasks tab, or one the host sent back with a note), and the spoken ones an earlier
  // pass applied. The caps keep these to a few dozen rows.
  const [transcript, isGuest, recorded] = await Promise.all([
    loadTranscript(db, meeting.id),
    ownerIsGuest(db, meeting.owner_id),
    db
      .from("meeting_commands")
      .select("id, source, kind, status, sentence, turn_id, args")
      .eq("meeting_id", meeting.id)
      .in("source", ["spoken", "typed"])
      .limit(100),
  ]);
  if (recorded.error) throw new TransientError(`database read failed: ${recorded.error.message}`);
  const durationSec = Number(meeting.duration_sec);
  const waiting = (recorded.data ?? []).filter((row) => row.status === "detected");
  // A spoken command is recorded once (apply_commands() keeps the first); one an earlier
  // pass recorded is not parsed, or paid for, again. One sent back for a rewrite waits
  // among the detected rows and is parsed there, by its id.
  const spokenKey = (turnId: string, kind: string) => `${kind}:${turnId}`;
  const recordedSpoken = new Set(
    (recorded.data ?? []).flatMap((row) =>
      row.source === "spoken" && row.turn_id ? [spokenKey(row.turn_id, row.kind)] : [],
    ),
  );

  // Whose words are commands: the person who sent AFK, found by the names stored with
  // the meeting, else the only speaker. The platform's host flag marks the organiser,
  // not the sender, and is not consulted.
  const names = senderNames(meeting.sender_names ?? []);
  const sender = findSender(transcript.speakers, names);
  const host = sender ? { speakerCode: sender.code, detectedBy: sender.by } : null;
  const hostCodes = new Set(sender ? [sender.code] : []);
  const hostCode = host?.speakerCode ?? null;
  const hostLabel = transcript.speakers.find((speaker) => speaker.code === hostCode)?.label ?? null;

  const found = detectCommands(transcript.turns, hostCodes);
  const spoken = found.slice(0, SPOKEN_CAP);
  const commands: PayloadCommand[] = [];
  const forModel: CommandForPrompt[] = [];
  const turnText = new Map(transcript.turns.map((turn) => [turn.id, turn.text]));

  // Past the cap, the next twenty are recorded as skipped, so the owner sees what was
  // heard and not applied (C2); beyond those they are only counted in the report.
  for (const { turnId, detection } of found.slice(SPOKEN_CAP, SPOKEN_CAP * 2)) {
    if (recordedSpoken.has(spokenKey(turnId, detection?.kind ?? "unknown"))) continue;
    commands.push({
      turnId,
      source: "spoken",
      kind: detection?.kind ?? "unknown",
      sentence: turnText.get(turnId) ?? "",
      status: "skipped",
      args: {},
      error: `Past the limit of ${SPOKEN_CAP} spoken commands for this meeting, so not applied.`,
    });
  }

  for (const { turnId, detection } of spoken) {
    if (recordedSpoken.has(spokenKey(turnId, detection?.kind ?? "unknown"))) continue;
    const sentence = turnText.get(turnId) ?? "";
    if (!detection) {
      commands.push({
        turnId,
        source: "spoken",
        kind: "unknown",
        sentence,
        status: "unparsed",
        args: {},
        error: "AFK heard its name but didn't catch a command. Type it below if you meant one.",
      });
      continue;
    }
    const { kind, rest } = detection;
    // Questions and recaps are answered live (L2); the final transcript does not re-ask them.
    if (kind === "ask" || kind === "recap") continue;
    if (kind === "decision" || kind === "note") {
      const text = parseNoteWords(rest);
      if (!text) {
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "unparsed",
          args: {},
          error: "Nothing followed the command word.",
        });
      } else {
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "applied",
          args: { text },
          item: { text },
        });
      }
      continue;
    }
    if (kind === "highlight") {
      const range = highlightRange(transcript.turns, turnId, hostCode, durationSec);
      if (!range) {
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "unparsed",
          args: {},
          error: "There was nothing before this to clip.",
        });
      } else {
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "applied",
          args: { ...range },
          highlight: range,
        });
      }
      continue;
    }
    if (kind === "remember") {
      const remember = isGuest
        ? null
        : parseRememberWords(
            rest,
            meeting.title,
            transcript.turns.find((turn) => turn.id === turnId)?.startSec,
          );
      if (!remember) {
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "unparsed",
          args: {},
          error: isGuest
            ? "AFK keeps a memory only for people signed in with Google. Continue with Google and say it again next time."
            : "Nothing followed the command word.",
        });
      } else {
        const { text, path, line, template } = remember;
        commands.push({
          turnId,
          source: "spoken",
          kind,
          sentence,
          status: "applied",
          args: { text, path },
          memory: { path, line, template },
        });
      }
      continue;
    }
    if (kind === "slack") {
      // The message is the host's own words; the channel is chosen on approval.
      const message = parseSlackWords(rest);
      commands.push({
        turnId,
        source: "spoken",
        kind,
        sentence,
        status: message ? "proposed" : "unparsed",
        args: message ? { message } : {},
        ...(message ? {} : { error: "Nothing followed the command word." }),
      });
      continue;
    }
    if (isModelKind(kind)) {
      forModel.push({ id: turnId, kind, turnId, sentence, rest });
      continue;
    }
  }

  // Which source each command the model sees came from: a spoken one first parsed here
  // is keyed by its turn, a recorded one (typed, or spoken and sent back) by its id.
  const sourceOf = new Map<string, "spoken" | "typed">(
    forModel.map((command) => [command.id, "spoken"]),
  );
  for (const row of waiting) {
    if (!isModelKind(row.kind)) continue;
    const note = (row.args as { rewriteNote?: unknown } | null)?.rewriteNote;
    const source = row.source === "spoken" ? "spoken" : "typed";
    // A spoken sentence is read as it was detected; a typed one after its slash word.
    const heard =
      source === "spoken"
        ? found.find((entry) => entry.turnId === row.turn_id && entry.detection?.kind === row.kind)
            ?.detection
        : null;
    sourceOf.set(row.id, source);
    forModel.push({
      id: row.id,
      kind: row.kind,
      turnId: row.turn_id,
      sentence: row.sentence,
      rest: heard ? heard.rest : row.sentence.replace(/^\/\w+\s*/, ""),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    });
  }

  let model: Record<string, Json> | null = null;
  let cleared: string[] = [];
  if (forModel.length > 0) {
    // The meeting's address and PIN (F10), when its link is on: a draft that shares the
    // recording or the notes carries them, written by the model or filled in below.
    const [memory, linkRow] = await Promise.all([
      meeting.owner_id ? loadMemory(db, meeting.owner_id) : Promise.resolve(null),
      db
        .from("meeting_links")
        .select("code, pin, enabled")
        .eq("meeting_id", meeting.id)
        .maybeSingle(),
    ]);
    const meetingLink =
      linkRow.data?.enabled && config.siteUrl
        ? { url: linkUrl(config.siteUrl, linkRow.data.code), pin: linkRow.data.pin }
        : null;
    const { data, run } = await claude.runStructured({
      name: "command",
      data: transcriptPrompt(meeting, transcript),
      extra:
        (memory?.block ?? "") +
        skillsBlock(memory?.files ?? []) +
        formatCommandsExtra(forModel, hostLabel, meetingLink),
      instruction: commandsInstruction(),
      schema: commandParseSchema,
      timeoutMs: options.timeoutMs,
    });
    const grounded = groundCommandParse(data, forModel, transcript);
    cleared = grounded.report.cleared;
    model = runReport(run);
    // The draft is signed with the host's name, and addressed by the first name heard.
    const myName = hostName(memory?.files, meeting.sender_names);
    for (const command of forModel) {
      const outcome = grounded.commands.find((candidate) => candidate.id === command.id);
      const existing = command.id !== command.turnId ? { id: command.id } : {};
      if (!outcome || outcome.status === "unparsed") {
        // A task the model could not read still gets the deterministic parse.
        if (command.kind === "task") {
          const task = parseTaskWords(command.rest, transcript.speakers, hostCode);
          commands.push({
            ...existing,
            turnId: command.turnId,
            source: sourceOf.get(command.id) ?? "typed",
            kind: "task",
            sentence: command.sentence,
            status: "applied",
            args: { ...task },
            item: task,
          });
        } else {
          commands.push({
            ...existing,
            turnId: command.turnId,
            source: sourceOf.get(command.id) ?? "typed",
            kind: command.kind,
            sentence: command.sentence,
            status: "unparsed",
            args: {},
            error: "AFK couldn't work out the details from this. Type it with the details.",
          });
        }
        continue;
      }
      if (outcome.kind === "task") {
        commands.push({
          ...existing,
          turnId: command.turnId,
          source: sourceOf.get(command.id) ?? "typed",
          kind: "task",
          sentence: command.sentence,
          status: "applied",
          args: { ...outcome.args },
          item: outcome.args,
        });
      } else {
        // email, followup, remind: proposed; the owner confirms the details and approves.
        commands.push({
          ...existing,
          turnId: command.turnId,
          source: sourceOf.get(command.id) ?? "typed",
          kind: outcome.kind,
          sentence: command.sentence,
          status: "proposed",
          args:
            outcome.kind === "email"
              ? { ...fillEmailNames(outcome.args, myName, meetingLink) }
              : { ...outcome.args },
        });
      }
    }
  }

  // The notes follow the first pass only. A later pass (a typed email draft on a
  // finished meeting) must not rewrite the AI notes or add a second history line: the
  // meeting records when they were written, and a changed transcript clears the marks.
  const queueGeneration = meeting.analyzed_at === null && meeting.summarized_at === null;

  const payload = { host, queueGeneration, commands };
  const count = (status: PayloadCommand["status"]) =>
    commands.filter((command) => command.status === status).length;
  return {
    payload: payload as unknown as Json,
    report: {
      host: host?.detectedBy ?? "none",
      heard: found.length,
      applied: count("applied"),
      proposed: count("proposed"),
      unparsed: count("unparsed"),
      skipped: count("skipped"),
      overCap: Math.max(0, found.length - SPOKEN_CAP),
      cleared,
      model,
      queuedGeneration: queueGeneration,
    },
  };
}
