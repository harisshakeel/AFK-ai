import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, newNonce } from "./csp";

describe("content security policy", () => {
  it("allows scripts only with the request's nonce and talks only to this site and Supabase", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "abc123",
      supabaseOrigin: "https://project.supabase.co",
      isDev: false,
    });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://project.supabase.co");
    // Recordings: the seed audio from Supabase, a bot meeting's video from wherever the
    // bot provider's storage answers (https only); no other directive opens up.
    expect(csp).toContain("media-src 'self' https://project.supabase.co https:");
    expect(csp).not.toMatch(/(connect|img|script|font)-src[^;]*https:(\s|;)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds eval in development only, where React needs it for error overlays", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "n",
      supabaseOrigin: "http://127.0.0.1:54321",
      isDev: true,
    });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("makes a fresh, attribute-safe nonce each time", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.length).toBeGreaterThanOrEqual(22);
  });
});
