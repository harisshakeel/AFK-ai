import { describe, expect, it } from "vitest";

import { learnedLine } from "./files";
import { groundLearned, learnInstruction, learnSchema } from "./learn";

const turns = [
  { id: "m-0000", startSec: 0, text: "Ana leads QA from next month, as we agreed." },
  { id: "m-0001", startSec: 12.5, text: "The Atlas launch moves to the twentieth." },
  { id: "m-0002", startSec: 30, text: "PRM stands for the pricing model, by the way." },
];

describe("learned lines (requirement M3)", () => {
  it("keeps only lines whose quote is in the cited turn, drops repeats, and reports the rest", () => {
    const { kept, dropped } = groundLearned(
      [
        {
          file: "context/people.md",
          text: "Ana leads QA",
          turnId: "m-0000",
          quote: "Ana leads QA",
        },
        {
          file: "context/projects.md",
          text: "The Atlas launch is on the twentieth",
          turnId: "m-0001",
          quote: "launch moves to the twentieth",
        },
        // Cites a turn that does not exist.
        {
          file: "context/people.md",
          text: "Lee joined sales",
          turnId: "m-0099",
          quote: "Lee joined sales",
        },
        // The quote is not in its turn.
        {
          file: "context/glossary.md",
          text: "PRM is the pricing model",
          turnId: "m-0002",
          quote: "PRM is the price",
        },
        // Too short a quote.
        {
          file: "context/glossary.md",
          text: "PRM is the pricing model",
          turnId: "m-0002",
          quote: "PRM stands",
        },
        // A repeat of the first line, differently spaced and cased.
        {
          file: "context/people.md",
          text: "ana  leads qa",
          turnId: "m-0000",
          quote: "Ana leads QA from",
        },
        // Punctuation and case differ from the turn; still the same words.
        {
          file: "context/glossary.md",
          text: "PRM means the pricing model",
          turnId: "m-0002",
          quote: "prm stands for the pricing model",
        },
      ],
      turns,
    );
    expect(kept.map((line) => [line.file, line.text, line.startSec])).toEqual([
      ["context/people.md", "Ana leads QA", 0],
      ["context/projects.md", "The Atlas launch is on the twentieth", 12.5],
      ["context/glossary.md", "PRM means the pricing model", 30],
    ]);
    expect(dropped).toEqual([
      "line 3: cites no real turn",
      "line 4: its quote is not in the cited turn",
      "line 5: its quote is not in the cited turn",
      "line 6: repeats an earlier line",
    ]);
  });

  it("caps at ten lines in the check, never by refusing the model's answer", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      file: "context/people.md" as const,
      text: `Fact ${index}`,
      turnId: "m-0000",
      quote: "Ana leads QA",
    }));
    // Twelve lines, one of them long and one in no context file: the answer still parses.
    const odd = [
      ...many,
      { file: "context/people.md", text: "A".repeat(400), turnId: "m-0000", quote: "Ana leads QA" },
      { file: "notes.md", text: "Somewhere else", turnId: "m-0000", quote: "Ana leads QA" },
    ];
    expect(learnSchema.safeParse({ lines: odd }).success).toBe(true);
    const { kept, dropped } = groundLearned(many, turns);
    expect(kept).toHaveLength(10);
    expect(dropped).toEqual(["line 11: past the limit of 10", "line 12: past the limit of 10"]);
    const misfiled = groundLearned(odd.slice(12), turns);
    expect(misfiled.kept.map((line) => line.text.length)).toEqual([300]);
    expect(misfiled.dropped).toEqual(["line 2: names no context file"]);
  });

  it("writes each kept line dated, ending with the meeting and the moment", () => {
    expect(learnedLine("2026-10-21", "Ana leads QA.", "Weekly sync", 12.5)).toBe(
      "- [2026-10-21] Ana leads QA (Weekly sync, at 0:12)",
    );
    expect(learnInstruction()).toContain("never repeat a line from it");
  });
});
