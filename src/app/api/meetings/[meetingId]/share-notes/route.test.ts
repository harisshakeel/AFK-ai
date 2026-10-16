import { describe, expect, it, vi } from "vitest";

import { claimsFor, fakeClient, type FakeClient } from "@/test/fake-supabase";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "afk.example";
});

// The edges only: the two Supabase clients and the logger. The owner is a guest, so the
// route reads no memory files; the notes email, the names and the card run as written.
const state = vi.hoisted(() => ({ visitor: null as unknown, admin: null as unknown }));
vi.mock("@/server/db/supabase-server", () => ({
  createSupabaseServerClient: async () => state.visitor,
}));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import("./route");

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEETING = "22222222-2222-4222-8222-222222222222";
type DbError = { code: string; message: string };

function setUp({
  meeting = {},
  signedIn = true,
  linkOn = true,
  waiting = [],
  insertError = null,
  speakersError = null,
}: {
  meeting?: Record<string, unknown> | null;
  signedIn?: boolean;
  linkOn?: boolean;
  waiting?: Record<string, unknown>[];
  insertError?: DbError | null;
  speakersError?: DbError | null;
} = {}): FakeClient {
  const ofMeeting = { meeting_id: MEETING };
  state.visitor = fakeClient({
    claims: signedIn ? claimsFor(OWNER, "guest") : null,
    errors: speakersError ? { meeting_speakers: speakersError } : {},
    tables: {
      meetings:
        meeting === null
          ? []
          : [
              {
                id: MEETING,
                owner_id: OWNER,
                title: "Launch sync",
                ai_headline: "Launch on the 20th.",
                status: "ready",
                host_speaker_code: "A",
                ...meeting,
              },
            ],
      meeting_items: [
        { ...ofMeeting, kind: "decision", text: "Launch on the 20th" },
        {
          ...ofMeeting,
          kind: "action",
          text: "Send the deck",
          owner_name: null,
          owner_speaker_code: "B",
          due_text: "by Friday",
        },
      ],
      meeting_speakers: [
        { ...ofMeeting, code: "A", label: "Haris Shakeel" },
        { ...ofMeeting, code: "B", label: "Sam Lee" },
        // Sam rejoined: Meet's "(2)" is the same person.
        { ...ofMeeting, code: "C", label: "Sam Lee (2)" },
        { ...ofMeeting, code: "D", label: "Tess" },
      ],
      meeting_links: [{ ...ofMeeting, code: "abcdefghjkmn", pin: "0420", enabled: linkOn }],
    },
  });
  const admin = fakeClient({
    tables: { meeting_commands: waiting },
    failures: insertError ? { "insert meeting_commands": insertError } : {},
  });
  state.admin = admin;
  return admin;
}

const share = () =>
  POST(new Request(`https://afk.example/api/meetings/${MEETING}/share-notes`, { method: "POST" }), {
    params: Promise.resolve({ meetingId: MEETING }),
  });

/** The card the route asked the database to insert. */
const card = (admin: FakeClient) =>
  admin.calls.find((call) => call.fn === "insert meeting_commands")?.args;

describe("POST /api/meetings/[meetingId]/share-notes", () => {
  it("proposes one email card to everyone on the call but the sender, with the meeting's address", async () => {
    const admin = setUp();
    const response = await share();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ commandId: "inserted" });
    expect(card(admin)).toMatchObject({
      status: "proposed",
      needs_approval: true,
      args: {
        sharedNotes: true,
        toNames: ["Sam Lee", "Tess"],
        body: expect.stringContaining("Send the deck"),
      },
    });
    expect(JSON.stringify(card(admin))).toMatch(/https:\/\/afk\.example\/m\/abcdefghjkmn/);
    expect(JSON.stringify(card(admin))).toMatch(/PIN: 0420/);
  });

  it("leaves the address and PIN out while the meeting's link is off", async () => {
    const admin = setUp({ linkOn: false });
    expect((await share()).status).toBe(201);
    expect(JSON.stringify(card(admin))).not.toMatch(/abcdefghjkmn|0420/);
  });

  it("answers a second click with the card already waiting (audit F4)", async () => {
    setUp({
      insertError: { code: "23505", message: "duplicate key value" },
      waiting: [
        { id: "card-1", meeting_id: MEETING, status: "proposed", args: { sharedNotes: true } },
      ],
    });
    const response = await share();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commandId: "card-1" });
  });

  it("proposes nothing when part of the notes cannot be read", async () => {
    const admin = setUp({ speakersError: { code: "57014", message: "statement timeout" } });
    expect((await share()).status).toBe(500);
    expect(admin.calls).toEqual([]);
  });

  it("says so when the meeting has used its typed commands", async () => {
    setUp({
      insertError: { code: "23514", message: "a meeting takes at most 20 typed commands" },
    });
    expect((await share()).status).toBe(429);
  });

  it("refuses no session, another user's meeting and notes not written yet, and writes nothing", async () => {
    const signedOut = setUp({ signedIn: false });
    expect((await share()).status).toBe(401);
    const stranger = setUp({ meeting: { owner_id: "00000000-0000-4000-8000-000000000009" } });
    expect((await share()).status).toBe(404);
    const unread = setUp({ meeting: null });
    expect((await share()).status).toBe(404);
    const early = setUp({ meeting: { status: "processing" } });
    expect((await share()).status).toBe(409);
    expect(
      [signedOut, stranger, unread, early].flatMap((admin) => admin.calls.map((call) => call.fn)),
    ).toEqual([]);
  });
});
