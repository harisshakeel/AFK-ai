import "server-only";

import { randomUUID } from "node:crypto";

import {
  AttendeeError,
  createAttendeeClient,
  type DeepgramLanguage,
} from "@/features/capture/attendee";
import type { MeetingPlatform } from "@/features/capture/meeting-url";
import { productionOrigin, serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { log } from "@/server/log";

/**
 * Sending the bot (requirement F9), now and later. One place for the bot route and the
 * calendar auto-join: the meeting row first (the caps and the one-active rule are the
 * database's), then the Attendee bot, now or scheduled for the event's time (join_at),
 * then the bot id on the row. A failure after the row marks it failed, so nothing is
 * left requested for ever.
 */
export type SendBotInput = {
  ownerId: string;
  link: { url: string; platform: MeetingPlatform };
  title: string;
  /** The names the sender is known by in the call (sender.ts). */
  senderNames: string[];
  /** A keyed hash of the sender's address for the per-place cap; null for a scheduled join. */
  senderKey: string | null;
  /** When the bot should join, ISO 8601; unset means now. */
  joinAt?: string | null;
  /** The calendar event the join came from: one bot per event per owner. */
  calendarEventId?: string | null;
  /** The transcriber's language for this call; unset, the deployment's default (ATTENDEE_DEEPGRAM_LANGUAGE). */
  language?: DeepgramLanguage | null;
  /** The people on the calendar invite, recorded as people AFK knows once the bot is sent. */
  invitees?: ReadonlyArray<{ email: string; name: string | null }>;
};

export type SendBotOutcome =
  | { ok: true; meetingId: string }
  | {
      ok: false;
      code:
        | "not_configured"
        | "active"
        | "cap_user"
        | "cap_site"
        | "cap_guests"
        | "already"
        | "insert"
        | "https"
        | "provider";
    };

export async function sendBot(input: SendBotInput): Promise<SendBotOutcome> {
  const env = serverEnv();
  if (!env.ATTENDEE_API_KEY || !env.ATTENDEE_WEBHOOK_SECRET)
    return { ok: false, code: "not_configured" };
  // Callers pass the owner they authenticated (the bot route's session user, the
  // keep-alive's opted-in profiles); meetings are read-only to visitors, so the row is
  // written here, under the database's bot caps.
  const admin = createSupabaseAdminClient();
  const meetingId = randomUUID();
  const scheduled = Boolean(input.joinAt);
  const { error: insertError } = await admin.from("meetings").insert({
    id: meetingId,
    owner_id: input.ownerId,
    title: input.title,
    recorded_at: input.joinAt ?? new Date().toISOString(),
    status: scheduled ? "scheduled" : "requested",
    scheduled_for: input.joinAt ?? null,
    calendar_event_id: input.calendarEventId ?? null,
    meeting_url: input.link.url,
    sender_names: input.senderNames,
    sender_key: input.senderKey,
    source: {
      kind: "bot",
      platform: input.link.platform,
      ...(scheduled ? { scheduled: true } : {}),
    },
  });
  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, code: input.calendarEventId ? "already" : "active" };
    }
    if (insertError.code === "P0003") return { ok: false, code: "cap_user" };
    if (insertError.code === "P0004") return { ok: false, code: "cap_site" };
    if (insertError.code === "P0008") return { ok: false, code: "cap_guests" };
    log.error("bot.meeting_insert_failed", new Error(insertError.code ?? "db_error"));
    return { ok: false, code: "insert" };
  }

  // Attendee posts to the production site, never to a preview deployment or a dev
  // server; it requires https.
  const origin = productionOrigin();
  if (!origin.startsWith("https://")) {
    await admin
      .from("meetings")
      .update({
        status: "failed",
        status_detail: "The bot needs a public https site to report to.",
      })
      .eq("id", meetingId);
    return { ok: false, code: "https" };
  }
  const attendee = createAttendeeClient({
    apiKey: env.ATTENDEE_API_KEY,
    baseUrl: env.ATTENDEE_API_URL,
  });
  try {
    const bot = await attendee.createBot({
      meetingUrl: input.link.url,
      botName: "AFK.ai Notetaker",
      webhookUrl: `${origin}/api/webhooks/attendee`,
      metadata: { meetingId },
      deduplicationKey: meetingId,
      transcription: env.ATTENDEE_TRANSCRIPTION,
      language: input.language ?? env.ATTENDEE_DEEPGRAM_LANGUAGE,
      joinAt: input.joinAt ?? undefined,
    });
    const { error: idError } = await admin
      .from("meetings")
      .update({ bot_id: bot.id })
      .eq("id", meetingId)
      .in("status", ["scheduled", "requested"]);
    if (idError) {
      // Without its id on the row, no webhook finds the meeting and the bot would record
      // a call AFK cannot see (audit F3): it is taken back, and the row says so.
      log.error("bot.id_not_saved", new Error(idError.code ?? "db_error"), { meetingId });
      try {
        await (scheduled ? attendee.deleteBot(bot.id) : attendee.leaveBot(bot.id));
      } catch (takeBackError) {
        log.warn("bot.take_back_failed", {
          meetingId,
          error: takeBackError instanceof Error ? takeBackError.name : "unknown",
        });
      }
      await admin
        .from("meetings")
        .update({
          status: "failed",
          status_detail: "AFK couldn't keep track of the bot. Send it again.",
        })
        .eq("id", meetingId);
      return { ok: false, code: "insert" };
    }
    log.info("bot.sent", { meetingId, platform: input.link.platform, scheduled });
    // The people on the invite become people AFK knows (source calendar, unused until
    // a card to them is approved); a Google user only, which learn_contacts() enforces.
    if (input.invitees && input.invitees.length > 0) {
      const { error } = await admin.rpc("learn_contacts", {
        p_owner_id: input.ownerId,
        p_people: input.invitees.map((person) => ({ email: person.email, name: person.name })),
        p_source: "calendar",
        p_used: false,
      });
      if (error) {
        log.warn("bot.invitees_not_learned", { meetingId, error: error.code ?? "db_error" });
      } else {
        log.info("bot.invitees_learned", { meetingId, count: input.invitees.length });
      }
    }
    return { ok: true, meetingId };
  } catch (error) {
    const status = error instanceof AttendeeError ? error.status : 0;
    log.error("bot.create_failed", error, { meetingId, status });
    // With no answer (a timeout, a reply that did not parse) the bot may exist all the
    // same; if it does, its first event takes it back (adoptOrphanBot). Only a row still
    // without its bot is failed: one the bot's first event reached while the create was
    // answering has its bot, and the send worked.
    const { data: failed } = await admin
      .from("meetings")
      .update({
        status: "failed",
        status_detail: status
          ? "The bot service didn't accept the request."
          : "The bot service didn't confirm the bot. Send it again.",
      })
      .eq("id", meetingId)
      .is("bot_id", null)
      .select("id")
      .maybeSingle();
    if (!failed) {
      const { data: row } = await admin
        .from("meetings")
        .select("bot_id")
        .eq("id", meetingId)
        .maybeSingle();
      if (row?.bot_id) {
        log.info("bot.sent_late", { meetingId });
        return { ok: true, meetingId };
      }
    }
    return { ok: false, code: "provider" };
  }
}

/**
 * A bot whose id never reached its meeting row (audit F3): the create timed out after
 * Attendee had taken it, or the function stopped between the two calls. Its events name
 * the meeting it was made for (botMetadataSchema), so the webhook calls this for a bot
 * it cannot place. A row still waiting for its bot takes the id. Any other bot made for
 * the meeting is one AFK has written off: its row failed (the sender was told to send
 * again), the meeting was deleted, or the row has another bot. It is taken back, and a
 * failed row records its id after, so deleting the meeting purges what it recorded. A
 * take-back that fails is tried again on the next event.
 */
export async function adoptOrphanBot(
  botId: string,
  meetingId: string,
): Promise<"attached" | "taken_back" | "none"> {
  // The webhook's decision, keyed by a meeting id only our signed metadata carries.
  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin
    .from("meetings")
    .select("status, scheduled_for, bot_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) {
    log.warn("bot.orphan_read_failed", { meetingId, error: error.code ?? "db_error" });
    return "none";
  }
  // The row's own bot, the usual case.
  if (row?.bot_id === botId) return "none";

  const waiting = row && !row.bot_id && (row.status === "scheduled" || row.status === "requested");
  if (waiting) {
    const { data: attached, error: attachError } = await admin
      .from("meetings")
      .update({ bot_id: botId })
      .eq("id", meetingId)
      .is("bot_id", null)
      .in("status", ["scheduled", "requested"])
      .select("id")
      .maybeSingle();
    if (attachError || !attached) {
      log.warn("bot.orphan_not_attached", {
        meetingId,
        error: attachError?.code ?? "changed",
      });
      return "none";
    }
    log.info("bot.orphan_attached", { meetingId });
    return "attached";
  }
  // A row without a bot that is neither waiting nor failed has nothing to do with it.
  if (row && !row.bot_id && row.status !== "failed") return "none";

  const env = serverEnv();
  if (!env.ATTENDEE_API_KEY) return "none";
  const attendee = createAttendeeClient({
    apiKey: env.ATTENDEE_API_KEY,
    baseUrl: env.ATTENDEE_API_URL,
  });
  try {
    // A scheduled bot that has not joined yet is deleted; one already in the call leaves.
    // With the row gone, whether it was scheduled is unknown: delete, else leave.
    if (!row || row.scheduled_for) {
      await attendee.deleteBot(botId).catch(() => attendee.leaveBot(botId));
    } else {
      await attendee.leaveBot(botId);
    }
  } catch (takeBackError) {
    // Only a bot Attendee no longer has (404, 410) is taken back by a refusal; any other
    // (a 400 for a bot between states, a timeout) is tried again on its next event.
    const gone =
      takeBackError instanceof AttendeeError && [404, 410].includes(takeBackError.status);
    if (!gone) {
      log.warn("bot.orphan_take_back_failed", {
        meetingId,
        error: takeBackError instanceof Error ? takeBackError.name : "unknown",
      });
      return "none";
    }
  }
  if (!row) {
    // The meeting was deleted, so what the bot recorded goes too, as the delete promised.
    // Refused while the bot is still leaving, it is asked again on the bot's next event.
    try {
      await attendee.deleteData(botId);
    } catch (dataError) {
      log.warn("bot.orphan_data_not_deleted", {
        meetingId,
        error: dataError instanceof Error ? dataError.name : "unknown",
      });
    }
  }
  if (row && !row.bot_id) {
    const { error: idError } = await admin
      .from("meetings")
      .update({ bot_id: botId })
      .eq("id", meetingId)
      .is("bot_id", null);
    if (idError) {
      log.warn("bot.orphan_id_not_saved", { meetingId, error: idError.code ?? "db_error" });
    }
  }
  // matched: whether its meeting is still there.
  log.info("bot.orphan_taken_back", { meetingId, matched: Boolean(row) });
  return "taken_back";
}
