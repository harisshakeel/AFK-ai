import { describe, expect, it } from "vitest";

import type { Analysis } from "./ai-output-schema";
import { groundAnalysis, groundSummaries } from "./grounding";

const transcript = {
  speakers: [
    { code: "me013", label: "Speaker A" },
    { code: "fe016", label: "Speaker B" },
  ],
  turns: [
    { id: "m-0000", text: "Let's start with the recorder." },
    { id: "m-0001", text: "We'll launch on the twentieth." },
    { id: "m-0002", text: "Morgan will send the deck by Friday." },
    { id: "m-0003", text: "I can take the pricing page." },
  ],
};

const analysis = (overrides: Partial<Analysis> = {}): Analysis => ({
  headline: "Launch date set.",
  chapters: [{ title: "Launch", firstTurnId: "m-0001" }],
  actions: [],
  decisions: [],
  ...overrides,
});

describe("groundAnalysis", () => {
  it("drops items that cite no real turn and keeps the real citations of the rest", () => {
    const { payload, report } = groundAnalysis(
      analysis({
        decisions: [
          { text: "Launch on the 20th", turnIds: ["m-0001", "m-9999"] },
          { text: "Invented", turnIds: ["m-9999"] },
        ],
      }),
      transcript,
    );
    expect(payload.decisions).toEqual([{ text: "Launch on the 20th", turnIds: ["m-0001"] }]);
    expect(report.dropped).toEqual(["decision 2: cites no real turn"]);
  });

  it("keeps an owner only when it is a speaker or a name said in a cited turn", () => {
    const { payload, report } = groundAnalysis(
      analysis({
        actions: [
          {
            text: "Send the deck",
            ownerSpeaker: null,
            ownerName: "Morgan",
            dueText: "by Friday",
            turnIds: ["m-0002"],
          },
          {
            text: "Pricing page",
            ownerSpeaker: "Speaker B",
            ownerName: null,
            dueText: null,
            turnIds: ["m-0003"],
          },
          {
            text: "Guessed owner",
            ownerSpeaker: null,
            ownerName: "Taylor",
            dueText: "Monday",
            turnIds: ["m-0003"],
          },
          {
            text: "Unknown speaker",
            ownerSpeaker: "Speaker Z",
            ownerName: null,
            dueText: null,
            turnIds: ["m-0003"],
          },
        ],
      }),
      transcript,
    );
    expect(
      payload.actions.map(({ ownerSpeaker, ownerName, dueText }) => ({
        ownerSpeaker,
        ownerName,
        dueText,
      })),
    ).toEqual([
      { ownerSpeaker: null, ownerName: "Morgan", dueText: "by Friday" },
      { ownerSpeaker: "fe016", ownerName: null, dueText: null },
      { ownerSpeaker: null, ownerName: null, dueText: null },
      { ownerSpeaker: null, ownerName: null, dueText: null },
    ]);
    expect(report.cleared).toHaveLength(3);
  });

  it("orders chapters by the meeting and starts the first at the first turn", () => {
    const { payload } = groundAnalysis(
      analysis({
        chapters: [
          { title: "Deck", firstTurnId: "m-0002" },
          { title: "Launch", firstTurnId: "m-0001" },
          { title: "Ghost", firstTurnId: "nope" },
        ],
      }),
      transcript,
    );
    expect(payload.chapters).toEqual([
      { title: "Launch", firstTurnId: "m-0000" },
      { title: "Deck", firstTurnId: "m-0002" },
    ]);
  });
});

describe("groundSummaries", () => {
  it("keeps known templates and sections in their defined order, and drops ungrounded points", () => {
    const { payload, report } = groundSummaries(
      {
        templates: [
          {
            key: "brief",
            sections: [
              {
                heading: "In three points",
                points: [
                  { text: "Launch on the 20th", turnIds: ["m-0001"] },
                  { text: "Deck by Friday", turnIds: ["m-0002"] },
                  { text: "Made up", turnIds: ["x"] },
                ],
              },
            ],
          },
          {
            key: "unknown",
            sections: [{ heading: "X", points: [{ text: "y", turnIds: ["m-0001"] }] }],
          },
        ],
      },
      transcript,
    );
    expect(payload.templates.map((template) => template.key)).toEqual(["brief"]);
    expect(payload.templates[0]?.sections[0]?.points).toHaveLength(2);
    expect(report.dropped).toContain("brief / In three points point 3: cites no real turn");
    expect(report.dropped).toContain("template catch_up: missing from the output");
  });
});
