import { describe, expect, it } from "vitest";

import { mediaLinkSchema, renewDelay, retryDelay } from "./use-renewing-media";

describe("renewing a recording's link", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");

  it("renews two minutes before the link expires, and never in a loop", () => {
    expect(renewDelay("2026-10-17T12:30:00Z", now)).toBe(28 * 60_000);
    // Already expired, or about to: shortly, not at once.
    expect(renewDelay("2026-10-17T11:00:00Z", now)).toBe(5_000);
    // An expiry that cannot be read waits a minute instead of firing for ever.
    expect(renewDelay("not a date", now)).toBe(60_000);
  });

  it("tries a failed renewal again a minute later, doubling, then leaves it to Retry", () => {
    expect([1, 2, 3, 4].map(retryDelay)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(retryDelay(5)).toBeNull();
  });

  it("accepts only a link the route really sent", () => {
    const link = { kind: "video", url: "https://media.example/v.mp4", expiresAt: "x" };
    expect(mediaLinkSchema.safeParse(link).success).toBe(true);
    expect(mediaLinkSchema.safeParse({ ...link, kind: "image" }).success).toBe(false);
    expect(mediaLinkSchema.safeParse({ error: "Not found." }).success).toBe(false);
  });
});
