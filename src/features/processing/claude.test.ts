import { describe, expect, it } from "vitest";

import { estimateCostUsd } from "./claude";

describe("estimateCostUsd", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  it("prices the dated model id the API answers with, like the plain one", () => {
    expect(estimateCostUsd("claude-haiku-4-5", usage)).toBe(1);
    expect(estimateCostUsd("claude-haiku-4-5-20251001", usage)).toBe(1);
  });

  it("is null for a model it has no price for, never a guess", () => {
    expect(estimateCostUsd("claude-haiku-4-5-fast", { ...usage })).toBeNull();
    expect(estimateCostUsd("some-other-model", usage)).toBeNull();
  });
});
