import { escapeRegExp } from "../../lib/regexp.ts";
import { COMMANDS, type CommandKind, type CommandSpec, isActive } from "./registry.ts";

/**
 * Wake-word detection (requirement C1): a deterministic pattern, no AI, no I/O. Transcription
 * writes the wake word as "AFK", "A F K", "A-F-K", "afk" or "Hey AFK", so the pattern
 * accepts the letters with optional spaces or dashes between them, an optional "hey", "ok"
 * or "okay" before, and an optional "bot" after. Only the start of an utterance counts.
 *
 * The caller decides whose words are commands: only the host's (Principles 1).
 */
export type Detection = {
  kind: CommandKind;
  /** The words after the command word, trimmed; what the parser works from. */
  rest: string;
  /** The whole sentence, for the card and the citation. */
  sentence: string;
};

const WAKE = /^\s*(?:(?:hey|hi|ok|okay)[\s,]+)?a\s*[-.]?\s*f\s*[-.]?\s*k(?:\s+bot)?\b[\s,.:;!?-]*/i;

// "draft an email", "make a note", "add a task", "take a highlight", "can you highlight"
const LEAD_IN =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:(?:draft|write|send|make|add|create|take|record|log)\s+(?:a|an|the|me)?\s*)?/i;

function matchCommandWord(text: string, spec: CommandSpec): string | null {
  for (const word of spec.words) {
    const pattern = new RegExp(
      `^${LEAD_IN.source}${escapeRegExp(word).replace(/\s+/g, "\\s+")}\\b[\\s,:;.!?-]*`,
      "i",
    );
    const match = pattern.exec(text);
    if (match) return text.slice(match[0].length).trim();
  }
  return null;
}

/** The command in one utterance, or null when it does not start with the wake word. */
export function detectCommand(text: string): Detection | null {
  const wake = WAKE.exec(text);
  if (!wake) return null;
  const afterWake = text.slice(wake[0].length).trim();
  if (!afterWake) return null;
  for (const spec of COMMANDS) {
    if (!isActive(spec)) continue;
    const rest = matchCommandWord(afterWake, spec);
    if (rest !== null) {
      return { kind: spec.kind, rest, sentence: text.trim() };
    }
  }
  return null;
}

/** True when the utterance starts with the wake word, whether or not a command follows. */
export function hasWakeWord(text: string): boolean {
  return WAKE.test(text);
}

export type DetectableTurn = { id: string; speaker: string; text: string };

/**
 * Every command the host spoke, in meeting order. Turns by anyone else are ignored; a
 * turn by the host that has the wake word but no known command is returned with
 * kind null so the Tasks tab can say "AFK didn't catch this" (C8).
 */
export function detectCommands(
  turns: ReadonlyArray<DetectableTurn>,
  hostCodes: ReadonlySet<string>,
): Array<{ turnId: string; detection: Detection | null }> {
  const found: Array<{ turnId: string; detection: Detection | null }> = [];
  for (const turn of turns) {
    if (!hostCodes.has(turn.speaker)) continue;
    const detection = detectCommand(turn.text);
    if (detection) found.push({ turnId: turn.id, detection });
    else if (hasWakeWord(turn.text)) found.push({ turnId: turn.id, detection: null });
  }
  return found;
}
