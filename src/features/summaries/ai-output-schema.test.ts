import { describe, expect, it } from "vitest";
import { z } from "zod";

import { analysisSchema, summariesSchema } from "./ai-output-schema";
import { formatTranscript } from "./prompts";

describe("the schemas sent to the Claude API", () => {
  it("convert to JSON Schema with every field required", () => {
    const analysis = z.toJSONSchema(analysisSchema) as { required?: string[] };
    expect(analysis.required).toEqual(["headline", "chapters", "actions", "decisions"]);
    const summaries = z.toJSONSchema(summariesSchema) as { required?: string[] };
    expect(summaries.required).toEqual(["templates"]);
  });

  const analysis = {
    headline: "The group agreed to record seat numbers.",
    chapters: [{ title: "Overlaps", firstTurnId: "bmr007-0000" }],
    actions: [
      {
        text: "Add a seat number to the forms",
        ownerSpeaker: "Speaker E",
        ownerName: null,
        dueText: null,
        turnIds: ["bmr007-0000"],
      },
    ],
    decisions: [{ text: "Seat numbers go on the forms", turnIds: ["bmr007-0000"] }],
  };

  it("accept well-formed analysis output", () => {
    expect(analysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("refuse an item that cites nothing, text past its limit, and too many chapters", () => {
    const uncited = { ...analysis, decisions: [{ text: "x", turnIds: [] }] };
    expect(analysisSchema.safeParse(uncited).success).toBe(false);
    const long = { ...analysis, headline: "h".repeat(2000) };
    expect(analysisSchema.safeParse(long).success).toBe(false);
    const chapters = Array.from({ length: 40 }, (_, i) => ({
      title: `Chapter ${i}`,
      firstTurnId: `bmr007-${String(i).padStart(4, "0")}`,
    }));
    expect(analysisSchema.safeParse({ ...analysis, chapters }).success).toBe(false);
  });
});

describe("transcript prompt", () => {
  it("puts each turn on one line with its id, time and speaker label", () => {
    const text = formatTranscript({
      title: "Meeting Recorder project meeting",
      recordedAt: null,
      durationSec: 75,
      speakers: [{ code: "me013", label: "Speaker A" }],
      turns: [{ id: "bmr007-0000", speaker: "me013", startSec: 62, text: "Hello." }],
    });
    expect(text).toContain("[bmr007-0000] 1:02 Speaker A: Hello.");
    expect(text).toContain("<transcript>");
  });
});
