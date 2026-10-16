import { describe, expect, it } from "vitest";

import { addressSaid, groundCommandParse } from "./grounding";
import type { CommandForPrompt } from "./prompts";

const transcript = {
  speakers: [
    { code: "h", label: "Haris Shakeel" },
    { code: "s", label: "Sam" },
  ],
  turns: [
    { id: "t0", text: "Sam, can you get the deck ready?" },
    { id: "t1", text: "AFK, task for Sam: send the deck by Friday." },
    { id: "t2", text: "AFK, draft an email to Sam about the launch plan." },
    { id: "t3", text: "AFK, task: book the venue." },
  ],
};

const commands: CommandForPrompt[] = [
  {
    id: "t1",
    kind: "task",
    turnId: "t1",
    sentence: transcript.turns[1]!.text,
    rest: "for Sam: send the deck by Friday.",
  },
  {
    id: "t2",
    kind: "email",
    turnId: "t2",
    sentence: transcript.turns[2]!.text,
    rest: "to Sam about the launch plan.",
  },
  {
    id: "t3",
    kind: "task",
    turnId: "t3",
    sentence: transcript.turns[3]!.text,
    rest: "book the venue.",
  },
];

describe("groundCommandParse", () => {
  it("keeps owners and dates that were said, maps speaker labels to codes", () => {
    const { commands: grounded, report } = groundCommandParse(
      {
        commands: [
          {
            id: "t1",
            understood: true,
            task: {
              text: "Send the deck",
              ownerSpeaker: "Sam",
              ownerName: null,
              dueText: "by Friday",
            },
            email: null,
            followup: null,
            remind: null,
          },
          {
            id: "t2",
            understood: true,
            task: null,
            email: {
              toNames: ["Sam"],
              toAddresses: [],
              subject: "Launch plan",
              body: "Hi Sam, ...",
            },
            followup: null,
            remind: null,
          },
          {
            id: "t3",
            understood: true,
            task: {
              text: "Book the venue",
              ownerSpeaker: null,
              ownerName: "Priya",
              dueText: "by Monday",
            },
            email: null,
            followup: null,
            remind: null,
          },
        ],
      },
      commands,
      transcript,
    );
    expect(grounded).toEqual([
      {
        id: "t1",
        kind: "task",
        status: "applied",
        args: { text: "Send the deck", ownerSpeaker: "s", ownerName: null, dueText: "by Friday" },
      },
      {
        id: "t2",
        kind: "email",
        status: "proposed",
        args: { toNames: ["Sam"], toAddresses: [], subject: "Launch plan", body: "Hi Sam, ..." },
      },
      {
        id: "t3",
        kind: "task",
        status: "applied",
        // Priya and Monday were never said: both cleared, the task kept.
        args: { text: "Book the venue", ownerSpeaker: null, ownerName: null, dueText: null },
      },
    ]);
    expect(report.cleared).toEqual([
      "command 3: owner name not said",
      "command 3: due date not said",
    ]);
    expect(report.unparsed).toEqual([]);
  });

  it("leaves a command unparsed when the model did not understand it or skipped it", () => {
    const { commands: grounded, report } = groundCommandParse(
      {
        commands: [
          { id: "t1", understood: false, task: null, email: null, followup: null, remind: null },
        ],
      },
      commands,
      transcript,
    );
    expect(grounded.map((command) => command.status)).toEqual(["unparsed", "unparsed", "unparsed"]);
    expect(report.unparsed).toHaveLength(3);
  });

  it("drops email recipients that were not named in the sentence", () => {
    const { commands: grounded, report } = groundCommandParse(
      {
        commands: [
          {
            id: "t2",
            understood: true,
            task: null,
            email: {
              toNames: ["Sam", "The whole board"],
              toAddresses: [],
              subject: "Launch",
              body: "...",
            },
            followup: null,
            remind: null,
          },
        ],
      },
      [commands[1]!],
      transcript,
    );
    expect(grounded[0]).toMatchObject({ status: "proposed", args: { toNames: ["Sam"] } });
    expect(report.cleared).toEqual(["command 1: a recipient was not said"]);
  });
});

describe("addresses said in the call", () => {
  it("hears an address written out or spelled out, and nothing else", () => {
    const texts = [
      "you can reach me at shumail at gmail dot com, or sam.lee@example.co.uk",
      "my id is haris underscore s at work dot org",
    ];
    expect(addressSaid("shumail@gmail.com", texts)).toBe(true);
    expect(addressSaid("Sam.Lee@example.co.uk", texts)).toBe(true);
    expect(addressSaid("haris_s@work.org", texts)).toBe(true);
    expect(addressSaid("shumail@gmail.co", texts)).toBe(false);
    expect(addressSaid("ali@gmail.com", texts)).toBe(false);
    expect(addressSaid("not-an-address", texts)).toBe(false);
  });

  it("keeps an email's address only when it was said, in the sentence or anywhere in the call", () => {
    const transcript = {
      speakers: [{ code: "a", label: "Haris" }],
      turns: [
        { id: "t1", speaker: "a", text: "Shumail, your email is shumail at gmail dot com, right?" },
        { id: "t2", speaker: "a", text: "AFK, draft an email to Shumail about the interview." },
      ],
    };
    const command = {
      id: "t2",
      kind: "email" as const,
      turnId: "t2",
      sentence: "AFK, draft an email to Shumail about the interview.",
      rest: "draft an email to Shumail about the interview.",
    };
    const { commands, report } = groundCommandParse(
      {
        commands: [
          {
            id: "t2",
            understood: true,
            task: null,
            email: {
              toNames: ["Shumail"],
              toAddresses: ["Shumail@Gmail.com", "shumail@yahoo.com"],
              subject: "Your interview",
              body: "Hi Shumail, ...",
            },
            followup: null,
            remind: null,
          },
        ],
      },
      [command],
      transcript,
    );
    expect(commands[0]).toMatchObject({
      status: "proposed",
      args: { toNames: ["Shumail"], toAddresses: ["shumail@gmail.com"] },
    });
    expect(report.cleared).toEqual([expect.stringContaining("an address was not said")]);
  });
});

describe("the grounding context", () => {
  it("is a minute each way by the source timings when turns carry start times", () => {
    const transcript = {
      speakers: [{ code: "h", label: "Host" }],
      turns: [
        { id: "t0", text: "Priya should own this.", startSec: 0 },
        { id: "t1", text: "Let's talk later.", startSec: 100 },
        { id: "t2", text: "AFK, task: send the deck.", startSec: 130 },
        { id: "t3", text: "Sam can do it by Friday.", startSec: 170 },
        { id: "t4", text: "Lee said Monday.", startSec: 400 },
      ],
    };
    const command = {
      id: "t2",
      kind: "task" as const,
      turnId: "t2",
      sentence: "AFK, task: send the deck.",
      rest: "send the deck.",
    };
    const parse = (ownerName: string, dueText: string) => ({
      commands: [
        {
          id: "t2",
          understood: true,
          task: { text: "Send the deck", ownerSpeaker: null, ownerName, dueText },
          email: null,
          followup: null,
          remind: null,
        },
      ],
    });
    const near = groundCommandParse(parse("Sam", "by Friday"), [command], transcript);
    expect(near.commands[0]).toMatchObject({ args: { ownerName: "Sam", dueText: "by Friday" } });
    const far = groundCommandParse(parse("Priya", "Monday"), [command], transcript);
    expect(far.commands[0]).toMatchObject({ args: { ownerName: null, dueText: null } });
    expect(far.report.cleared).toEqual([
      "command 1: owner name not said",
      "command 1: due date not said",
    ]);
  });
});
