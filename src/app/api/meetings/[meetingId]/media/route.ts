import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { dbFailure, jsonError } from "@/server/http";
import { mediaUrlFor } from "@/server/media/media-url";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/**
 * A fresh link to the recording, for when the page's is about to expire (a video's
 * lasts thirty minutes, an audio's an hour or six) or failed to load. The meeting is
 * read as the visitor first, so this only links a recording they can already play.
 */
type Context = { params: Promise<{ meetingId: string }> };

export async function GET(_request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const supabase = await createSupabaseServerClient();
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("owner_id, audio_path, video_ref")
    .eq("id", meetingId)
    .maybeSingle();
  if (meetingError) return dbFailure("media.read_failed", meetingError);
  if (!meeting || (!meeting.audio_path && !meeting.video_ref)) return jsonError(404, "Not found.");
  const media = await mediaUrlFor(meeting);
  if (!media) return jsonError(503, "The recording is unavailable right now.");
  return Response.json(media, { headers: { "Cache-Control": "private, no-store" } });
}
