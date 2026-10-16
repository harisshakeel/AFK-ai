/**
 * The meeting commands AFK understands (requirements C1-C5; design-v2 section 4.1).
 * One table that everything reads: the detector (spoken trigger words), the typed-command
 * parser (slash names), the Tasks tab (labels), the Send page (help) and the database's
 * kind list (a test keeps them in step). Adding a command is one entry here plus, for an
 * external one, an adapter.
 *
 * Shared by the job runner and the web app: no React, no server-only imports.
 */
export type CommandKind =
  | "task"
  | "decision"
  | "note"
  | "highlight"
  | "remember"
  | "email"
  | "followup"
  | "remind"
  | "slack"
  | "ask"
  | "recap";

export type CommandSpec = {
  kind: CommandKind;
  /** The typed form, with the slash. */
  slash: `/${string}`;
  /** Spoken trigger words, matched right after the wake word. Longer phrases first. */
  words: ReadonlyArray<string>;
  label: string;
  /** Shown on the Send page and in the Tasks tab's help. */
  help: string;
  example: string;
  /** External effect: waits in the Tasks tab for the host to approve. */
  needsApproval: boolean;
  /** Needs a Claude run to fill in its arguments; the rest are applied verbatim. */
  needsModel: boolean;
  /** Which phase ships it; the detector ignores kinds from a later phase. */
  phase: "A" | "A2" | "B" | "L";
};

export const COMMANDS: ReadonlyArray<CommandSpec> = [
  {
    kind: "task",
    slash: "/task",
    words: ["action item", "action", "task", "to do", "todo"],
    label: "Task",
    help: "Adds an action item with the owner and due date you said, marked as said on the call.",
    example: "AFK, task for Sam: send the deck by Friday.",
    needsApproval: false,
    needsModel: true,
    phase: "A",
  },
  {
    kind: "decision",
    slash: "/decision",
    words: ["decision", "we decided", "decided"],
    label: "Decision",
    help: "Records the decision word for word, cited to the moment you said it.",
    example: "AFK, decision: we launch on the twentieth.",
    needsApproval: false,
    needsModel: false,
    phase: "A",
  },
  {
    kind: "note",
    slash: "/note",
    words: ["note"],
    label: "Note",
    help: "Pins a note at the top of the summary.",
    example: "AFK, note: the client prefers the blue option.",
    needsApproval: false,
    needsModel: false,
    phase: "A",
  },
  {
    kind: "highlight",
    slash: "/highlight",
    words: ["highlight", "clip", "mark that", "mark this"],
    label: "Highlight",
    help: "Clips the last minute, from where the previous speaker started.",
    example: "AFK, highlight that.",
    needsApproval: false,
    needsModel: false,
    phase: "A",
  },
  {
    kind: "remember",
    slash: "/remember",
    words: ["remember"],
    label: "Remember",
    help: "Adds a dated line to what AFK knows about you (people, projects or words).",
    example: "AFK, remember: Sam is the designer on Atlas.",
    needsApproval: false,
    needsModel: false,
    phase: "A2",
  },
  {
    kind: "email",
    slash: "/email",
    words: ["email", "e-mail", "mail"],
    label: "Email",
    help: "Drafts an email from the discussion. You approve it before anything is sent.",
    example: "AFK, draft an email to Sam about the launch plan.",
    needsApproval: true,
    needsModel: true,
    phase: "A",
  },
  {
    kind: "followup",
    slash: "/followup",
    words: ["schedule a follow-up", "schedule a follow up", "follow-up", "follow up", "schedule"],
    label: "Follow-up",
    help: "Proposes a calendar event at the time you said, with the people you named. Invitations go out once you approve it.",
    example: "AFK, schedule a follow-up next Tuesday at three with Sam.",
    needsApproval: true,
    needsModel: true,
    phase: "B",
  },
  {
    kind: "remind",
    slash: "/remind",
    words: ["remind me", "reminder", "remind"],
    label: "Reminder",
    help: "Puts a reminder on your own calendar at the time you said, once you approve it.",
    example: "AFK, remind me tomorrow at nine to call the vendor.",
    needsApproval: true,
    needsModel: true,
    phase: "B",
  },
  {
    kind: "slack",
    slash: "/slack",
    words: [
      "tell the team on slack",
      "tell everyone on slack",
      "post to slack",
      "post on slack",
      "slack",
    ],
    label: "Slack",
    help: "Posts a message to the Slack channel you chose, once you approve it.",
    example: "AFK, tell the team on Slack that the demo moved to Thursday.",
    needsApproval: true,
    needsModel: false,
    phase: "B",
  },
  {
    kind: "recap",
    slash: "/recap",
    // Before "ask": "what did I miss" is a recap, not a question.
    words: [
      "recap",
      "summarise",
      "summarize",
      "catch me up",
      "what did i miss",
      "what have i missed",
    ],
    label: "Recap",
    help: "Posts a few lines on what was said so far in the meeting chat, while the call is on. Typed after the call, the recap lands on this tab.",
    example: "AFK, recap the last ten minutes.",
    needsApproval: false,
    needsModel: true,
    phase: "L",
  },
  {
    kind: "ask",
    slash: "/ask",
    words: [
      "what did we",
      "what was decided",
      "what did",
      "what's",
      "what is",
      "what are",
      "what",
      "who",
      "when",
      "where",
      "why",
      "how",
      "did we",
      "do we",
      "does",
      "is there",
      "are we",
      "has anyone",
      "ask",
    ],
    label: "Question",
    help: "Answered in the meeting chat from what was said so far, citing the moment, while the call is on. Typed after the call, the answer lands on this tab.",
    example: "AFK, what did we decide about pricing?",
    needsApproval: false,
    needsModel: true,
    phase: "L",
  },
];

export const COMMAND_KINDS: ReadonlyArray<CommandKind> = COMMANDS.map((spec) => spec.kind);

export function commandSpec(kind: CommandKind): CommandSpec {
  const spec = COMMANDS.find((candidate) => candidate.kind === kind);
  if (!spec) throw new Error(`unknown command kind ${kind}`);
  return spec;
}

/** Commands the current build detects. */
export const ACTIVE_PHASES: ReadonlyArray<CommandSpec["phase"]> = ["A", "A2", "B", "L"];

export function isActive(spec: CommandSpec): boolean {
  return ACTIVE_PHASES.includes(spec.phase);
}
