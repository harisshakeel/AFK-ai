import { describe, expect, it } from "vitest";

import {
  BOT_LEAVE_SETTINGS,
  createAttendeeClient,
  interpretStateChange,
  parseWebhookBody,
  verifyWebhookSignature,
  webhookEnvelopeSchema,
  deepgramSettings,
} from "./attendee";
import { convertAttendeeTranscript } from "./attendee-transcript";

// Reference values computed with Attendee's own Python signing code:
// json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")),
// HMAC-SHA256 keyed with base64-decoded secret, base64 digest.
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const PAYLOAD = {
  idempotency_key: "8f0c",
  bot_id: "bot_abc123DEF456ghij",
  bot_metadata: { meetingId: "m1", zeta: "ü" },
  trigger: "bot.state_change",
  data: {
    new_state: "ended",
    old_state: "post_processing",
    event_type: "post_processing_completed",
    event_sub_type: null,
    created_at: "2026-10-20T10:00:00Z",
  },
};
const SIGNATURE = "Dlvi/GpfVrhydKF1jmNNcAWNbUo99g1ve/fdJAXty+E=";

describe("Attendee webhook signatures", () => {
  it("matches Attendee's Python signer regardless of key order in the received body", () => {
    const { data, ...rest } = PAYLOAD;
    const reordered = JSON.parse(JSON.stringify({ data, ...rest })) as unknown;
    expect(verifyWebhookSignature(reordered, SIGNATURE, SECRET)).toBe(true);
  });

  it("keeps floats and big integers as Attendee wrote them, so their signatures verify", () => {
    // Attendee's Django app serialises the body with Python's json module: `1.0` stays
    // `1.0`, and an integer keeps every digit. The signature was computed with its signer.
    const raw =
      '{"idempotency_key": "f10", "bot_id": "bot_abc123DEF456ghij", "trigger": "bot.state_change", "data": {"new_state": "ended", "old_state": "post_processing", "event_type": "post_processing_completed", "event_sub_type": null, "duration_ms": 1.0, "created_at": "2026-10-20T10:00:00Z", "transcript_id": 12345678901234567890, "ratio": 0.1, "exp": 1e+22}}';
    const signature = "6F422WKqQ8Q98qEq1KnIzdZ3gE3Y+MsfH+zl+MS+DBE=";
    expect(verifyWebhookSignature(parseWebhookBody(raw), signature, SECRET)).toBe(true);
    // A plain parse prints 1.0 as 1 and rounds the integer: the same body fails.
    expect(verifyWebhookSignature(JSON.parse(raw), signature, SECRET)).toBe(false);
    // The envelope still reads as ordinary JSON.
    expect(webhookEnvelopeSchema.safeParse(JSON.parse(raw)).success).toBe(true);
  });

  it("rejects a forged, missing or tampered signature", () => {
    expect(verifyWebhookSignature(PAYLOAD, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, "nope", SECRET)).toBe(false);
    const tampered = { ...PAYLOAD, bot_id: "bot_someoneelse0000" };
    expect(verifyWebhookSignature(tampered, SIGNATURE, SECRET)).toBe(false);
  });

  it("treats only a completed post-processing as finished", () => {
    const envelope = webhookEnvelopeSchema.parse(PAYLOAD);
    expect(interpretStateChange(envelope)).toEqual({ outcome: "finished" });
    const joining = webhookEnvelopeSchema.parse({
      ...PAYLOAD,
      data: { new_state: "joining", event_type: "join_requested" },
    });
    expect(interpretStateChange(joining)).toEqual({ outcome: "ignore" });
    const recording = webhookEnvelopeSchema.parse({
      ...PAYLOAD,
      data: { new_state: "joined_recording", event_type: "bot_recording_permission_granted" },
    });
    expect(interpretStateChange(recording)).toEqual({ outcome: "recording" });
    const otherTrigger = webhookEnvelopeSchema.parse({ ...PAYLOAD, trigger: "transcript.update" });
    expect(interpretStateChange(otherTrigger)).toEqual({ outcome: "ignore" });
    const failed = webhookEnvelopeSchema.parse({
      ...PAYLOAD,
      data: { new_state: "fatal_error", event_type: "could_not_join_meeting" },
    });
    expect(interpretStateChange(failed).outcome).toBe("failed");
  });
});

describe("convertAttendeeTranscript", () => {
  const start = 1_780_000_000_000;
  const utterance = (
    name: string,
    uuid: string,
    offsetMs: number,
    durationMs: number,
    text: string,
  ) => ({
    speaker_name: name,
    speaker_uuid: uuid,
    timestamp_ms: start + offsetMs,
    duration_ms: durationMs,
    transcription: { transcript: text },
  });

  it("converts epoch milliseconds to seconds into the recording, in order, with stable ids", () => {
    const result = convertAttendeeTranscript(
      "m1",
      [
        utterance("Sam", "u2", 5_000, 2_000, "Second."),
        utterance("Ana", "u1", 1_000, 3_000, "First."),
        utterance("Ana", "u1", 4_500, 1_000, "  "),
      ],
      start,
      60,
    );
    expect(result.speakers).toEqual([
      { code: "u1", label: "Ana", isHost: false },
      { code: "u2", label: "Sam", isHost: false },
    ]);
    expect(result.turns).toEqual([
      { id: "m1-0000", speaker: "u1", startSec: 1, endSec: 4, text: "First." },
      { id: "m1-0001", speaker: "u2", startSec: 5, endSec: 7, text: "Second." },
    ]);
  });

  it("merges a speaker's back-to-back fragments and clamps to the recording's length", () => {
    const result = convertAttendeeTranscript(
      "m1",
      [utterance("Ana", "u1", 0, 2_000, "Hello"), utterance("Ana", "u1", 2_500, 9_000, "there.")],
      start,
      10,
    );
    expect(result.turns).toEqual([
      { id: "m1-0000", speaker: "u1", startSec: 0, endSec: 10, text: "Hello there." },
    ]);
  });

  it("keeps two people with the same name apart when they talk back and forth", () => {
    const result = convertAttendeeTranscript(
      "m1",
      [
        utterance("iPhone", "a", 0, 1_000, "One."),
        utterance("iPhone", "b", 2_000, 1_000, "Two."),
        utterance("iPhone", "a", 4_000, 1_000, "Three."),
      ],
      start,
      10,
    );
    expect(result.speakers.map((speaker) => speaker.label)).toEqual(["iPhone", "iPhone (2)"]);
    expect(result.turns.map((turn) => turn.speaker)).toEqual(["a", "b", "a"]);
  });

  it("treats someone who leaves and rejoins as the same speaker", () => {
    // Google Meet gives each join a new participant id and no account id.
    const result = convertAttendeeTranscript(
      "m1",
      [
        utterance("Haris Shakeel", "first-join", 0, 3_000, "Before I dropped."),
        utterance("Sam", "s", 10_000, 2_000, "While you were away."),
        utterance("Haris  shakeel", "second-join", 85_000, 5_000, "I'm back."),
      ],
      start,
      120,
    );
    expect(result.speakers).toEqual([
      { code: "first-join", label: "Haris Shakeel", isHost: false },
      { code: "s", label: "Sam", isHost: false },
    ]);
    expect(result.turns.map((turn) => turn.speaker)).toEqual(["first-join", "s", "first-join"]);
  });

  it("keeps the host flag on the person, across a rejoin", () => {
    const result = convertAttendeeTranscript(
      "m1",
      [
        { ...utterance("Haris", "join-1", 0, 2_000, "Hello."), speaker_is_host: true },
        utterance("Sam", "s", 5_000, 2_000, "Hi."),
        { ...utterance("Haris", "join-2", 30_000, 2_000, "Back."), speaker_is_host: false },
      ],
      start,
      60,
    );
    expect(result.speakers).toEqual([
      { code: "join-1", label: "Haris", isHost: true },
      { code: "s", label: "Sam", isHost: false },
    ]);
  });

  it("uses the platform account id when there is one, over the display name", () => {
    const withAccount = (name: string, uuid: string, account: string, offsetMs: number) => ({
      ...utterance(name, uuid, offsetMs, 1_000, `${name} speaking.`),
      speaker_user_uuid: account,
    });
    const result = convertAttendeeTranscript(
      "m1",
      [
        withAccount("Ana", "join-1", "acct-ana", 0),
        withAccount("Ana (phone)", "join-2", "acct-ana", 5_000),
        withAccount("Ana", "join-3", "acct-other-ana", 9_000),
      ],
      start,
      20,
    );
    expect(result.speakers).toEqual([
      { code: "join-1", label: "Ana", isHost: false },
      { code: "join-3", label: "Ana (2)", isHost: false },
    ]);
  });

  it("never merges unnamed participants", () => {
    const result = convertAttendeeTranscript(
      "m1",
      [
        { ...utterance("", "x", 0, 1_000, "One."), speaker_name: null },
        { ...utterance("", "y", 5_000, 1_000, "Two."), speaker_name: null },
      ],
      start,
      10,
    );
    expect(result.speakers.map((speaker) => speaker.code)).toEqual(["x", "y"]);
  });
});

describe("createBot", () => {
  it("sends the bot with its own signed webhook and limits on how long it stays", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ id: "bot_abc123DEF456ghij", state: "joining" }), {
        status: 201,
      });
    }) as typeof fetch;
    const client = createAttendeeClient({ apiKey: "test-key-0000", fetchImpl });
    const bot = await client.createBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "AFK.ai Notetaker",
      webhookUrl: "https://afk.example/api/webhooks/attendee",
      metadata: { meetingId: "m1" },
      deduplicationKey: "m1",
    });
    expect(bot.id).toBe("bot_abc123DEF456ghij");
    expect(sent?.url).toBe("https://app.attendee.dev/api/v1/bots");
    expect(sent?.init.method).toBe("POST");
    const body = JSON.parse(String(sent?.init.body)) as Record<string, unknown>;
    // The face (L4) and the live transcript (L1) ride along with the bot.
    expect(body.webhooks).toEqual([
      {
        url: "https://afk.example/api/webhooks/attendee",
        triggers: ["bot.state_change", "transcript.update"],
      },
    ]);
    // Audio only: the bot sends no camera image (owner's decision).
    expect(body.bot_image).toBeUndefined();
    // It records video: the speaker view at 720p, kept at Attendee.
    expect(body.recording_settings).toEqual({
      format: "mp4",
      view: "speaker_view",
      resolution: "720p",
    });
    // Without a transcription choice nothing streams during the call.
    expect(body.transcription_settings).toBeUndefined();
    expect(body.automatic_leave_settings).toEqual(BOT_LEAVE_SETTINGS);
    expect(BOT_LEAVE_SETTINGS.max_uptime_seconds).toBe(3 * 60 * 60);
    expect(body.deduplication_key).toBe("m1");
  });

  it("schedules a bot for later with join_at, and can delete one", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        init?.method === "DELETE"
          ? ""
          : JSON.stringify({ id: "bot_abc123DEF456ghij", state: "scheduled" }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const client = createAttendeeClient({ apiKey: "test-key-0000", fetchImpl });
    const bot = await client.createBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "AFK.ai Notetaker",
      webhookUrl: "https://afk.example/api/webhooks/attendee",
      metadata: { meetingId: "m1" },
      deduplicationKey: "m1",
      joinAt: "2026-10-28T10:00:00+05:00",
    });
    expect(bot.state).toBe("scheduled");
    expect((calls[0]!.body as Record<string, unknown>).join_at).toBe("2026-10-28T10:00:00+05:00");
    await client.deleteBot("bot_abc123DEF456ghij");
    expect(calls[1]).toMatchObject({
      url: "https://app.attendee.dev/api/v1/bots/bot_abc123DEF456ghij",
      method: "DELETE",
    });
  });

  it("asks for Deepgram through Attendee when told to, with the wake word as a key term", async () => {
    let sent: { init: RequestInit } | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = { init: init ?? {} };
      return new Response(JSON.stringify({ id: "bot_abc123DEF456ghij", state: "joining" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const client = createAttendeeClient({ apiKey: "test-key-0000", fetchImpl });
    await client.createBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "AFK.ai Notetaker",
      webhookUrl: "https://afk.example/api/webhooks/attendee",
      metadata: { meetingId: "m1" },
      deduplicationKey: "m1",
      transcription: "deepgram",
    });
    const body = JSON.parse(String(sent!.init.body)) as Record<string, unknown>;
    expect(body.transcription_settings).toEqual({
      deepgram: { language: "multi", model: "nova-3" },
    });
  });

  it("asks for the platform's live captions when told to, merged per speaker", async () => {
    let sent: { init: RequestInit } | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = { init: init ?? {} };
      return new Response(JSON.stringify({ id: "bot_abc123DEF456ghij", state: "joining" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const client = createAttendeeClient({ apiKey: "test-key-0000", fetchImpl });
    await client.createBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "AFK.ai Notetaker",
      webhookUrl: "https://afk.example/api/webhooks/attendee",
      metadata: { meetingId: "m1" },
      deduplicationKey: "m1",
      transcription: "captions",
    });
    const body = JSON.parse(String(sent!.init.body)) as Record<string, unknown>;
    expect(body.transcription_settings).toEqual({
      meeting_closed_captions: {
        google_meet_language: "en-US",
        teams_language: "en-us",
        zoom_language: "English",
        merge_consecutive_captions: true,
      },
    });
  });
});

describe("deepgram settings", () => {
  it("boosts the wake word only in English mode, which is the only one Deepgram allows it for", () => {
    expect(deepgramSettings("en")).toEqual({ language: "en", model: "nova-3", keyterms: ["AFK"] });
    expect(deepgramSettings("multi")).toEqual({ language: "multi", model: "nova-3" });
  });
});
