import { describe, expect, it } from "vitest";

import { normaliseWords, saidIn } from "./words";

describe("words as grounding compares them", () => {
  it("folds case and punctuation, and keeps letters of any script", () => {
    expect(normaliseWords("  Send the DECK, by Friday! ")).toBe("send the deck by friday");
    expect(normaliseWords("kal bhej doon ga — ٹھیک")).toBe("kal bhej doon ga ٹھیک");
  });

  it("finds whole words only", () => {
    expect(saidIn("the deck", ["Sam, send the deck by Friday."])).toBe(true);
    expect(saidIn("Sam", ["Samir will do it"])).toBe(false);
    expect(saidIn("am the des", ["Sam the designer"])).toBe(false);
    expect(saidIn("  ", ["anything"])).toBe(false);
  });
});
