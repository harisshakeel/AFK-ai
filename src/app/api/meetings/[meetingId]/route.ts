import { AttendeeError, createAttendeeClient } from "@/features/capture/attendee";
import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { jsonError, requireVisitor } from "@/server/http";
import { log } from "@/server/log";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/**
 * Delete one of your meetings, including while the bot is recording or the recording
 * is being processed. Order: make the bot leave (or refuse, so the bot is never left
 * recording a call its meeting has forgotten), then the row (which cascades to the
 * transcript, jobs, AI output, highlights and share links), then the audio, and Attendee
 * is told to forget the bot's recording and transcript. An in-flight ingest then finds
 * nothing to publish.
 */
type Context = { params: Promise<{ meetingId: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;

  // Read as the visitor: only the owner's own meetings are found; seed meetings never are.
  const { data: meeting } = await visitor.supabase
    .from("meetings")
    .select("id, owner_id, status, bot_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting || meeting.owner_id !== visitor.userId) return jsonError(404, "Not found.");

  const env = serverEnv();
  const botId = meeting.bot_id;
  const attendee =
    botId && env.ATTENDEE_API_KEY
      ? createAttendeeClient({ apiKey: env.ATTENDEE_API_KEY, baseUrl: env.ATTENDEE_API_URL })
      : null;
  if (attendee && botId && meeting.status === "scheduled") {
    // Not in the call yet: the scheduled bot is deleted rather than told to leave.
    try {
      await attendee.deleteBot(botId);
    } catch (error) {
      const gone = error instanceof AttendeeError && error.status >= 400 && error.status < 500;
      log.warn("meeting.delete_scheduled_failed", {
        meetingId,
        error: error instanceof Error ? error.name : "unknown",
        gone,
      });
      if (!gone) {
        return jsonError(502, "AFK couldn't cancel the scheduled bot yet. Try again in a moment.");
      }
    }
  }
  if (attendee && botId && (meeting.status === "requested" || meeting.status === "recording")) {
    try {
      await attendee.leaveBot(botId);
    } catch (error) {
      // A bot that already left answers 4xx; anything else means it may still be there.
      const gone = error instanceof AttendeeError && error.status >= 400 && error.status < 500;
      log.warn("meeting.delete_leave_failed", {
        meetingId,
        error: error instanceof Error ? error.name : "unknown",
        gone,
      });
      if (!gone) {
        return jsonError(502, "AFK couldn't make the bot leave yet. Try again in a moment.");
      }
    }
  }

  // Ownership was checked above; the admin client removes what RLS keeps read-only.
  // The row goes first: once it is gone, a late ingest finds nothing to publish.
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("meetings")
    .delete()
    .eq("id", meeting.id)
    .eq("owner_id", visitor.userId);
  if (error) {
    log.error("meeting.delete_failed", new Error(error.code ?? "db_error"), { meetingId });
    return jsonError(500, "The meeting couldn't be deleted. Try again.");
  }
  const { data: objects } = await admin.storage.from("audio").list(meeting.id);
  if (objects && objects.length > 0) {
    const { error: removeError } = await admin.storage
      .from("audio")
      .remove(objects.map((object) => `${meeting.id}/${object.name}`));
    // The meeting is already gone for the user; an orphaned object is only storage.
    if (removeError)
      log.error("meeting.delete_audio_failed", new Error(removeError.name), { meetingId });
  }
  // Attendee holds a bot meeting's recording and transcript: told to forget them too.
  // Best effort: a refusal (a bot still leaving) leaves them there, which is logged.
  if (attendee && botId) {
    try {
      await attendee.deleteData(botId);
    } catch (error) {
      log.warn("meeting.delete_data_failed", {
        meetingId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  log.info("meeting.deleted", { meetingId });
  return Response.json({ deleted: true });
}
