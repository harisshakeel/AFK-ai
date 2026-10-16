import "server-only";

import { inviteesFor, listUpcomingEvents } from "@/features/connectors/calendar";
import { GOOGLE_CALENDAR_SCOPE } from "@/features/connectors/registry";

import { googleAccessForUser } from "./connectors/store";
import { log } from "./log";

/** How far around the send time the calendar is read for the meeting's invite. */
const WINDOW_MS = 36 * 3_600_000;

/**
 * The people on the calendar invite of the meeting a bot is sent to (2026-10-16): the
 * event it was scheduled from, else the event whose link this is, on the sender's own
 * Google Calendar. Empty when the calendar is not connected, the meeting is not on it,
 * or Google cannot be reached: the send never waits on this.
 */
export async function inviteesForMeeting(
  ownerId: string,
  target: { link: string; calendarEventId: string | null; around: Date },
): Promise<Array<{ email: string; name: string | null }>> {
  try {
    const google = await googleAccessForUser(ownerId);
    if (!google || !google.scopes.includes(GOOGLE_CALENDAR_SCOPE)) return [];
    const events = await listUpcomingEvents(google.accessToken, {
      from: new Date(target.around.getTime() - WINDOW_MS),
      to: new Date(target.around.getTime() + WINDOW_MS),
    });
    return inviteesFor(events, target);
  } catch (error) {
    log.warn("bot.invitees_failed", {
      userId: ownerId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}
