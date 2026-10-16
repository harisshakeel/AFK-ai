import { afterEach, describe, expect, it, vi } from "vitest";

import { highlightRange, parseRememberWords, parseTaskWords, parseTyped, turnAt } from "./parse";

const speakers = [
  { code: "h", label: "Haris Shakeel" },
  { code: "s", label: "Sam" },
];

describe("parseTyped", () => {
  it("reads the slash name and the words after it", () => {
    expect(parseTyped("/task for Sam: send the deck by Friday")).toEqual({
      kind: "task",
      rest: "for Sam: send the deck by Friday",
    });
    expect(parseTyped("  /Decision we launch on the 20th ")).toEqual({
      kind: "decision",
      rest: "we launch on the 20th",
    });
    expect(parseTyped("/highlight")).toEqual({ kind: "highlight", rest: "" });
  });

  it("explains what went wrong", () => {
    expect(parseTyped("task for Sam")).toMatchObject({ error: expect.stringContaining("slash") });
    expect(parseTyped("/dance")).toMatchObject({ error: expect.stringContaining("/dance") });
    expect(parseTyped("/note")).toMatchObject({ error: expect.stringContaining("/note needs") });
    expect(parseTyped("/remember Sam is the designer")).toEqual({
      kind: "remember",
      rest: "Sam is the designer",
    });
  });
});

describe("parseTaskWords", () => {
  it("splits owner, task and due date", () => {
    expect(parseTaskWords("for Sam: send the deck by Friday.", speakers, "h")).toEqual({
      text: "Send the deck",
      ownerSpeaker: "s",
      ownerName: null,
      dueText: "by Friday",
    });
  });

  it("keeps a name that is not a speaker, and 'me' is the host", () => {
    expect(parseTaskWords("for Priya, book the venue before Tuesday", speakers, "h")).toEqual({
      text: "Book the venue",
      ownerSpeaker: null,
      ownerName: "Priya",
      dueText: "before Tuesday",
    });
    expect(parseTaskWords("for me: call the vendor", speakers, "h")).toEqual({
      text: "Call the vendor",
      ownerSpeaker: "h",
      ownerName: null,
      dueText: null,
    });
  });

  it("keeps a preposition that is part of the task, and takes a real deadline after it", () => {
    expect(parseTaskWords("work on the deck by Friday", speakers, "h")).toMatchObject({
      text: "Work on the deck",
      dueText: "by Friday",
    });
    expect(parseTaskWords("decide on the venue", speakers, "h")).toMatchObject({
      text: "Decide on the venue",
      dueText: null,
    });
    expect(
      parseTaskWords("sign off on the budget by the end of the week", speakers, "h"),
    ).toMatchObject({
      text: "Sign off on the budget",
      dueText: "by the end of the week",
    });
    expect(parseTaskWords("send the numbers by 5pm", speakers, "h")).toMatchObject({
      text: "Send the numbers",
      dueText: "by 5pm",
    });
    expect(parseTaskWords("book the room on the 20th", speakers, "h")).toMatchObject({
      text: "Book the room",
      dueText: "on the 20th",
    });
  });

  it("does not take the task's first clause for an owner's name", () => {
    expect(
      parseTaskWords("for Sam send the deck by Friday, then review", speakers, "h"),
    ).toMatchObject({ ownerSpeaker: null, ownerName: null, text: "For Sam send the deck" });
    expect(parseTaskWords("for Sam Lee: send the deck", speakers, "h")).toMatchObject({
      ownerName: "Sam Lee",
      text: "Send the deck",
    });
  });

  it("leaves owner and due date blank when they were not said", () => {
    expect(parseTaskWords("check the pricing page", speakers, "h")).toEqual({
      text: "Check the pricing page",
      ownerSpeaker: null,
      ownerName: null,
      dueText: null,
    });
  });
});

describe("highlightRange", () => {
  const turns = [
    { id: "t0", speaker: "h", startSec: 0, endSec: 10 },
    { id: "t1", speaker: "s", startSec: 12, endSec: 40 },
    { id: "t2", speaker: "h", startSec: 41, endSec: 44 },
    { id: "t3", speaker: "h", startSec: 45, endSec: 48 },
  ];

  it("clips from where the other speaker started up to the command", () => {
    expect(highlightRange(turns, "t3", "h", 100)).toEqual({ startSec: 12, endSec: 45 });
  });

  it("never clips more than a minute, and at least five seconds", () => {
    const long = [
      { id: "a", speaker: "s", startSec: 0, endSec: 200 },
      { id: "b", speaker: "h", startSec: 200, endSec: 202 },
    ];
    expect(highlightRange(long, "b", "h", 300)).toEqual({ startSec: 140, endSec: 200 });
    const quick = [
      { id: "a", speaker: "s", startSec: 10, endSec: 11 },
      { id: "b", speaker: "h", startSec: 11.5, endSec: 13 },
    ];
    expect(highlightRange(quick, "b", "h", 300)).toEqual({ startSec: 6.5, endSec: 11.5 });
    expect(highlightRange(turns, "nope", "h", 100)).toBeNull();
  });
});

describe("turnAt", () => {
  it("finds the latest turn that started by the moment", () => {
    const turns = [
      { id: "a", startSec: 0 },
      { id: "b", startSec: 10 },
      { id: "c", startSec: 20 },
    ];
    expect(turnAt(turns, 15)).toBe("b");
    expect(turnAt(turns, 0)).toBe("a");
    expect(turnAt(turns, 99)).toBe("c");
    expect(turnAt([{ id: "a", startSec: 5 }], 1)).toBeNull();
  });
});

describe("Phase B typed commands", () => {
  it("reads /followup, /remind and /slack", () => {
    expect(parseTyped("/followup next Tuesday at three with Sam")).toEqual({
      kind: "followup",
      rest: "next Tuesday at three with Sam",
    });
    expect(parseTyped("/remind tomorrow at nine to call the vendor")).toEqual({
      kind: "remind",
      rest: "tomorrow at nine to call the vendor",
    });
    expect(parseTyped("/slack the demo moved to Thursday")).toEqual({
      kind: "slack",
      rest: "the demo moved to Thursday",
    });
  });
});

describe("parseRememberWords", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates the line by the meeting it was said in, like the learn job's lines", () => {
    const remember = parseRememberWords(
      "Sam is the designer",
      "Launch sync",
      62,
      "2026-09-01T10:00:00Z",
    );
    expect(remember?.line).toMatch(/^- \[2026-09-01\] /);
    vi.useFakeTimers({ now: new Date("2026-10-17T23:59:59Z") });
    const undated = parseRememberWords("Sam is the designer", "Launch sync", 62, null);
    expect(undated?.line).toMatch(/^- \[2026-10-17\] /);
  });
});
