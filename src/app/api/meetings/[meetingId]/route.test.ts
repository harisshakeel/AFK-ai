import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AttendeeModule from "@/features/capture/attendee";
import { claimsFor, fakeClient, type FakeClient } from "@/test/fake-supabase";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
  process.env.ATTENDEE_API_KEY = "attendee_test_key";
});

// The edges only: the Supabase clients, the logger and Attendee's client. AttendeeError
// stays the real class, since the route decides on its status.
const state = vi.hoisted(() => ({
  visitor: null as unknown,
  admin: null as unknown,
  attendee: {
    leaveBot: async (_id: string): Promise<unknown> => ({}),
    deleteBot: async (_id: string): Promise<unknown> => ({}),
    deleteData: async (_id: string): Promise<unknown> => ({}),
  },
}));
vi.mock("@/server/db/supabase-server", () => ({
  createSupabaseServerClient: async () => state.visitor,
}));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/capture/attendee", async (importOriginal) => ({
  ...(await importOriginal<typeof AttendeeModule>()),
  createAttendeeClient: () => state.attendee,
}));

const { DELETE } = await import("./route");
const { AttendeeError } = await import("@/features/capture/attendee");

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEETING = "22222222-2222-4222-8222-222222222222";

function setUp(meeting: Record<string, unknown> | null) {
  const rows = meeting ? [{ id: MEETING, owner_id: OWNER, bot_id: null, ...meeting }] : [];
  const visitor = fakeClient({ claims: claimsFor(OWNER), tables: { meetings: rows } });
  const admin = fakeClient();
  state.visitor = visitor;
  state.admin = admin;
  return { admin };
}

const remove = () =>
  DELETE(new Request(`https://afk.example/api/meetings/${MEETING}`, { method: "DELETE" }), {
    params: Promise.resolve({ meetingId: MEETING }),
  });

const deleted = (admin: FakeClient) => admin.calls.some((call) => call.fn === "delete meetings");

beforeEach(() => {
  state.attendee = {
    leaveBot: vi.fn(async () => ({})),
    deleteBot: vi.fn(async () => ({})),
    deleteData: vi.fn(async () => ({})),
  };
});

describe("DELETE /api/meetings/[meetingId]", () => {
  it("deletes the owner's meeting, and nobody else's", async () => {
    const own = setUp({ status: "ready" });
    expect((await remove()).status).toBe(200);
    expect(deleted(own.admin)).toBe(true);
    const theirs = setUp({ status: "ready", owner_id: "00000000-0000-4000-8000-000000000009" });
    expect((await remove()).status).toBe(404);
    expect(deleted(theirs.admin)).toBe(false);
  });

  it("makes a recording bot leave first, and tells Attendee to forget the data", async () => {
    const { admin } = setUp({ status: "recording", bot_id: "bot_1" });
    expect((await remove()).status).toBe(200);
    expect(state.attendee.leaveBot).toHaveBeenCalledWith("bot_1");
    expect(state.attendee.deleteData).toHaveBeenCalledWith("bot_1");
    expect(deleted(admin)).toBe(true);
  });

  it("deletes a scheduled bot rather than asking it to leave", async () => {
    setUp({ status: "scheduled", bot_id: "bot_2" });
    expect((await remove()).status).toBe(200);
    expect(state.attendee.deleteBot).toHaveBeenCalledWith("bot_2");
    expect(state.attendee.leaveBot).not.toHaveBeenCalled();
  });

  it("goes on when the bot is already gone, and keeps the meeting when Attendee says nothing about the bot", async () => {
    const gone = setUp({ status: "recording", bot_id: "bot_3" });
    state.attendee.leaveBot = vi.fn(async () => {
      throw new AttendeeError("not in a call", 404);
    });
    expect((await remove()).status).toBe(200);
    expect(deleted(gone.admin)).toBe(true);
    // A refused key or a rate limit: the bot may still be recording, so nothing is deleted.
    for (const status of [401, 403, 429, 500]) {
      const kept = setUp({ status: "recording", bot_id: "bot_4" });
      state.attendee.leaveBot = vi.fn(async () => {
        throw new AttendeeError("refused", status);
      });
      expect((await remove()).status, String(status)).toBe(502);
      expect(deleted(kept.admin), String(status)).toBe(false);
    }
  });
});
