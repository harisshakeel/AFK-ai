import "server-only";

import { listUpcomingEvents } from "@/features/connectors/calendar";
import { GOOGLE_CALENDAR_SCOPE } from "@/features/connectors/registry";
import { profileNames } from "@/features/commands/sender";
import { profileSays } from "@/features/memory/files";
import { googleAccessToken, loadConnector } from "@/features/processing/token-source";
import type { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { connectorSetup } from "@/server/connectors/config";
import { log } from "@/server/log";

import { sendBot } from "./bots";

/**
 * Calendar auto-join, run by the daily keep-alive: for every Google user
 * whose profile says "AFK joins my calendar meetings: yes" and whose Google connection
 * allows the calendar, the meetings of the next thirty-six hours with a video link that
 * the owner organised or accepted get a scheduled bot, one per event (the database
 * refuses a second). The caps still apply, so a day with six meetings schedules five.
 * Counts only in the log.
 */
const LOOK_AHEAD_MS = 36 * 60 * 60 * 1000;
const MAX_PER_RUN = 20;

export async function autoJoinFromCalendars(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<number> {
  const setup = connectorSetup();
  if (!setup.tokenKey || !setup.google) return 0;
  const config = {
    workerId: "cron",
    attendee: null,
    connectorTokenKey: setup.tokenKey,
    google: setup.google,
    siteUrl: "",
  };
  const { data: optedIn, error } = await admin
    .from("memory_files")
    .select("owner_id, content")
    .eq("path", "profile.md")
    .ilike("content", "%AFK joins my calendar meetings: yes%");
  if (error) {
    log.error("cron.autojoin_read_failed", new Error(error.code ?? "db_error"));
    return 0;
  }
  let scheduled = 0;
  for (const row of optedIn ?? []) {
    if (scheduled >= MAX_PER_RUN) break;
    if (profileSays(row.content, "AFK joins my calendar meetings") !== true) continue;
    try {
      const connector = await loadConnector(admin, config, row.owner_id, "google");
      if (!connector || connector.status !== "connected") continue;
      if (!connector.scopes.includes(GOOGLE_CALENDAR_SCOPE)) continue;
      const accessToken = await googleAccessToken(admin, config, connector);
      const now = new Date();
      const events = await listUpcomingEvents(accessToken, {
        from: now,
        to: new Date(now.getTime() + LOOK_AHEAD_MS),
      });
      const names = profileNames(row.content);
      for (const event of events) {
        if (scheduled >= MAX_PER_RUN) break;
        // Only meetings the owner organised or accepted: anyone can send an invite, and
        // AFK would otherwise join a stranger's call under the owner's name.
        if (!event.accepted) continue;
        const outcome = await sendBot({
          ownerId: row.owner_id,
          link: { url: event.link, platform: event.platform },
          title: event.title,
          senderNames: names,
          senderKey: null,
          joinAt: event.startsAt,
          calendarEventId: event.id,
          invitees: event.attendees,
        });
        if (outcome.ok) scheduled += 1;
        else if (outcome.code !== "already") {
          log.warn("cron.autojoin_refused", { userId: row.owner_id, outcome: outcome.code });
          if (outcome.code === "cap_user" || outcome.code === "cap_site") break;
        }
      }
    } catch (caught) {
      log.warn("cron.autojoin_failed", {
        userId: row.owner_id,
        error: caught instanceof Error ? caught.name : "unknown",
      });
    }
  }
  if (scheduled > 0) log.info("cron.autojoin", { scheduled });
  return scheduled;
}
