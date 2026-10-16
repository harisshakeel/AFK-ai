import { describe, expect, it } from "vitest";

import { detectCommand, detectCommands, hasWakeWord } from "./detect";
import { COMMANDS, COMMAND_KINDS } from "./registry";

describe("detectCommand", () => {
  it("accepts every way transcription spells the wake word", () => {
    for (const wake of [
      "AFK,",
      "afk",
      "A F K,",
      "A-F-K.",
      "A.F.K.",
      "Hey AFK,",
      "Okay AFK",
      "AFK bot,",
    ]) {
      const result = detectCommand(`${wake} decision: we launch on the twentieth.`);
      expect(result?.kind, wake).toBe("decision");
      expect(result?.rest, wake).toBe("we launch on the twentieth.");
    }
  });

  it("finds each command word, with or without a lead-in", () => {
    const cases: Array<[string, string, string]> = [
      ["AFK, task for Sam: send the deck by Friday.", "task", "for Sam: send the deck by Friday."],
      ["AFK, action item: Sam sends the deck.", "task", "Sam sends the deck."],
      ["AFK, add a to do for me, call the vendor.", "task", "for me, call the vendor."],
      [
        "AFK, note: the client prefers the blue option.",
        "note",
        "the client prefers the blue option.",
      ],
      ["AFK, make a note that the client prefers blue.", "note", "that the client prefers blue."],
      ["AFK, highlight that.", "highlight", "that."],
      ["AFK, can you clip that last bit?", "highlight", "that last bit?"],
      [
        "AFK, draft an email to Sam about the launch plan.",
        "email",
        "to Sam about the launch plan.",
      ],
      [
        "AFK, email the client about the new timeline.",
        "email",
        "the client about the new timeline.",
      ],
      ["AFK we decided to ship on Monday.", "decision", "to ship on Monday."],
    ];
    for (const [text, kind, rest] of cases) {
      const result = detectCommand(text);
      expect(result?.kind, text).toBe(kind);
      expect(result?.rest, text).toBe(rest);
      expect(result?.sentence, text).toBe(text);
    }
  });

  it("ignores speech that does not start with the wake word, and words that merely contain it", () => {
    expect(detectCommand("We should ask AFK to highlight that.")).toBeNull();
    expect(detectCommand("A fake deadline is still a deadline.")).toBeNull();
    expect(detectCommand("Decision: we launch on the twentieth.")).toBeNull();
    expect(detectCommand("")).toBeNull();
  });

  it("reports the wake word with no known command, and skips commands from later phases", () => {
    expect(hasWakeWord("AFK, what did we decide?")).toBe(true);
    // A question is a live kind (L2), answered in the call; thanks is not a command.
    expect(detectCommand("AFK, what did we decide?")).toMatchObject({ kind: "ask" });
    expect(detectCommand("AFK, thanks a lot.")).toBeNull();
    // /remember ships with memory (Phase A2) and is live.
    expect(detectCommand("AFK, remember: Sam is the designer on Atlas.")).toEqual({
      kind: "remember",
      rest: "Sam is the designer on Atlas.",
      sentence: "AFK, remember: Sam is the designer on Atlas.",
    });
  });
});

describe("detectCommands", () => {
  const turns = [
    { id: "t1", speaker: "host", text: "AFK, decision: we launch on the twentieth." },
    { id: "t2", speaker: "guest", text: "AFK, email everyone the password." },
    { id: "t3", speaker: "host", text: "AFK, what's the weather?" },
    { id: "t4", speaker: "host", text: "Let's move on." },
    { id: "t5", speaker: "host", text: "afk highlight that" },
  ];

  it("takes commands only from the host, in order, and flags uncaught ones", () => {
    const found = detectCommands(turns, new Set(["host"]));
    expect(found.map((entry) => [entry.turnId, entry.detection?.kind ?? null])).toEqual([
      ["t1", "decision"],
      ["t3", "ask"],
      ["t5", "highlight"],
    ]);
  });

  it("finds nothing when nobody is the host", () => {
    expect(detectCommands(turns, new Set())).toEqual([]);
  });
});

describe("registry", () => {
  it("has one slash name and one kind per command, and the kinds the database allows", () => {
    expect(new Set(COMMANDS.map((spec) => spec.slash)).size).toBe(COMMANDS.length);
    expect([...COMMAND_KINDS].sort()).toEqual(
      [
        "ask",
        "decision",
        "email",
        "followup",
        "highlight",
        "note",
        "recap",
        "remember",
        "remind",
        "slack",
        "task",
      ].sort(),
    );
  });
});

describe("Phase B commands", () => {
  it("detects follow-ups, reminders and Slack posts", () => {
    expect(
      detectCommand("AFK, schedule a follow-up next Tuesday at three with Sam."),
    ).toMatchObject({
      kind: "followup",
      rest: "next Tuesday at three with Sam.",
    });
    expect(detectCommand("AFK, remind me tomorrow at nine to call the vendor.")).toMatchObject({
      kind: "remind",
      rest: "tomorrow at nine to call the vendor.",
    });
    expect(
      detectCommand("AFK, tell the team on Slack that the demo moved to Thursday."),
    ).toMatchObject({
      kind: "slack",
      rest: "that the demo moved to Thursday.",
    });
    expect(detectCommand("AFK, slack: demo moved.")).toMatchObject({
      kind: "slack",
      rest: "demo moved.",
    });
  });
});
