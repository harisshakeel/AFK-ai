import { describe, expect, it } from "vitest";

import { nextRefreshDelay } from "./auto-refresh";

describe("nextRefreshDelay", () => {
  const options = { everyMs: 10_000, maxMs: 30_000, stopAfterMs: 20 * 60_000 };

  it("starts at the given pace, then backs off to the cap", () => {
    const delays: number[] = [];
    let delay: number | null = null;
    for (let i = 0; i < 6; i += 1) {
      delay = nextRefreshDelay(delay, 0, options);
      delays.push(delay ?? -1);
    }
    expect(delays).toEqual([10_000, 15_000, 22_500, 30_000, 30_000, 30_000]);
  });

  it("stops once the page has waited long enough, and never stops without a limit", () => {
    expect(nextRefreshDelay(30_000, 20 * 60_000, options)).toBeNull();
    expect(nextRefreshDelay(30_000, 3 * 3_600_000, { everyMs: 10_000, maxMs: 30_000 })).toBe(
      30_000,
    );
  });
});
