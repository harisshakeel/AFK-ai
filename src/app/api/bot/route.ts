import { z } from "zod";

import { parseMeetingUrl } from "@/features/capture/meeting-url";
import { profileNames, senderNames } from "@/features/commands/sender";
import { clientAddress, clientKey } from "@/lib/read-limit";
import { serverEnv } from "@/lib/env";
import { sendBot } from "@/server/bots";
import { inviteesForMeeting } from "@/server/calendar-invitees";
import { jsonError, readJson, requireVisitor } from "@/server/http";

/**
 * Send the real bot (requirement F9), now or at a calendar event's time. Anyone may: a
 * guest's anonymous identity owns the meeting like a Google user's does (guest mode),
 * and it is private to them. AI output follows once the transcript arrives.
 *
 * The caps (one active bot, five a day per identity and per place, the deployment's
 * daily allowance) and the one-bot-per-calendar-event rule are the database's; the
 * creation itself lives in src/server/bots.ts, shared with the calendar auto-join.
 */
export const maxDuration = 30;

const DAYS_AHEAD = 90;

const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
  title: z.string().trim().min(1).max(200).optional(),
  /** The name the sender shows in the call, so AFK knows whose commands count (sender.ts). */
  senderName: z.string().trim().min(2).max(80).optional(),
  /** What the transcriber listens for: English only (the wake word boosted), or English and Urdu. */
  language: z.enum(["en", "multi"]).optional(),
  /** Join at this time instead of now: a meeting on the calendar. */
  joinAt: z.iso.datetime({ offset: true }).optional(),
  calendarEventId: z
    .string()
    .regex(/^[A-Za-z0-9_@.-]{1,200}$/)
    .optional(),
});

const REFUSALS = {
  not_configured: [503, "The meeting bot isn't configured on this deployment."],
  active: [409, "AFK is already in one of your meetings. Wait for it to finish first."],
  already: [409, "AFK is already scheduled for that meeting."],
  cap_user: [429, "You've sent AFK to five meetings in the last day. Try again tomorrow."],
  cap_site: [503, "AFK's bot is fully booked for today. Try again tomorrow."],
  insert: [500, "AFK couldn't be sent. Try again."],
  https: [503, "The bot can only be sent from the deployed site (https)."],
  provider: [502, "The bot service didn't accept the request. Check the link and try again."],
} as const;

export async function POST(request: Request) {
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;

  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const link = parseMeetingUrl(body.data.meetingUrl);
  if (!link.ok) return jsonError(400, link.reason);
  if (body.data.joinAt) {
    const at = Date.parse(body.data.joinAt);
    if (at < Date.now() - 60_000) return jsonError(400, "That time has passed.");
    if (at > Date.now() + DAYS_AHEAD * 86_400_000) {
      return jsonError(400, `AFK can be scheduled up to ${DAYS_AHEAD} days ahead.`);
    }
  }

  // The names AFK will know the sender by in the call (sender.ts): the name given on
  // the form, the account's name, and the profile's "Name" and "Name in calls" lines,
  // read as the sender (RLS). A guest has no account name, so the form's is required.
  if (visitor.isAnonymous && !body.data.senderName) {
    return jsonError(400, "Tell AFK the name you show in the call, so it knows whose words count.");
  }
  const { data: profile } = await visitor.supabase
    .from("memory_files")
    .select("content")
    .eq("path", "profile.md")
    .maybeSingle();
  const names = senderNames([
    body.data.senderName,
    visitor.name,
    ...profileNames(profile?.content),
  ]).slice(0, 12);
  const now = new Date();
  const title =
    body.data.title ??
    `Meeting on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(now)}`;
  const outcome = await sendBot({
    ownerId: visitor.userId,
    link: { url: link.url, platform: link.platform },
    title,
    senderNames: names,
    // A keyed hash of the sender's address (never the address): the trigger caps bot
    // requests per place as well as per identity, since a guest identity is free to make.
    senderKey: clientKey(clientAddress(request.headers), serverEnv().SUPABASE_SECRET_KEY),
    joinAt: body.data.joinAt ?? null,
    calendarEventId: body.data.calendarEventId ?? null,
    language: body.data.language ?? null,
    // The people on the invite, when the meeting is on the sender's Google Calendar.
    invitees: visitor.isAnonymous
      ? []
      : await inviteesForMeeting(visitor.userId, {
          link: link.url,
          calendarEventId: body.data.calendarEventId ?? null,
          around: body.data.joinAt ? new Date(body.data.joinAt) : now,
        }),
  });
  if (!outcome.ok) {
    const [status, message] = REFUSALS[outcome.code];
    return jsonError(status, message);
  }
  return Response.json({ meetingId: outcome.meetingId }, { status: 201 });
}
