import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
});

// No path below reaches the database: the refusal comes first, and the page read has no
// session and no read bucket. A call would fail the test loudly.
vi.mock("@/lib/supabase-admin-client", () => ({
  createAdminClient: () => {
    throw new Error("the proxy should not have reached the database");
  },
}));

const { proxy } = await import("./proxy");

describe("proxy", () => {
  it("refuses a write sent by another site's page before any route runs", async () => {
    const response = await proxy(
      new NextRequest("https://afk.example/api/m/abcdefghjkmn/pin", {
        method: "POST",
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ pin: "0000" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("lets a page through with a fresh policy nonce on each request", async () => {
    const policy = async () =>
      (await proxy(new NextRequest("https://afk.example/samples"))).headers.get(
        "content-security-policy",
      ) ?? "";
    const [first, second] = [await policy(), await policy()];
    expect(first).toMatch(/'nonce-[^']+'/);
    expect(first).not.toBe(second);
  });
});
