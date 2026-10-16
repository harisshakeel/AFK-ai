import { describe, expect, it, vi } from "vitest";

import type { ClaudeRunner } from "./claude";
import {
  applyRomanized,
  chunkTurns,
  formatTurnsForRomanizing,
  needsRomanizing,
  romanizeInstruction,
  romanizeTurns,
} from "./romanize";

const turns = [
  { id: "m-0000", speaker: "a", text: "Right, let's start with the agenda." },
  { id: "m-0001", speaker: "b", text: "कैसे हो, आज का क्या agenda है?" },
  { id: "m-0002", speaker: "a", text: "AFK, task for Sam: send the deck by Friday." },
  { id: "m-0003", speaker: "b", text: "ٹھیک ہے، کل بھیج دوں گا" },
];

function runner(answer: (data: string) => unknown, fail = false): ClaudeRunner {
  return {
    async runStructured(input) {
      if (fail) throw new Error("boom");
      return {
        data: answer(input.data) as never,
        run: {
          model: "claude-sonnet-5-5",
          durationMs: 1,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.0007,
        },
      };
    },
  };
}

const log = () => {};

describe("Roman Urdu for the turns a multilingual transcriber wrote in another script", () => {
  it("tells Devanagari and Arabic script from Latin", () => {
    expect(needsRomanizing("आज का agenda")).toBe(true);
    expect(needsRomanizing("ٹھیک ہے")).toBe(true);
    expect(needsRomanizing("aaj ka kya agenda hai")).toBe(false);
    expect(needsRomanizing("José, 3pm")).toBe(false);
  });

  it("chunks only the turns that need it, by size, and stops at the cap", () => {
    const { chunks, capped } = chunkTurns(turns);
    expect(chunks).toEqual([
      [
        { id: "m-0001", text: turns[1]!.text },
        { id: "m-0003", text: turns[3]!.text },
      ],
    ]);
    expect(capped).toBe(false);
    const small = chunkTurns(turns, { chunkChars: 10 });
    expect(small.chunks.map((chunk) => chunk.map((turn) => turn.id))).toEqual([
      ["m-0001"],
      ["m-0003"],
    ]);
    const tight = chunkTurns(turns, { cap: 30 });
    expect(tight.chunks.map((chunk) => chunk.map((turn) => turn.id))).toEqual([["m-0001"]]);
    expect(tight.capped).toBe(true);
  });

  it("formats a chunk as bracketed ids with tags bent, and the instruction forbids translating", () => {
    const text = formatTurnsForRomanizing([{ id: "m-0001", text: "<b>आज</b>" }]);
    expect(text).toBe("<turns>\n[m-0001] ‹b›आज‹/b›\n</turns>\n\n");
    expect(romanizeInstruction()).toContain("never translate");
  });

  it("puts the model's lines in for the ids asked, and nothing else", () => {
    const requested = new Set(["m-0001", "m-0003"]);
    const { turns: result, applied } = applyRomanized(
      turns,
      [
        { id: "m-0001", text: "kaise ho, aaj ka kya  agenda\nhai?" },
        { id: "m-0003", text: "   " },
        { id: "m-0000", text: "should be ignored" },
        { id: "m-9999", text: "unknown" },
      ],
      requested,
    );
    expect(applied).toBe(1);
    expect(result[1]).toEqual({
      id: "m-0001",
      speaker: "b",
      text: "kaise ho, aaj ka kya agenda hai?",
    });
    expect(result[0]).toBe(turns[0]);
    expect(result[3]).toBe(turns[3]);
  });

  it("rewrites the non-Latin turns in parallel chunks and reports the counts and the spend", async () => {
    const claude = runner((data) => {
      expect(data).toContain("[m-0001]");
      return {
        turns: [
          { id: "m-0001", text: "kaise ho, aaj ka kya agenda hai?" },
          { id: "m-0003", text: "theek hai, kal bhej doon ga" },
        ],
      };
    });
    const { turns: result, report } = await romanizeTurns(claude, turns, {
      timeoutMs: 120_000,
      log,
      meetingId: "m",
    });
    expect(result.map((turn) => turn.text)).toEqual([
      turns[0]!.text,
      "kaise ho, aaj ka kya agenda hai?",
      turns[2]!.text,
      "theek hai, kal bhej doon ga",
    ]);
    expect(report).toEqual({
      romanized: 2,
      romanizeCalls: 1,
      romanizeFailed: 0,
      romanizeCapped: false,
      romanizeInputTokens: 100,
      romanizeOutputTokens: 50,
      romanizeCostUsd: 0.0007,
    });
  });

  it("leaves the turns as transcribed when the call fails, when there is no time, or when nothing needs it", async () => {
    const seen = vi.fn();
    const failing = runner(() => ({ turns: [] }), true);
    const failed = await romanizeTurns(failing, turns, {
      timeoutMs: 120_000,
      log: seen,
      meetingId: "m",
    });
    expect(failed.turns).toEqual(turns);
    expect(failed.report).toMatchObject({ romanized: 0, romanizeCalls: 0, romanizeFailed: 1 });
    expect(seen).toHaveBeenCalledWith("romanize.failed", expect.objectContaining({ count: 2 }));

    const late = await romanizeTurns(failing, turns, { timeoutMs: 5_000, log, meetingId: "m" });
    expect(late.turns).toEqual(turns);
    expect(late.report).toEqual({ romanized: 0, romanizeSkipped: "no time left" });

    const latin = await romanizeTurns(failing, [turns[0]!, turns[2]!], {
      timeoutMs: 120_000,
      log,
      meetingId: "m",
    });
    expect(latin.report).toEqual({ romanized: 0 });
  });
});
