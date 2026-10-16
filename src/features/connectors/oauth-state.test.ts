import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { newConnectState, openConnectState, pkceChallenge, sealConnectState } from "./oauth-state";
import { newTokenKey } from "./token-crypto";

describe("connect state", () => {
  const key = newTokenKey();
  const now = new Date("2026-10-20T12:00:00Z");

  it("round-trips, binds the user and provider, and expires", () => {
    const state = newConnectState("user-1", "google", now);
    expect(state.nonce).not.toBe(newConnectState("user-1", "google", now).nonce);
    const sealed = sealConnectState(state, key);
    expect(openConnectState(sealed, key, now)).toEqual(state);
    expect(openConnectState(sealed, key, new Date(now.getTime() + 11 * 60_000))).toBeNull();
  });

  it("refuses a forged, tampered or missing cookie", () => {
    const state = newConnectState("user-1", "slack", now);
    const sealed = sealConnectState(state, key);
    const [payload, signature] = sealed.split(".");
    expect(openConnectState(`${payload}.${signature!.slice(0, -2)}xx`, key, now)).toBeNull();
    const other = sealConnectState({ ...state, userId: "user-2" }, key).split(".")[0];
    expect(openConnectState(`${other}.${signature}`, key, now)).toBeNull();
    expect(openConnectState(sealed, newTokenKey(), now)).toBeNull();
    expect(openConnectState(undefined, key, now)).toBeNull();
    expect(openConnectState("garbage", key, now)).toBeNull();
  });

  it("is not signed with the token-sealing key itself", () => {
    const sealed = sealConnectState(newConnectState("user-1", "google", now), key);
    const [payload] = sealed.split(".");
    const raw = createHmac("sha256", Buffer.from(key, "base64"))
      .update(payload!)
      .digest("base64url");
    expect(openConnectState(`${payload}.${raw}`, key, now)).toBeNull();
  });

  it("derives the PKCE challenge as base64url SHA-256", () => {
    // RFC 7636 appendix B
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
