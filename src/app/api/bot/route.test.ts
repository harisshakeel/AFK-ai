import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimsFor, fakeClient } from "@/test/fake-supabase";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
});

// The edges: the visitor's client, sendBot() (which calls Attendee and writes the row
// under the database's caps) and the calendar read. Validation and refusals run as written.
type Outcome = { ok: boolean; meetingId?: string; code?: string };
const state = vi.hoisted(() => {
  const outcome: Outcome = { ok: true, meetingId: "m-new" };
  return { visitor: null as unknown, outcome };
});
vi.mock("@/server/db/supabase-server", () => ({
  createSupabaseServerClient: async () => state.visitor,
}));
vi.mock("@/server/bots", () => ({ sendBot: vi.fn(async () => state.outcome) }));
vi.mock("@/server/calendar-invitees", () => ({ inviteesForMeeting: async () => [] }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import("./route");
const { sendBot } = await import("@/server/bots");

const USER = "00000000-0000-4000-8000-000000000001";
const MEET = "https://meet.google.com/abc-defg-hij";

const send = (body: unknown, kind: "google" | "guest" = "guest") => {
  state.visitor = fakeClient({ claims: claimsFor(USER, kind) });
  return POST(
    new Request("https://afk.example/api/bot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  vi.mocked(sendBot).mockClear();
  state.outcome = { ok: true, meetingId: "m-new" };
});

describe("POST /api/bot", () => {
  it("sends the bot for a guest who says the name they show in the call", async () => {
    const response = await send({ meetingUrl: MEET, senderName: "Haris" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ meetingId: "m-new" });
    expect(vi.mocked(sendBot).mock.calls[0]?.[0]).toMatchObject({
      ownerId: USER,
      link: { url: MEET, platform: "meet" },
      senderNames: ["haris"],
      senderKey: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it("refuses before sending: a guest with no name, a link to no meeting, a time out of range", async () => {
    expect((await send({ meetingUrl: MEET })).status).toBe(400);
    expect(
      (await send({ meetingUrl: "https://teams.microsoft.com/", senderName: "Haris" })).status,
    ).toBe(400);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect((await send({ meetingUrl: MEET, senderName: "Haris", joinAt: past })).status).toBe(400);
    const far = new Date(Date.now() + 120 * 86_400_000).toISOString();
    expect((await send({ meetingUrl: MEET, senderName: "Haris", joinAt: far })).status).toBe(400);
    expect(sendBot).not.toHaveBeenCalled();
  });

  it("says which cap stopped it, guests' share included", async () => {
    for (const [code, status] of [
      ["cap_user", 429],
      ["cap_site", 503],
      ["cap_guests", 503],
      ["active", 409],
    ] as const) {
      state.outcome = { ok: false, code };
      const response = await send({ meetingUrl: MEET, senderName: "Haris" });
      expect(response.status, code).toBe(status);
    }
    state.outcome = { ok: false, code: "cap_guests" };
    const guests = await send({ meetingUrl: MEET, senderName: "Haris" });
    expect(await guests.json()).toMatchObject({ error: expect.stringContaining("Google") });
  });
});
