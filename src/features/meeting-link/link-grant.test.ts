import { describe, expect, it } from "vitest";

import { GRANT_DAYS, grantCookieName, mintGrant, verifyGrant } from "./link-grant";

const SECRET = "a-server-secret-of-some-length";

describe("the grant a right PIN earns", () => {
  it("is a signed cookie for one code, good for seven days, and for nothing else", () => {
    const now = Date.parse("2026-10-16T10:00:00Z");
    const value = mintGrant("abcdefghjkmn", SECRET, now);
    expect(grantCookieName("abcdefghjkmn")).toBe("afk-m-abcdefghjkmn");
    expect(verifyGrant("abcdefghjkmn", value, SECRET, now)).toBe(true);
    expect(verifyGrant("abcdefghjkmn", value, SECRET, now + (GRANT_DAYS * 86_400_000 - 1))).toBe(
      true,
    );
    // Another code, another secret, a tampered expiry, after expiry, or nothing at all.
    expect(verifyGrant("abcdefghjkmp", value, SECRET, now)).toBe(false);
    expect(verifyGrant("abcdefghjkmn", value, "other-secret", now)).toBe(false);
    const [expiry, signature] = value.split(".");
    expect(verifyGrant("abcdefghjkmn", `${Number(expiry) + 1}.${signature}`, SECRET, now)).toBe(
      false,
    );
    expect(verifyGrant("abcdefghjkmn", value, SECRET, now + GRANT_DAYS * 86_400_000)).toBe(false);
    expect(verifyGrant("abcdefghjkmn", undefined, SECRET, now)).toBe(false);
    expect(verifyGrant("abcdefghjkmn", "garbage", SECRET, now)).toBe(false);
  });
});
