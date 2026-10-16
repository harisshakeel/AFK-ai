import { after } from "next/server";

import {
  createAttendeeClient,
  interpretStateChange,
  liveUtteranceSchema,
  parseWebhookBody,
  verifyWebhookSignature,
  webhookEnvelopeSchema,
} from "@/features/capture/attendee";
import { hasWakeWord } from "@/features/commands/detect";
import {
  detectLiveCommand,
  heardAcknowledgement,
  LIVE_FALLBACK_MESSAGE,
} from "@/features/commands/live";
import { matchesSender } from "@/features/commands/sender";
import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { jsonError } from "@/server/http";
import { kickJobs } from "@/server/jobs";
import { log } from "@/server/log";

/**
 * Attendee's webhook (NFR Webhook, Live webhook). It must be:
 *   - authentic: HMAC over the canonical JSON with our secret, or 401
 *   - idempotent: every write is a compare-and-set on the meeting's current status, and
 *     a live utterance is keyed by Attendee's idempotency key, so a redelivery or an
 *     out-of-order event changes nothing
 *   - unable to create or revive a meeting: it only updates rows the bot route made
 *   - fast: no media work before the answer. A live utterance is one function call; a
 *     host's question also queues the answer job
 *
 * The slow work happens after the response (there is no worker): a finished call's
 * ingest and notes, and a live question's answer, run here with the function's budget.
 * A question whose answer has not started after twenty seconds (nothing took it, or
 * the run that took it was cut off) gets the fallback line in the chat (L2); an answer
 * that is merely slow is left to post, so the chat gets one line, never both. Any other command the
 * sender speaks gets one line in the chat saying it was heard and where its result
 * will be; the command itself waits for the final transcript.
 */
// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

const LIVE_FALLBACK_AFTER_MS = 20_000;
/** Said once per meeting, the first time someone other than the sender addresses AFK. */
const NOT_SENDER_MESSAGE =
  "Only the person who sent AFK to this call can give it commands. Everything is still being written up.";

export async function POST(request: Request) {
  const env = serverEnv();
  const secret = env.ATTENDEE_WEBHOOK_SECRET;
  if (!secret) return jsonError(503, "Not configured.");

  const raw = await request.text();
  if (raw.length > 100_000) return jsonError(413, "Too large.");
  let signed: unknown;
  let payload: unknown;
  try {
    // Numbers keep their exact text for the signature; the envelope is read as plain JSON.
    signed = parseWebhookBody(raw);
    payload = JSON.parse(raw);
  } catch {
    return jsonError(400, "Not JSON.");
  }
  if (!verifyWebhookSignature(signed, request.headers.get("x-webhook-signature"), secret)) {
    log.warn("webhook.bad_signature");
    return jsonError(401, "Bad signature.");
  }
  const envelope = webhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return Response.json({ ignored: true });

  const { bot_id: botId } = envelope.data;
  // Every write below is the webhook's own server decision, keyed by the bot id.
  const admin = createSupabaseAdminClient();

  if (envelope.data.trigger === "transcript.update") {
    const utterance = liveUtteranceSchema.safeParse(envelope.data.data);
    const text = utterance.success ? utterance.data.text : "";
    if (!utterance.success || !text) return Response.json({ ignored: true });
    // Only the person who sent AFK is listened to (sender.ts): a speaker whose name is
    // one the sender is known by. The platform's host flag marks the organiser instead.
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, sender_names, refusal_noticed_at")
      .eq("bot_id", botId)
      .in("status", ["requested", "recording"])
      .maybeSingle();
    const isHost = matchesSender(utterance.data.speaker_name ?? "", meeting?.sender_names ?? []);
    const command = isHost ? detectLiveCommand(text) : null;
    const heard = isHost && !command ? heardAcknowledgement(text) : null;
    const senderKnown = (meeting?.sender_names ?? []).length > 0;
    if (
      meeting &&
      senderKnown &&
      !isHost &&
      meeting.refusal_noticed_at === null &&
      hasWakeWord(text)
    ) {
      const { data: noticed } = await admin
        .from("meetings")
        .update({ refusal_noticed_at: new Date().toISOString() })
        .eq("id", meeting.id)
        .is("refusal_noticed_at", null)
        .select("id")
        .maybeSingle();
      if (noticed && env.ATTENDEE_API_KEY) {
        const apiKey = env.ATTENDEE_API_KEY;
        after(async () => {
          try {
            await createAttendeeClient({ apiKey, baseUrl: env.ATTENDEE_API_URL }).sendChatMessage(
              botId,
              NOT_SENDER_MESSAGE,
            );
            log.info("webhook.live_refused", { botId });
          } catch (noticeError) {
            log.warn("webhook.live_refused_failed", {
              botId,
              error: noticeError instanceof Error ? noticeError.name : "unknown",
            });
          }
        });
      }
    }
    const { data, error } = await admin.rpc("record_live_utterance", {
      p_bot_id: botId,
      p_idempotency_key:
        envelope.data.idempotency_key ??
        `${utterance.data.speaker_uuid ?? "unknown"}:${utterance.data.timestamp_ms}`,
      p_speaker_name: utterance.data.speaker_name ?? "",
      p_speaker_uuid: utterance.data.speaker_uuid ?? "",
      p_is_host: isHost,
      p_timestamp_ms: Math.round(utterance.data.timestamp_ms),
      p_duration_ms: Math.round(utterance.data.duration_ms),
      p_text: text,
      p_command: command ? { kind: command.kind, args: { question: command.question } } : undefined,
    });
    const row = data?.[0];
    if (error || !row) {
      log.error("webhook.live_failed", new Error(error?.code ?? "db_error"), { botId });
      // 500 makes Attendee retry, which is safe: the utterance is keyed.
      return jsonError(500, "Try again.");
    }
    log.info("webhook.live", {
      botId,
      matched: row.meeting_id !== null,
      kind: command?.kind ?? heard?.kind ?? "none",
      queued: row.command_id !== null,
    });
    if (heard && row.meeting_id && env.ATTENDEE_API_KEY) {
      const apiKey = env.ATTENDEE_API_KEY;
      after(async () => {
        try {
          await createAttendeeClient({ apiKey, baseUrl: env.ATTENDEE_API_URL }).sendChatMessage(
            botId,
            heard.message,
          );
        } catch (heardError) {
          log.warn("webhook.live_heard_failed", {
            botId,
            kind: heard.kind,
            error: heardError instanceof Error ? heardError.name : "unknown",
          });
        }
      });
    }
    if (row.command_id && env.ATTENDEE_API_KEY) {
      const commandId = row.command_id;
      const apiKey = env.ATTENDEE_API_KEY;
      kickJobs({ meetingId: row.meeting_id ?? undefined });
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, LIVE_FALLBACK_AFTER_MS));
        // One chat line per question: the fallback goes out only if the answer has not
        // started, and once it has, the answer lands on the card only (audit F6).
        const { data: claimed, error: claimError } = await admin.rpc("claim_live_fallback", {
          p_command_id: commandId,
        });
        if (claimError) {
          log.warn("webhook.live_fallback_failed", { botId, commandId, error: "db_error" });
          return;
        }
        if (!claimed) return;
        try {
          await createAttendeeClient({ apiKey, baseUrl: env.ATTENDEE_API_URL }).sendChatMessage(
            botId,
            LIVE_FALLBACK_MESSAGE,
          );
          log.info("webhook.live_fallback", { botId, commandId });
        } catch (fallbackError) {
          log.warn("webhook.live_fallback_failed", {
            botId,
            commandId,
            error: fallbackError instanceof Error ? fallbackError.name : "unknown",
          });
        }
      });
    }
    return Response.json({ ok: true });
  }

  const event = interpretStateChange(envelope.data);
  if (event.outcome === "ignore") return Response.json({ ignored: true });

  if (event.outcome === "recording") {
    const { error: recordingError } = await admin
      .from("meetings")
      .update({ status: "recording" })
      .eq("bot_id", botId)
      .in("status", ["scheduled", "requested"]);
    if (recordingError) {
      log.error("webhook.update_failed", new Error(recordingError.code ?? "db_error"), { botId });
      return jsonError(500, "Try again.");
    }
    log.info("webhook.recording", { botId });
    return Response.json({ ok: true });
  }

  const { data: meetingId, error } = await admin.rpc("mark_bot_finished", {
    p_bot_id: botId,
    p_succeeded: event.outcome === "finished",
    p_detail: event.outcome === "failed" ? event.detail : undefined,
  });
  if (error) {
    log.error("webhook.update_failed", new Error(error.code ?? "db_error"), { botId });
    // 500 makes Attendee retry, which is safe: the update is a compare-and-set.
    return jsonError(500, "Try again.");
  }
  log.info("webhook.bot_finished", { botId, outcome: event.outcome, matched: meetingId !== null });
  // The recording and the notes: fetched and written now, with the function's budget.
  if (meetingId && event.outcome === "finished") kickJobs({ meetingId });
  return Response.json({ ok: true });
}
