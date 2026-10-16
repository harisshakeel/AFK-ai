import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Attendee (attendee.dev) meeting-bot API: just the calls AFK uses. Shared by the server
 * routes (send a bot, make it leave) and the job runner (fetch the transcript and recording).
 * Holds no secrets; the API key is passed in. Every response is validated with Zod.
 *
 * Facts verified against attendee-labs/attendee @ d9c4773:
 *   - auth header `Authorization: Token <key>`; bot ids look like `bot_` + 16 characters
 *   - transcript entries carry `timestamp_ms` (Unix epoch ms) and `duration_ms`; the
 *     recording's `start_timestamp_ms` is its first sample, so offsets subtract the two
 *   - the recording URL is a presigned S3 link valid for 30 minutes (RECORDING_LINK_SEC)
 *   - recording_settings: format mp4 (the default), mp3 or none; view speaker_view (the
 *     default), gallery_view or speaker_view_no_sidebar; resolution 1080p (the default)
 *     or 720p; POST /bots/{id}/delete_data removes the recording, the transcript and the
 *     participants, and keeps the bot's metadata (verified against main)
 *   - webhooks are signed: base64 HMAC-SHA256, keyed with the base64-decoded secret,
 *     over the JSON re-serialised with sorted keys and no spaces (not the raw body)
 */
export const ATTENDEE_DEFAULT_URL = "https://app.attendee.dev";

/** How long a recording link Attendee mints stays valid: its storage's presigned URL. */
export const RECORDING_LINK_SEC = 30 * 60;

export class AttendeeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AttendeeError";
    this.status = status;
  }
}

/**
 * Whether Attendee's refusal means the bot is gone already (left, ended, deleted): a
 * 4xx about the bot. A refused key (401, 403), a timeout (408) or a rate limit (429)
 * says nothing about the bot, which may still be recording.
 */
export function botAlreadyGone(error: unknown): boolean {
  return (
    error instanceof AttendeeError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 403, 407, 408, 429].includes(error.status)
  );
}

const botSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/),
  state: z.string(),
  meeting_url: z.string().optional(),
  transcription_state: z.string().optional(),
  recording_state: z.string().optional(),
});
export type AttendeeBot = z.infer<typeof botSchema>;

const utteranceSchema = z.object({
  speaker_name: z.string().nullable().optional(),
  /** One participant session: a rejoin gets a new one. */
  speaker_uuid: z.string().nullable().optional(),
  /** The platform account, stable across rejoins (Zoom, Teams; empty on Google Meet). */
  speaker_user_uuid: z.string().max(200).nullable().optional(),
  /** Whether the platform marks this participant as the meeting's host. */
  speaker_is_host: z.boolean().nullable().optional(),
  timestamp_ms: z.number(),
  duration_ms: z.number().nonnegative(),
  transcription: z
    .union([z.object({ transcript: z.string().nullable().optional() }), z.string()])
    .nullable()
    .optional(),
});
export type AttendeeUtterance = z.infer<typeof utteranceSchema>;

/** A transcript.update webhook's data: one utterance, with its text pulled out. */
export const liveUtteranceSchema = utteranceSchema.transform((utterance) => ({
  ...utterance,
  text: (typeof utterance.transcription === "string"
    ? utterance.transcription
    : (utterance.transcription?.transcript ?? "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000),
}));

const recordingSchema = z.object({
  url: z.url(),
  start_timestamp_ms: z.number().nullable().optional(),
});
export type AttendeeRecording = z.infer<typeof recordingSchema>;

export type AttendeeClient = ReturnType<typeof createAttendeeClient>;

/**
 * When the bot leaves on its own (Attendee's automatic_leave_settings). Attendee's
 * defaults already leave a call 60 s after everyone else has; these add a ceiling so a
 * forgotten bot can't run up hours: 5 minutes unadmitted in a waiting room, 10 minutes of
 * silence (counted after the first 10), and 3 hours at most, the longest meeting AFK is
 * built for (NFR Scale).
 */
export const BOT_LEAVE_SETTINGS = {
  only_participant_in_meeting_timeout_seconds: 60,
  waiting_room_timeout_seconds: 300,
  silence_activate_after_seconds: 600,
  silence_timeout_seconds: 600,
  max_uptime_seconds: 3 * 60 * 60,
} as const;

export type DeepgramLanguage = "en" | "multi";

/** Deepgram through Attendee: Nova-3, the language given, the wake word boosted only where Deepgram allows it (English). */
export function deepgramSettings(language: DeepgramLanguage): {
  language: DeepgramLanguage;
  model: "nova-3";
  keyterms?: string[];
} {
  return language === "en"
    ? { language, model: "nova-3", keyterms: ["AFK"] }
    : { language, model: "nova-3" };
}

export function createAttendeeClient({
  apiKey,
  baseUrl = ATTENDEE_DEFAULT_URL,
  fetchImpl = fetch,
}: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      // The body may echo request details; keep only the status in the error.
      throw new AttendeeError(
        `Attendee ${init.method ?? "GET"} ${path.split("/")[1]} failed`,
        response.status,
      );
    }
    const text = await response.text();
    return schema.parse(text ? JSON.parse(text) : {});
  }

  /** A POST whose answer is only its status (chat, speech, deleting the data). */
  async function send(path: string, body: unknown): Promise<void> {
    const response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // As every other call: a hung Attendee must not hold a function to its limit.
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new AttendeeError(`Attendee POST ${path.split("/").at(-1)} failed`, response.status);
    }
  }

  return {
    createBot: (input: {
      meetingUrl: string;
      botName: string;
      webhookUrl: string;
      metadata: Record<string, string>;
      deduplicationKey: string;
      /**
       * Where the transcript comes from. Unset, Attendee transcribes the recording after
       * the call, so nothing reaches the live webhook during it (seen in a test call). The
       * platform's own captions stream as they are spoken, need no third-party key, and
       * carry the speaker's name, but they drop words (seen in a test call); consecutive
       * captions are merged so a spoken "AFK, …" arrives as one utterance. Deepgram,
       * with its key saved in the Attendee project, streams during the call too and is
       * far more accurate; the wake word is given as a key term so "AFK" is written as
       * said.
       */
      transcription?: "captions" | "deepgram";
      /**
       * Deepgram's language: "multi" (the default) transcribes English and, when someone
       * slips into Urdu or Hindi, those words too (written in Devanagari, which the
       * ingest rewrites in Roman Urdu); "en" is English only, with "AFK" as a key term,
       * which Deepgram offers for English alone.
       */
      language?: DeepgramLanguage;
      /** Join later, at this ISO 8601 time (a scheduled bot), instead of now. */
      joinAt?: string;
    }) =>
      call("/bots", botSchema, {
        method: "POST",
        body: {
          meeting_url: input.meetingUrl,
          bot_name: input.botName,
          ...(input.joinAt ? { join_at: input.joinAt } : {}),
          // Video, as Fathom records it: the speaker and any shared screen, at 720p to
          // keep the file and the viewer's bandwidth down. The file stays at Attendee;
          // the meeting page plays it through links minted from the bot id
          // (media-url.ts), so its size never passes through a function (jobs.ts).
          recording_settings: { format: "mp4", view: "speaker_view", resolution: "720p" },
          // State changes for the lifecycle, each utterance as it is transcribed (L1).
          webhooks: [
            { url: input.webhookUrl, triggers: ["bot.state_change", "transcript.update"] },
          ],
          ...(input.transcription === "captions"
            ? {
                transcription_settings: {
                  meeting_closed_captions: {
                    google_meet_language: "en-US",
                    teams_language: "en-us",
                    zoom_language: "English",
                    merge_consecutive_captions: true,
                  },
                },
              }
            : input.transcription === "deepgram"
              ? {
                  transcription_settings: {
                    deepgram: deepgramSettings(input.language ?? "multi"),
                  },
                }
              : {}),
          // Bot time is billed by the hour after the free hours: never let a bot linger.
          automatic_leave_settings: BOT_LEAVE_SETTINGS,
          metadata: input.metadata,
          deduplication_key: input.deduplicationKey,
        },
      }),
    getBot: (botId: string) => call(`/bots/${encodeURIComponent(botId)}`, botSchema),
    leaveBot: (botId: string) =>
      call(`/bots/${encodeURIComponent(botId)}/leave`, botSchema, { method: "POST", body: {} }),
    /** A scheduled bot that should not join after all. */
    deleteBot: (botId: string) =>
      call(`/bots/${encodeURIComponent(botId)}`, z.object({}).loose(), { method: "DELETE" }),
    /** Attendee forgets the call: the recording, the transcript and the participants. */
    deleteData: (botId: string) => send(`/bots/${encodeURIComponent(botId)}/delete_data`, {}),
    getTranscript: (botId: string) =>
      call(`/bots/${encodeURIComponent(botId)}/transcript`, z.array(utteranceSchema)),
    getRecording: (botId: string) =>
      call(`/bots/${encodeURIComponent(botId)}/recording`, recordingSchema),
    /** A line in the meeting chat, to everyone (L2). */
    sendChatMessage: (botId: string, message: string) =>
      send(`/bots/${encodeURIComponent(botId)}/send_chat_message`, {
        to: "everyone",
        message: message.slice(0, 2000),
      }),
    /** The bot says it (L3). Needs Google text-to-speech credentials in the Attendee project. */
    speak: (botId: string, text: string) =>
      send(`/bots/${encodeURIComponent(botId)}/speech`, {
        text: text.slice(0, 2000),
        text_to_speech_settings: {
          google: { voice_language_code: "en-US", voice_name: "en-US-Neural2-C" },
        },
      }),
  };
}

// ---------------------------------------------------------------------------------------
// Webhooks

/**
 * JSON.rawJSON / isRawJSON (ES2025, in Node 21+) keep a number's source text through
 * parse and stringify. TypeScript's lib has no declaration for them yet.
 */
type RawJsonApi = { rawJSON(text: string): object; isRawJSON(value: unknown): boolean };
const jsonApi = JSON as unknown as RawJsonApi;

/**
 * Parses a webhook body keeping every number exactly as Attendee wrote it. Its Python
 * signer prints `1.0` and keeps integers of any size, where JavaScript would print `1`
 * and round past 2^53; re-serialising the parsed value would then fail the signature.
 */
export function parseWebhookBody(raw: string): unknown {
  return JSON.parse(raw, (_key, value, context?: { source?: string }) =>
    typeof value === "number" && typeof context?.source === "string"
      ? jsonApi.rawJSON(context.source)
      : value,
  );
}

/** JSON with keys sorted at every level and no whitespace, as Attendee signs it. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (jsonApi.isRawJSON(value)) return JSON.stringify(value);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signWebhook(payload: unknown, secretBase64: string): string {
  return createHmac("sha256", Buffer.from(secretBase64, "base64"))
    .update(canonicalJson(payload), "utf8")
    .digest("base64");
}

export function verifyWebhookSignature(
  payload: unknown,
  signature: string | null,
  secretBase64: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(payload, secretBase64));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const webhookEnvelopeSchema = z.object({
  idempotency_key: z.string().max(100).optional(),
  bot_id: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/),
  /** What createBot was given as metadata; read with botMetadataSchema. */
  bot_metadata: z.unknown().optional(),
  trigger: z.string().max(60),
  data: z
    .object({
      new_state: z.string().max(60).nullable().optional(),
      old_state: z.string().max(60).nullable().optional(),
      event_type: z.string().max(80).nullable().optional(),
      event_sub_type: z.string().max(80).nullable().optional(),
    })
    .loose(),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/** The meeting a bot was made for, as sendBot() set it; signed with the rest of the event. */
export const botMetadataSchema = z.object({ meetingId: z.uuid() });

/**
 * What a bot.state_change event means for the meeting: finished (recording and transcript
 * are ready to fetch), failed (it ended without anything usable), or nothing yet.
 */
export function interpretStateChange(
  envelope: WebhookEnvelope,
):
  | { outcome: "recording" }
  | { outcome: "finished" }
  | { outcome: "failed"; detail: string }
  | { outcome: "ignore" } {
  if (envelope.trigger !== "bot.state_change") return { outcome: "ignore" };
  const { new_state: state, event_type: event, event_sub_type: subType } = envelope.data;
  if (state === "joined_recording") return { outcome: "recording" };
  if (state === "ended" && event === "post_processing_completed") return { outcome: "finished" };
  if (state === "fatal_error" || event === "could_not_join_meeting") {
    return {
      outcome: "failed",
      detail: subType ? `The bot could not record (${subType})` : "The bot could not record",
    };
  }
  return { outcome: "ignore" };
}
