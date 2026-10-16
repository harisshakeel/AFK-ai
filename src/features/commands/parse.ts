import { chooseMemoryFile, contextTemplate, learnedLine } from "../memory/files.ts";
import { COMMANDS, type CommandKind, commandSpec, isActive } from "./registry.ts";
import { lastStartedIndex, round3 } from "../../lib/time-rules.ts";

/**
 * Deterministic parsing (requirements C3, C5): everything that does not need a model.
 *   - a typed slash command into its kind and the words after it
 *   - a task's words into owner, text and due date, for typed tasks and as the fallback
 *     when the model run is unavailable
 *   - the clip a "highlight that" refers to
 * Pure functions, shared by the job runner and the route handler.
 */
export type TypedCommand = { kind: CommandKind; rest: string };

/** `/task for Sam: send the deck by Friday` → kind task, rest "for Sam: ...". */
export function parseTyped(text: string): TypedCommand | { error: string } {
  const trimmed = text.trim();
  const match = /^\/([a-z]+)\b\s*(.*)$/is.exec(trimmed);
  if (!match) return { error: "A typed command starts with a slash, for example /task." };
  const spec = COMMANDS.find((candidate) => candidate.slash === `/${match[1]!.toLowerCase()}`);
  if (!spec || !isActive(spec)) {
    return {
      error: `AFK doesn't know /${match[1]}. Try ${COMMANDS.filter(isActive)
        .map((s) => s.slash)
        .join(", ")}.`,
    };
  }
  const rest = (match[2] ?? "").trim();
  if (spec.kind !== "highlight" && rest.length === 0) {
    return {
      error: `${spec.slash} needs some words after it, for example "${commandSpec(spec.kind).example}".`,
    };
  }
  return { kind: spec.kind, rest };
}

export type ParsedTask = {
  text: string;
  ownerSpeaker: string | null;
  ownerName: string | null;
  dueText: string | null;
};

/**
 * A deadline in a task: "by", "before", "until" and "due" always start one; "on" only
 * when a day or a date follows ("on Friday", "on the 20th"), since "work on the deck"
 * and "decide on the venue" are the task itself.
 */
const DAY = "(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?";
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const ON_WHEN = `(?:${DAY}\\b|${MONTH}\\b|(?:the\\s+)?\\d|next\\b|this\\b)`;
const DUE = new RegExp(
  `\\b((?:(?:by|before|until|due)\\s+\\S|on\\s+${ON_WHEN})(?:(?!\\band\\b).){0,40}?)\\s*[.!?]?$`,
  "i",
);

/** Whether a deadline phrase already starts with its trigger word ("by Friday", "on the 20th"). */
export function hasDueTrigger(dueText: string): boolean {
  return /^(?:by|before|until|due|on)\b/i.test(dueText.trim());
}

/**
 * "for Sam: send the deck by Friday" → owner Sam, text "send the deck", due "by Friday".
 * The owner is a speaker when the name matches a label; "me" is the host when known.
 */
export function parseTaskWords(
  rest: string,
  speakers: ReadonlyArray<{ code: string; label: string }>,
  hostCode: string | null,
): ParsedTask {
  let words = rest.trim().replace(/[.!?]+$/, "");
  let ownerSpeaker: string | null = null;
  let ownerName: string | null = null;

  // At most four words before the separator: a name, never the task's first clause.
  const owner = /^(?:for|to|assign(?:ed)?\s+to)\s+((?:[^\s:,-]+\s*){1,4}?)\s*[:,-]\s*(.+)$/i.exec(
    words,
  );
  if (owner) {
    const name = owner[1]!.trim();
    words = owner[2]!.trim();
    if (/^(me|myself|i)$/i.test(name) && hostCode) ownerSpeaker = hostCode;
    else {
      const speaker = speakers.find((candidate) => sameName(candidate.label, name));
      if (speaker) ownerSpeaker = speaker.code;
      else ownerName = name;
    }
  }

  let dueText: string | null = null;
  const due = DUE.exec(words);
  if (due) {
    dueText = due[1]!.trim();
    words = words
      .slice(0, due.index)
      .trim()
      .replace(/[,;:]+$/, "");
  }
  const text = words.length > 0 ? capitalise(words) : capitalise(rest.trim());
  return { text: text.slice(0, 300), ownerSpeaker, ownerName, dueText };
}

/** A decision or a note: the words as said, without the sentence's final punctuation. */
export function parseNoteWords(rest: string): string | null {
  const text = rest.replace(/[.!?]+$/, "").trim();
  return text || null;
}

/** A Slack post: the host's own words, without a leading "that". */
export function parseSlackWords(rest: string): string | null {
  const message = rest.replace(/^that\s+/i, "").trim();
  return message || null;
}

/**
 * A remember, spoken or typed: the words, the memory file they belong in, the dated
 * line that goes under "Learned by AFK" (ending with the meeting and the moment) and
 * the file's template for when it does not exist yet. The line is dated by the meeting
 * it was said in, as the learn job dates its lines, so memory's oldest-first trimming
 * orders it with the rest; today only for a meeting with no date.
 */
export function parseRememberWords(
  rest: string,
  meetingTitle: string,
  atSec: number | undefined,
  recordedAt: string | null = null,
): {
  text: string;
  path: ReturnType<typeof chooseMemoryFile>;
  line: string;
  template: string;
} | null {
  const text = parseNoteWords(rest);
  if (!text) return null;
  const path = chooseMemoryFile(text);
  return {
    text,
    path,
    line: learnedLine(dayOf(recordedAt), text, meetingTitle, atSec),
    template: contextTemplate(path),
  };
}

function dayOf(recordedAt: string | null): string {
  const time = recordedAt ? Date.parse(recordedAt) : NaN;
  return (Number.isFinite(time) ? new Date(time) : new Date()).toISOString().slice(0, 10);
}

const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, " ").trim() === b.toLowerCase().replace(/\s+/g, " ").trim();
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const HIGHLIGHT_MAX_SEC = 60;
export const HIGHLIGHT_MIN_SEC = 5;

/**
 * What "highlight that" clips: from where the previous speaker's turn started (someone
 * other than the host when possible) up to the command, at most 60 seconds and at least 5.
 */
export function highlightRange(
  turns: ReadonlyArray<{ id: string; speaker: string; startSec: number; endSec: number }>,
  commandTurnId: string,
  hostCode: string | null,
  durationSec: number,
): { startSec: number; endSec: number } | null {
  const index = turns.findIndex((turn) => turn.id === commandTurnId);
  if (index < 0) return null;
  const command = turns[index]!;
  const endSec = Math.min(command.startSec, durationSec);
  let startSec = endSec - HIGHLIGHT_MIN_SEC;
  for (let at = index - 1; at >= 0; at--) {
    const turn = turns[at]!;
    if (hostCode && turn.speaker === hostCode && at > 0) continue;
    startSec = turn.startSec;
    break;
  }
  startSec = Math.max(0, Math.max(startSec, endSec - HIGHLIGHT_MAX_SEC));
  if (endSec - startSec < HIGHLIGHT_MIN_SEC) startSec = Math.max(0, endSec - HIGHLIGHT_MIN_SEC);
  if (endSec - startSec <= 0) return null;
  return { startSec: round3(startSec), endSec: round3(endSec) };
}

/** The turn under a moment, for citing a typed command (the latest turn that started by then). */
export function turnAt(
  turns: ReadonlyArray<{ id: string; startSec: number }>,
  sec: number,
): string | null {
  return turns[lastStartedIndex(turns, sec)]?.id ?? null;
}
