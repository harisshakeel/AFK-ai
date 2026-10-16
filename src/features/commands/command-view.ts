import type { CommandKind } from "./registry";

/** A command as the Tasks tab shows it: the row, with its arguments as stored. */
export type CommandStatus =
  | "detected"
  | "applied"
  | "proposed"
  | "unparsed"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "dismissed"
  /** Heard past the meeting's cap of spoken commands; listed, never applied. */
  | "skipped";

export type CommandView = {
  id: string;
  kind: CommandKind | "unknown";
  status: CommandStatus;
  source: "spoken" | "typed" | "live";
  sentence: string;
  args: Record<string, unknown>;
  turnId: string | null;
  error: string | null;
  needsApproval: boolean;
  createdAt: string;
  /** The details the owner confirmed on approval; what the adapter ran with. */
  approvedArgs: Record<string, unknown> | null;
  /** What the adapter did: recipients, a link, a time. The owner's own data. */
  result: Record<string, unknown> | null;
  /** Set once an adapter was called; a failed command past this point may be unsafe to retry. */
  executedAt: string | null;
  /** How many times the owner sent this draft back with a note; at most MAX_REWRITES. */
  rewrites: number;
};

/** rewrite_command() refuses a draft sent back this many times (migration 43). */
export const MAX_REWRITES = 3;

/**
 * Whether the owner may still send a draft back with a note: fewer than MAX_REWRITES so
 * far, and not a "Share the notes" card, whose body is the notes themselves, not a draft.
 */
export function canRewrite(command: Pick<CommandView, "rewrites" | "args">): boolean {
  return command.rewrites < MAX_REWRITES && command.args.sharedNotes !== true;
}

export const COMMAND_SELECT =
  "id, kind, status, source, sentence, args, turn_id, error, needs_approval, created_at, approved_args, result, executed_at, rewrites";

/** A database row (as COMMAND_SELECT reads it) as the Tasks tab shows it. */
export function toCommandView(row: {
  id: string;
  kind: string;
  status: string;
  source: string;
  sentence: string;
  args: unknown;
  turn_id: string | null;
  error: string | null;
  needs_approval: boolean;
  created_at: string;
  approved_args: unknown;
  result: unknown;
  executed_at: string | null;
  rewrites: number;
}): CommandView {
  const object = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    kind: row.kind as CommandView["kind"],
    status: row.status as CommandView["status"],
    source: row.source as CommandView["source"],
    sentence: row.sentence,
    args: object(row.args) ?? {},
    turnId: row.turn_id,
    error: row.error,
    needsApproval: row.needs_approval,
    createdAt: row.created_at,
    approvedArgs: object(row.approved_args),
    result: object(row.result),
    executedAt: row.executed_at,
    rewrites: row.rewrites,
  };
}

/** A job's error as the runner logged it: a code, a function name, a service's status. */
const TECHNICAL =
  /failed:|\(\w*\d{3,5}\)|answered \d{3}|\bclaim\b|\blease\b|database|schema|\w+_\w+/i;

/**
 * What a card says went wrong. An error written for the owner (a sentence: "Reconnect
 * Google on the Connectors page.") is shown as it is; one the runner logged ("start_command
 * failed: …", "Gmail answered 400") is replaced by a plain line for the card's state. The
 * full text stays on the job and in the logs.
 */
export function cardError(command: Pick<CommandView, "status" | "error">): string | null {
  const error = command.error?.trim();
  if (!error) return null;
  if (/^[A-Z][\s\S]*[.!?]$/.test(error) && !TECHNICAL.test(error)) return error;
  if (command.status === "approved") {
    return "The last try didn't go through. AFK tries again shortly.";
  }
  if (command.status === "failed") return "AFK couldn't finish this one.";
  return "AFK couldn't work this one out. Type it again with the details.";
}

/** What each status means to the owner, on the Tasks tab and the Tasks page. */
export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  detected: "Drafting…",
  applied: "Added to the notes",
  proposed: "Waiting for your approval",
  unparsed: "Not understood",
  approved: "Approved, running shortly",
  running: "Running…",
  done: "Done",
  failed: "Failed",
  dismissed: "Dismissed",
  skipped: "Past the limit, not applied",
};

export const asString = (value: unknown) => (typeof value === "string" ? value : null);
export const asStrings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** One line saying what an adapter did, from the stored result. */
export function resultSummary(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const when = asString(result.startsAt)?.replace("T", " ").slice(0, 16);
  switch (result.kind) {
    case "email":
      return `Sent to ${asStrings(result.to).join(", ")}`;
    case "followup":
      return `On your calendar for ${when ?? "the time you set"}, ${asStrings(result.attendees).length} invited`;
    case "remind":
      return `Reminder set for ${when ?? "the time you set"}`;
    case "slack":
      return `Posted to #${asString(result.channelName) ?? "channel"} in ${asString(result.teamName) ?? "Slack"}`;
    case "answer":
      return `${result.posted === true ? "Answered in the meeting chat" : "Answered here"}: ${asString(result.text) ?? ""}`;
    default:
      return null;
  }
}

export function resultLink(result: Record<string, unknown> | null): string | null {
  const link = result ? asString(result.link) : null;
  return link && /^https:\/\//.test(link) ? link : null;
}

/** The badge colour for each status, shared by the Tasks tab, the Tasks page and the landing. */
export const COMMAND_STATUS_TONE: Record<
  CommandStatus,
  "accent" | "neutral" | "success" | "warning" | "danger"
> = {
  detected: "neutral",
  applied: "success",
  proposed: "warning",
  unparsed: "danger",
  approved: "accent",
  running: "accent",
  done: "success",
  failed: "danger",
  dismissed: "neutral",
  skipped: "neutral",
};

/**
 * Whose words were commands and how AFK knew (sender.ts): matched by name to the person
 * who sent the bot, or the only person who spoke; null when nobody could be told apart.
 */
export type HostNote = {
  label: string | null;
  detectedBy: "name" | "only" | null;
};
