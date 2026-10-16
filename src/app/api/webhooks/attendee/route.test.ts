import { beforeEach, describe, expect, it, vi } from "vitest";

import { signWebhook } from "@/features/capture/attendee";
import { fakeClient, type FakeClient } from "@/test/fake-supabase";

const SECRET = vi.hoisted(() => Buffer.from("test-webhook-secret-1234").toString("base64"));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000000000";
  process.env.ATTENDEE_WEBHOOK_SECRET = Buffer.from("test-webhook-secret-1234").toString("base64");
  process.env.ATTENDEE_API_KEY = "attendee_test_key";
});

// The edges: the admin client, Attendee's client, the job kick, the logger and Next's
// after(), which is captured, never run (so a chat line is counted, never sent). The
// signature check, the envelope parsing and the sender rule run as written.
const state = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/features/capture/attendee", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAttendeeClient: () => ({ leaveBot: vi.fn(), deleteBot: vi.fn(), sendChatMessage: vi.fn() }),
}));
vi.mock("@/server/jobs", () => ({ kickJobs: vi.fn() }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  after: vi.fn(),
}));

const { POST } = await import("./route");
const { after } = await import("next/server");

beforeEach(() => {
  vi.mocked(after).mockClear();
});

const recording = {
  idempotency_key: "k1",
  bot_id: "bot_abc123",
  trigger: "bot.state_change",
  data: { new_state: "joined_recording", old_state: "joining" },
};

function setUp(): FakeClient {
  const admin = fakeClient();
  state.admin = admin;
  return admin;
}

const deliver = (body: string, signature: string | null) =>
  POST(
    new Request("https://afk.example/api/webhooks/attendee", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature === null ? {} : { "x-webhook-signature": signature }),
      },
      body,
    }),
  );

describe("POST /api/webhooks/attendee", () => {
  it("acts on an event signed with our secret", async () => {
    const admin = setUp();
    const response = await deliver(JSON.stringify(recording), signWebhook(recording, SECRET));
    expect(response.status).toBe(200);
    expect(admin.calls).toEqual([{ fn: "update meetings", args: { status: "recording" } }]);
  });

  it("refuses an unsigned, wrongly signed or altered event, and touches nothing", async () => {
    const admin = setUp();
    expect((await deliver(JSON.stringify(recording), null)).status).toBe(401);
    expect((await deliver(JSON.stringify(recording), "bm90IHRoZSBzaWduYXR1cmU=")).status).toBe(401);
    // Signed for one bot, delivered for another.
    const altered = { ...recording, bot_id: "bot_someone_else" };
    const signature = signWebhook(recording, SECRET);
    expect((await deliver(JSON.stringify(altered), signature)).status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("refuses a body too large or not JSON before checking anything else", async () => {
    const admin = setUp();
    expect((await deliver("x".repeat(100_001), "sig")).status).toBe(413);
    expect((await deliver("{not json", "sig")).status).toBe(400);
    expect(admin.calls).toEqual([]);
  });

  it("answers 500 when it cannot read whose words these are, so the utterance comes again", async () => {
    const admin = fakeClient({ errors: { meetings: { code: "57014", message: "timeout" } } });
    state.admin = admin;
    const utterance = {
      idempotency_key: "u1",
      bot_id: "bot_abc123",
      trigger: "transcript.update",
      data: {
        speaker_name: "Haris",
        speaker_uuid: "spk-1",
        speaker_is_host: true,
        timestamp_ms: 1000,
        duration_ms: 900,
        transcription: { transcript: "AFK, what did we decide?" },
      },
    };
    const response = await deliver(JSON.stringify(utterance), signWebhook(utterance, SECRET));
    expect(response.status).toBe(500);
    expect(admin.calls.map((call) => call.fn)).not.toContain("record_live_utterance");
  });

  it("ignores a signed event it has no use for", async () => {
    const admin = setUp();
    const other = { ...recording, trigger: "bot.logs_update" };
    const response = await deliver(JSON.stringify(other), signWebhook(other, SECRET));
    expect(await response.json()).toEqual({ ignored: true });
    expect(admin.calls).toEqual([]);
  });

  describe("a line said in the call", () => {
    const line = (speaker: string, text: string, key = "u1") => ({
      idempotency_key: key,
      bot_id: "bot_abc123",
      trigger: "transcript.update",
      data: {
        speaker_name: speaker,
        speaker_uuid: `spk-${speaker}`,
        timestamp_ms: 1000,
        duration_ms: 900,
        transcription: { transcript: text },
      },
    });
    const call = ({
      heard,
      duplicate = false,
      speakersError = null,
      strangerTold = false,
    }: {
      heard: string[];
      duplicate?: boolean;
      speakersError?: { code: string; message: string } | null;
      strangerTold?: boolean;
    }) => {
      const admin = fakeClient({
        tables: {
          meetings: [
            {
              id: "m1",
              bot_id: "bot_abc123",
              status: "recording",
              sender_names: ["haris shakeel"],
              refusal_noticed_at: strangerTold ? "2026-10-17T10:00:00Z" : null,
              tie_noticed_at: null,
            },
          ],
        },
        rpc: {
          live_speaker_names: { data: speakersError ? null : heard, error: speakersError },
          record_live_utterance: {
            data: [{ meeting_id: "m1", seq: duplicate ? null : 7, duplicate, command_id: null }],
            error: null,
          },
        },
      });
      state.admin = admin;
      return admin;
    };
    const send = (body: object) => deliver(JSON.stringify(body), signWebhook(body, SECRET));
    const recorded = (admin: FakeClient) =>
      admin.calls.find((entry) => entry.fn === "record_live_utterance")?.args;

    it("acknowledges the sender's command once: a redelivered line posts nothing more", async () => {
      const said = line("Haris Shakeel", "AFK, task for Sam to send the deck");
      const first = call({ heard: ["Haris Shakeel", "Tess Lee"] });
      expect((await send(said)).status).toBe(200);
      expect(recorded(first)).toMatchObject({ p_is_host: true });
      expect(after).toHaveBeenCalledTimes(1);
      vi.mocked(after).mockClear();
      call({ heard: ["Haris Shakeel", "Tess Lee"], duplicate: true });
      expect((await send(said)).status).toBe(200);
      expect(after).not.toHaveBeenCalled();
    });

    it("takes no command from either of two speakers who match the sender (audit F2)", async () => {
      const admin = call({ heard: ["Haris Shakeel", "Haris"] });
      expect((await send(line("Haris", "AFK, what did we decide?"))).status).toBe(200);
      expect(recorded(admin)).toMatchObject({ p_is_host: false, p_command: undefined });
      // The once-a-meeting notice says why, rather than "only the sender", under its own
      // flag: a stranger told earlier in the call does not silence it.
      expect(admin.calls).toContainEqual({
        fn: "update meetings",
        args: { tie_noticed_at: expect.any(String) },
      });
      expect(after).toHaveBeenCalledTimes(1);
      vi.mocked(after).mockClear();
      call({ heard: ["Haris Shakeel", "Haris"], strangerTold: true });
      expect((await send(line("Haris", "AFK, what did we decide?"))).status).toBe(200);
      expect(after).toHaveBeenCalledTimes(1);
    });

    it("answers 500 when it cannot read who else spoke, so the line comes again", async () => {
      const admin = call({ heard: [], speakersError: { code: "57014", message: "timeout" } });
      expect((await send(line("Haris Shakeel", "AFK, what did we decide?"))).status).toBe(500);
      expect(recorded(admin)).toBeUndefined();
    });
  });

  it("gives a bot no row knows the id of the meeting it was made for (audit F3)", async () => {
    const meetingId = "22222222-2222-4222-8222-222222222222";
    const admin = fakeClient({
      tables: {
        meetings: [{ id: meetingId, bot_id: null, status: "requested", scheduled_for: null }],
      },
    });
    state.admin = admin;
    const event = { ...recording, bot_metadata: { meetingId } };
    expect((await deliver(JSON.stringify(event), signWebhook(event, SECRET))).status).toBe(200);
    expect(admin.calls).toEqual([
      { fn: "update meetings", args: { bot_id: "bot_abc123" } },
      { fn: "update meetings", args: { status: "recording" } },
    ]);
  });
});
