import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttendeeError } from "@/features/capture/attendee";
import { fakeClient, type FakeClient } from "@/test/fake-supabase";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
  process.env.ATTENDEE_API_KEY = "attendee_test_key";
  process.env.ATTENDEE_WEBHOOK_SECRET = Buffer.from("test-webhook-secret-1234").toString("base64");
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "afk.example";
});

// The edges: the admin client, Attendee's client and the logger.
const state = vi.hoisted(() => ({
  admin: null as unknown,
  attendee: {
    createBot: vi.fn(async () => ({ id: "bot_new" })),
    leaveBot: vi.fn(async () => ({})),
    deleteBot: vi.fn(async () => ({})),
    deleteData: vi.fn(async () => undefined),
  },
}));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
// One meeting id for every send, so a test can hold the row a send writes.
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  randomUUID: () => "44444444-4444-4444-8444-444444444444",
}));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/capture/attendee", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAttendeeClient: () => state.attendee,
}));

const { adoptOrphanBot, sendBot } = await import("./bots");

const input = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  link: { url: "https://meet.google.com/abc-defg-hij", platform: "meet" as const },
  title: "Launch sync",
  senderNames: ["haris"],
  senderKey: null,
  joinAt: null,
  calendarEventId: null,
};

function setUp(failIdWrite: boolean): FakeClient {
  const admin = fakeClient({
    failures: failIdWrite
      ? { "update meetings": { code: "57014", message: "statement timeout" } }
      : {},
  });
  state.admin = admin;
  return admin;
}

beforeEach(() => {
  for (const fn of Object.values(state.attendee)) fn.mockClear();
});

describe("sendBot", () => {
  it("creates the bot and puts its id on the meeting", async () => {
    const admin = setUp(false);
    const outcome = await sendBot(input);
    expect(outcome).toMatchObject({ ok: true });
    expect(admin.calls.map((call) => call.fn)).toEqual(["insert meetings", "update meetings"]);
    expect(admin.calls[1]?.args).toEqual({ bot_id: "bot_new" });
  });

  it("takes the bot back when its id cannot be saved, so none records a call AFK cannot see", async () => {
    setUp(true);
    expect(await sendBot(input)).toEqual({ ok: false, code: "insert" });
    expect(state.attendee.leaveBot).toHaveBeenCalledWith("bot_new");
    // A scheduled bot has not joined: it is deleted rather than told to leave.
    setUp(true);
    await sendBot({ ...input, joinAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(state.attendee.deleteBot).toHaveBeenCalledWith("bot_new");
  });

  it("fails a send whose create timed out, unless the bot's first event already placed it", async () => {
    state.attendee.createBot.mockRejectedValueOnce(new Error("TimeoutError"));
    setUp(false);
    expect(await sendBot(input)).toEqual({ ok: false, code: "provider" });
    // The bot's event came first and the webhook gave the row its id: it was sent.
    state.attendee.createBot.mockRejectedValueOnce(new Error("TimeoutError"));
    state.admin = fakeClient({
      tables: {
        meetings: [
          { id: "44444444-4444-4444-8444-444444444444", bot_id: "bot_new", status: "recording" },
        ],
      },
    });
    expect(await sendBot(input)).toEqual({
      ok: true,
      meetingId: "44444444-4444-4444-8444-444444444444",
    });
  });
});

describe("adoptOrphanBot (audit F3)", () => {
  const MEETING = "22222222-2222-4222-8222-222222222222";
  const orphan = (row: Record<string, unknown>) => {
    const admin = fakeClient({
      tables: { meetings: [{ id: MEETING, bot_id: null, scheduled_for: null, ...row }] },
    });
    state.admin = admin;
    return admin;
  };

  it("gives a row still waiting for its bot the bot's id", async () => {
    const admin = orphan({ status: "requested" });
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("attached");
    expect(admin.calls).toEqual([{ fn: "update meetings", args: { bot_id: "bot_lost" } }]);
    expect(state.attendee.leaveBot).not.toHaveBeenCalled();
  });

  it("takes back the bot of a row its sender was told had failed, then records its id", async () => {
    const admin = orphan({ status: "failed" });
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("taken_back");
    expect(state.attendee.leaveBot).toHaveBeenCalledWith("bot_lost");
    expect(admin.calls).toEqual([{ fn: "update meetings", args: { bot_id: "bot_lost" } }]);
    // A scheduled one is deleted; one that has already joined cannot be, so it leaves.
    orphan({ status: "failed", scheduled_for: "2026-10-20T10:00:00Z" });
    state.attendee.deleteBot.mockRejectedValueOnce(new Error("joined"));
    state.attendee.leaveBot.mockClear();
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("taken_back");
    expect(state.attendee.deleteBot).toHaveBeenCalledWith("bot_lost");
    expect(state.attendee.leaveBot).toHaveBeenCalledWith("bot_lost");
  });

  it("keeps the id off the row when the take-back fails, so the next event tries again", async () => {
    const admin = orphan({ status: "failed" });
    state.attendee.leaveBot.mockRejectedValueOnce(new Error("timeout"));
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("none");
    expect(admin.calls).toEqual([]);
  });

  it("takes back a bot already gone as taken back, so its id is saved and not retried", async () => {
    const admin = orphan({ status: "failed" });
    state.attendee.leaveBot.mockRejectedValueOnce(new AttendeeError("gone", 404));
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("taken_back");
    expect(admin.calls).toEqual([{ fn: "update meetings", args: { bot_id: "bot_lost" } }]);
  });

  it("tries again on a refusal that does not say the bot is gone", async () => {
    const admin = orphan({ status: "failed" });
    state.attendee.leaveBot.mockRejectedValueOnce(new AttendeeError("wrong state", 400));
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("none");
    expect(admin.calls).toEqual([]);
  });

  it("takes back a bot whose meeting was deleted, and one made for a row with another bot", async () => {
    const gone = orphan({ status: "failed" });
    expect(await adoptOrphanBot("bot_lost", "33333333-3333-4333-8333-333333333333")).toBe(
      "taken_back",
    );
    // Whether it was scheduled is unknown: delete first; and its recording goes too.
    expect(state.attendee.deleteBot).toHaveBeenCalledWith("bot_lost");
    expect(state.attendee.deleteData).toHaveBeenCalledWith("bot_lost");
    const other = orphan({ status: "recording", bot_id: "bot_other" });
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("taken_back");
    expect(state.attendee.leaveBot).toHaveBeenCalledWith("bot_lost");
    // Neither row takes the bot's id.
    expect([...gone.calls, ...other.calls]).toEqual([]);
  });

  it("leaves alone the row's own bot, and a row without a bot that is neither waiting nor failed", async () => {
    const own = orphan({ status: "recording", bot_id: "bot_lost" });
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("none");
    const done = orphan({ status: "ready" });
    expect(await adoptOrphanBot("bot_lost", MEETING)).toBe("none");
    expect([...own.calls, ...done.calls]).toEqual([]);
    expect(state.attendee.leaveBot).not.toHaveBeenCalled();
    expect(state.attendee.deleteBot).not.toHaveBeenCalled();
  });
});
