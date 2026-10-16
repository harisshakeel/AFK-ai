import { detectCommand } from "./detect";
import { type CommandKind, commandSpec } from "./registry";

/**
 * A live command (requirement L2): a host's utterance, as the bot hears it, that starts
 * with the wake word and asks a question or for a recap. Answered in the meeting chat
 * while the call is on. Every other command waits for the final transcript, so nothing
 * is applied twice.
 */
export type LiveCommand = { kind: "ask" | "recap"; question: string };

export function detectLiveCommand(text: string): LiveCommand | null {
  const detection = detectCommand(text);
  if (!detection) return null;
  if (detection.kind !== "ask" && detection.kind !== "recap") return null;
  const question = (detection.kind === "ask" ? detection.sentence : detection.rest)
    .replace(
      /^\s*(?:(?:hey|hi|ok|okay)[\s,]+)?a\s*[-.]?\s*f\s*[-.]?\s*k(?:\s+bot)?\b[\s,.:;!?-]*/i,
      "",
    )
    .trim();
  return { kind: detection.kind, question: question || detection.sentence };
}

/**
 * What the chat says when the sender gives a command that waits for the final
 * transcript (everything but a question or a recap): one line, so the room knows AFK
 * heard it and where the result will be. Null for anything else.
 */
export function heardAcknowledgement(text: string): { kind: CommandKind; message: string } | null {
  const detection = detectCommand(text);
  if (!detection || detection.kind === "ask" || detection.kind === "recap") return null;
  const spec = commandSpec(detection.kind);
  const where = spec.needsApproval
    ? "It will wait for your approval on the Tasks tab after the call."
    : "It goes into the notes after the call.";
  return { kind: detection.kind, message: `Heard: ${spec.label.toLowerCase()}. ${where}` };
}

/** The wording the chat gets when the question is still unanswered after twenty seconds. */
export const LIVE_FALLBACK_MESSAGE =
  "I'll answer this after the call. The answer will be on this meeting's Tasks tab.";
