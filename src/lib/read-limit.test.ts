import { describe, expect, it } from "vitest";

import { clientAddress, clientKey, readBucketFor } from "./read-limit";

describe("read limits", () => {
  it("throttles only the public read paths", () => {
    expect(readBucketFor("/search")).toBe("search");
    expect(readBucketFor("/share/" + "a".repeat(64))).toBe("share");
    expect(readBucketFor("/api/meetings/bmr007/media")).toBe("media");
    expect(readBucketFor("/api/health")).toBe("health");
    expect(readBucketFor("/")).toBeNull();
    expect(readBucketFor("/meetings/bmr007")).toBeNull();
    expect(readBucketFor("/api/meetings/bmr007")).toBeNull();
    expect(readBucketFor("/searching")).toBeNull();
  });

  it("takes the platform's first forwarded hop, and falls back to one shared key", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9",
    );
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(clientAddress(new Headers())).toBe("local");
  });

  it("keys clients by a keyed hash, never the address", () => {
    const key = clientKey("203.0.113.9", "server-secret");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(clientKey("203.0.113.9", "server-secret")).toBe(key);
    expect(clientKey("203.0.113.9", "other-secret")).not.toBe(key);
    expect(clientKey("203.0.113.8", "server-secret")).not.toBe(key);
  });
});
