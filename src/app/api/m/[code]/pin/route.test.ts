import { describe, expect, it, vi } from "vitest";

import { fakeClient, type FakeClient } from "@/test/fake-supabase";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
});

const state = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import("./route");
const { grantCookieName, verifyGrant } = await import("@/features/meeting-link/link-grant");

const CODE = "abcdefghjkmn";

function setUp(outcome: unknown): FakeClient {
  const admin = fakeClient({ rpc: { open_meeting_link: { data: outcome, error: null } } });
  state.admin = admin;
  return admin;
}

const enter = (pin: string, code = CODE) =>
  POST(
    new Request(`https://afk.example/api/m/${code}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ pin }),
    }),
    { params: Promise.resolve({ code }) },
  );

describe("POST /api/m/[code]/pin", () => {
  it("gives a right PIN a signed grant for that code, HttpOnly and Secure on https", async () => {
    setUp({ ok: true, meetingId: "m1" });
    const response = await enter("0420");
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${grantCookieName(CODE)}=`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    expect(verifyGrant(CODE, value, process.env.SUPABASE_SECRET_KEY!)).toBe(true);
  });

  it("answers a wrong PIN with the tries left and a lock with 423, and sets no grant", async () => {
    setUp({ ok: false, reason: "wrong", triesLeft: 3 });
    const wrong = await enter("1111");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ reason: "wrong", triesLeft: 3 });
    expect(wrong.headers.get("set-cookie")).toBeNull();
    setUp({ ok: false, reason: "locked" });
    expect((await enter("1111")).status).toBe(423);
  });

  it("refuses a malformed code or PIN before asking the database", async () => {
    const admin = setUp({ ok: true, meetingId: "m1" });
    expect((await enter("0420", "SHORT")).status).toBe(404);
    expect((await enter("12a")).status).toBe(400);
    expect(admin.calls).toEqual([]);
  });
});
