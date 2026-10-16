import { describe, expect, it } from "vitest";

import { analysisInstruction, explicitItemsBlock } from "./prompts";

describe("explicit items in the analysis prompt (requirement C3)", () => {
  it("is empty without items, and otherwise lists them as data the model must not repeat", () => {
    expect(explicitItemsBlock([])).toBe("");
    const block = explicitItemsBlock([
      {
        kind: "decision",
        text: "Launch on the twentieth <b>",
        ownerLabel: null,
        dueText: null,
      },
      { kind: "action", text: "Send the  deck", ownerLabel: "Speaker B", dueText: "by Friday" },
    ]);
    expect(block.startsWith("<explicit_items>")).toBe(true);
    expect(block).toContain("- decision · Launch on the twentieth ‹b›");
    expect(block).toContain("- action · Send the deck · owner: Speaker B · due: by Friday");
    expect(block).toContain("Do not return them again");
    expect(block.endsWith("</explicit_items>\n\n")).toBe(true);
    // The instruction tells the model what the block means.
    expect(analysisInstruction()).toContain("<explicit_items>");
  });
});
