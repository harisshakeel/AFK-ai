import type { CommandParse, EmailArgs, FollowupArgs, RemindArgs, TaskArgs } from "./ai-schema.ts";
import type { CommandForPrompt } from "./prompts.ts";

/**
 * Grounding for parsed commands (requirement C2, NFR Grounding of arguments). Nothing
 * here trusts the model:
 *   - an owner must be a speaker of this meeting (ownerSpeaker) or a name said in the
 *     sentence or within five turns of it (ownerName); otherwise it is cleared
 *   - a due date, or the time of a follow-up or reminder, must be words said in the
 *     sentence or those turns; a time whose words were not said is cleared with its date
 *   - email recipients and follow-up attendees must be names said in the sentence
 *   - a command the model did not understand is left unparsed, never guessed
 * Report lines name positions, never content, so they are safe to store and log.
 */
export type TranscriptForCommandGrounding = {
  speakers: ReadonlyArray<{ code: string; label: string }>;
  /** With start times, the context is a minute each way; without, five turns each way. */
  turns: ReadonlyArray<{ id: string; text: string; startSec?: number }>;
};

export type ModelKind = "task" | "email" | "followup" | "remind";

export type GroundedCommand =
  | { id: string; kind: "task"; status: "applied"; args: TaskArgs }
  | { id: string; kind: "email"; status: "proposed"; args: EmailArgs }
  | { id: string; kind: "followup"; status: "proposed"; args: FollowupArgs }
  | { id: string; kind: "remind"; status: "proposed"; args: RemindArgs }
  | { id: string; kind: ModelKind; status: "unparsed"; args: Record<string, never> };

export type CommandGroundingReport = { unparsed: string[]; cleared: string[] };

const CONTEXT_TURNS = 5;
const CONTEXT_SEC = 60;

export const MODEL_KINDS: ReadonlyArray<ModelKind> = ["task", "email", "followup", "remind"];

export function isModelKind(kind: string): kind is ModelKind {
  return (MODEL_KINDS as ReadonlyArray<string>).includes(kind);
}

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function saidIn(phrase: string, texts: ReadonlyArray<string>): boolean {
  const needle = normalise(phrase);
  return needle.length > 0 && texts.some((text) => ` ${normalise(text)} `.includes(` ${needle} `));
}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether an address was said: written as one ("sam@x.com", as a transcriber with smart
 * formatting writes it) or spelled out ("sam at x dot com", "sam dot lee at x dot co dot uk").
 */
export function addressSaid(email: string, texts: ReadonlyArray<string>): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return false;
  const localPart = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(escape)
    .join("\\s*(?:[._-]|dot|underscore|dash|hyphen)?\\s*");
  const domainPart = domain.split(".").filter(Boolean).map(escape).join("\\s*(?:\\.|dot)\\s*");
  if (!localPart || !domainPart) return false;
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${localPart}\\s*(?:@|at|at the rate)\\s*${domainPart}(?![a-z0-9])`,
    "i",
  );
  return texts.some((text) => pattern.test(text));
}

function contextTexts(
  command: CommandForPrompt,
  transcript: TranscriptForCommandGrounding,
): string[] {
  const texts = [command.sentence];
  if (!command.turnId) return texts;
  const index = transcript.turns.findIndex((turn) => turn.id === command.turnId);
  if (index < 0) return texts;
  const at = transcript.turns[index]?.startSec;
  if (at !== undefined) {
    // The surrounding minute (requirement C2), by the source timings.
    for (const turn of transcript.turns) {
      if (turn.startSec !== undefined && Math.abs(turn.startSec - at) <= CONTEXT_SEC) {
        texts.push(turn.text);
      }
    }
    return texts;
  }
  for (
    let near = Math.max(0, index - CONTEXT_TURNS);
    near <= Math.min(transcript.turns.length - 1, index + CONTEXT_TURNS);
    near++
  ) {
    texts.push(transcript.turns[near]?.text ?? "");
  }
  return texts;
}

/** An ISO date-time the model produced, or null when it is not one. */
function validIso(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

/** The time words and the date they mean survive only together, and only when said. */
function groundWhen(
  whenText: string | null,
  startsAt: string | null,
  texts: ReadonlyArray<string>,
  where: string,
  report: CommandGroundingReport,
): { whenText: string | null; startsAt: string | null } {
  if (!whenText) return { whenText: null, startsAt: null };
  if (!saidIn(whenText, texts)) {
    report.cleared.push(`${where}: time not said`);
    return { whenText: null, startsAt: null };
  }
  return { whenText: whenText.trim(), startsAt: validIso(startsAt) };
}

export function groundCommandParse(
  parse: CommandParse,
  commands: ReadonlyArray<CommandForPrompt>,
  transcript: TranscriptForCommandGrounding,
): { commands: GroundedCommand[]; report: CommandGroundingReport } {
  const report: CommandGroundingReport = { unparsed: [], cleared: [] };
  const codeByLabel = new Map(
    transcript.speakers.map((speaker) => [normalise(speaker.label), speaker.code]),
  );
  const codes = new Set(transcript.speakers.map((speaker) => speaker.code));
  const results: GroundedCommand[] = [];

  commands.forEach((command, index) => {
    if (!isModelKind(command.kind)) return;
    const where = `command ${index + 1}`;
    const kind = command.kind;
    const parsed = parse.commands.find((candidate) => candidate.id === command.id);
    const unparsed = (): GroundedCommand => {
      report.unparsed.push(where);
      return { id: command.id, kind, status: "unparsed", args: {} };
    };
    if (!parsed || !parsed.understood) {
      results.push(unparsed());
      return;
    }
    const texts = contextTexts(command, transcript);

    if (kind === "task") {
      if (!parsed.task) {
        results.push(unparsed());
        return;
      }
      let ownerSpeaker: string | null = null;
      if (parsed.task.ownerSpeaker) {
        ownerSpeaker =
          (codes.has(parsed.task.ownerSpeaker)
            ? parsed.task.ownerSpeaker
            : codeByLabel.get(normalise(parsed.task.ownerSpeaker))) ?? null;
        if (!ownerSpeaker) report.cleared.push(`${where}: owner is not a speaker`);
      }
      let ownerName: string | null = null;
      if (!ownerSpeaker && parsed.task.ownerName) {
        if (saidIn(parsed.task.ownerName, texts)) ownerName = parsed.task.ownerName.trim();
        else report.cleared.push(`${where}: owner name not said`);
      }
      let dueText: string | null = null;
      if (parsed.task.dueText) {
        if (saidIn(parsed.task.dueText, texts)) dueText = parsed.task.dueText.trim();
        else report.cleared.push(`${where}: due date not said`);
      }
      results.push({
        id: command.id,
        kind: "task",
        status: "applied",
        args: { text: parsed.task.text.trim(), ownerSpeaker, ownerName, dueText },
      });
      return;
    }

    if (kind === "email") {
      if (!parsed.email) {
        results.push(unparsed());
        return;
      }
      const toNames = parsed.email.toNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && saidIn(name, [command.sentence]));
      if (toNames.length < parsed.email.toNames.length) {
        report.cleared.push(`${where}: a recipient was not said`);
      }
      // An address is kept only when it was said: in the sentence, or anywhere in the call.
      const everywhere = [command.sentence, ...transcript.turns.map((turn) => turn.text)];
      const toAddresses = (parsed.email.toAddresses ?? [])
        .map((address) => address.trim().toLowerCase())
        .filter(
          (address, index, all) =>
            ADDRESS.test(address) &&
            all.indexOf(address) === index &&
            addressSaid(address, everywhere),
        );
      if (toAddresses.length < (parsed.email.toAddresses ?? []).length) {
        report.cleared.push(`${where}: an address was not said`);
      }
      results.push({
        id: command.id,
        kind: "email",
        status: "proposed",
        args: {
          toNames,
          toAddresses,
          subject: parsed.email.subject.trim(),
          body: parsed.email.body.trim(),
        },
      });
      return;
    }

    if (kind === "followup") {
      if (!parsed.followup) {
        results.push(unparsed());
        return;
      }
      const when = groundWhen(
        parsed.followup.whenText,
        parsed.followup.startsAt,
        texts,
        where,
        report,
      );
      const attendeeNames = parsed.followup.attendeeNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && saidIn(name, [command.sentence]));
      if (attendeeNames.length < parsed.followup.attendeeNames.length) {
        report.cleared.push(`${where}: an attendee was not said`);
      }
      results.push({
        id: command.id,
        kind: "followup",
        status: "proposed",
        args: {
          title: parsed.followup.title.trim(),
          ...when,
          durationMin: parsed.followup.durationMin,
          attendeeNames,
        },
      });
      return;
    }

    if (!parsed.remind) {
      results.push(unparsed());
      return;
    }
    const when = groundWhen(parsed.remind.whenText, parsed.remind.startsAt, texts, where, report);
    results.push({
      id: command.id,
      kind: "remind",
      status: "proposed",
      args: { text: parsed.remind.text.trim(), ...when },
    });
  });

  return { commands: results, report };
}
