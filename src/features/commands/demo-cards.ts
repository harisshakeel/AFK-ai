import type { CommandView } from "./command-view";

/**
 * What a visitor sees on the Tasks tab of a sample meeting (requirement C6): example
 * cards built from the command list's own example sentences, labelled as examples.
 * Static, never rows; nothing runs. Not from a real call: none has been recorded yet.
 */
export const DEMO_COMMANDS: ReadonlyArray<CommandView> = [
  {
    id: "demo-1",
    kind: "task",
    status: "applied",
    source: "spoken",
    sentence: "AFK, task for Sam: send the deck by Friday.",
    args: { text: "Send the deck", ownerSpeaker: null, ownerName: "Sam", dueText: "by Friday" },
    turnId: null,
    error: null,
    approvedArgs: null,
    result: null,
    executedAt: null,
    needsApproval: false,
    createdAt: "2026-10-16T08:00:00Z",
  },
  {
    id: "demo-2",
    kind: "decision",
    status: "applied",
    source: "spoken",
    sentence: "AFK, decision: we launch on the twentieth.",
    args: { text: "we launch on the twentieth" },
    turnId: null,
    error: null,
    approvedArgs: null,
    result: null,
    executedAt: null,
    needsApproval: false,
    createdAt: "2026-10-16T08:01:00Z",
  },
  {
    id: "demo-3",
    kind: "highlight",
    status: "applied",
    source: "spoken",
    sentence: "AFK, highlight that.",
    args: { startSec: 312, endSec: 351 },
    turnId: null,
    error: null,
    approvedArgs: null,
    result: null,
    executedAt: null,
    needsApproval: false,
    createdAt: "2026-10-16T08:02:00Z",
  },
  {
    id: "demo-4",
    kind: "email",
    status: "proposed",
    source: "spoken",
    sentence: "AFK, draft an email to Sam about the launch plan.",
    args: {
      toNames: ["Sam"],
      subject: "Launch plan: the twentieth",
      body: "Hi Sam,\n\nWe agreed today to launch on the twentieth. Could you send the deck by Friday so the team can review it before then?\n\nThanks,\n[your name]",
    },
    turnId: null,
    error: null,
    approvedArgs: null,
    result: null,
    executedAt: null,
    needsApproval: true,
    createdAt: "2026-10-16T08:03:00Z",
  },
];
