import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { newTokenKey, openSecret, parseTokenKey, sealSecret, tokenBinding } from "./token-crypto";

describe("token sealing", () => {
  const key = newTokenKey();
  const binding = tokenBinding("00000000-0000-4000-8000-000000000003", "google");

  it("round-trips a token and never repeats a ciphertext", () => {
    const sealed = sealSecret("1//0refresh-token-with-unicode-é", key, binding);
    expect(sealed.startsWith("v2.")).toBe(true);
    expect(sealed).not.toContain("refresh");
    expect(openSecret(sealed, key, binding)).toBe("1//0refresh-token-with-unicode-é");
    expect(sealSecret("same", key, binding)).not.toBe(sealSecret("same", key, binding));
  });

  it("opens only for the row it was sealed for", () => {
    const sealed = sealSecret("secret", key, binding);
    const other = tokenBinding("00000000-0000-4000-8000-000000000004", "google");
    expect(() => openSecret(sealed, key, other)).toThrow(/cannot be opened/);
    expect(() =>
      openSecret(sealed, key, tokenBinding("00000000-0000-4000-8000-000000000003", "slack")),
    ).toThrow(/cannot be opened/);
  });

  it("still opens a value sealed before the binding existed", () => {
    // A v1 value: the same cipher with no authenticated data.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", parseTokenKey(key), iv);
    const ciphertext = Buffer.concat([cipher.update("old token", "utf8"), cipher.final()]);
    const legacy = [
      "v1",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
    expect(openSecret(legacy, key, binding)).toBe("old token");
  });

  it("refuses a tampered ciphertext, a wrong key and a malformed value", () => {
    const sealed = sealSecret("secret", key, binding);
    const [version, iv, ciphertext, tag] = sealed.split(".");
    const flipped = ciphertext!.startsWith("A")
      ? `B${ciphertext!.slice(1)}`
      : `A${ciphertext!.slice(1)}`;
    expect(() => openSecret([version, iv, flipped, tag].join("."), key, binding)).toThrow(
      /cannot be opened/,
    );
    expect(() => openSecret(sealed, newTokenKey(), binding)).toThrow(/cannot be opened/);
    expect(() => openSecret("v0.x.y.z", key, binding)).toThrow(/malformed/);
    expect(() => openSecret("not sealed", key, binding)).toThrow(/malformed/);
  });

  it("requires a 32-byte key", () => {
    expect(() => parseTokenKey(Buffer.from("short").toString("base64"))).toThrow(/32 random bytes/);
    expect(() => sealSecret("x", "", binding)).toThrow(/32 random bytes/);
  });
});
