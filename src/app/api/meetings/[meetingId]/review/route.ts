import { z } from "zod";

import { MEETING_ID } from "@/features/meetings/meeting-file-schema";
import { jsonError, readJson, requireVisitor } from "@/server/http";
import { log } from "@/server/log";

/**
 * Done on the wrap-up: the meeting is reviewed, with the owner's verdict on the notes
 * when they gave one. The database checks the owner and the state (review_meeting).
 */
type Context = { params: Promise<{ meetingId: string }> };

const bodySchema = z.object({
  rating: z.enum(["good", "bad"]).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function POST(request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const { data: reviewed, error } = await visitor.supabase.rpc("review_meeting", {
    p_meeting_id: meetingId,
    p_rating: body.data.rating,
    p_note: body.data.note,
  });
  if (error) {
    log.error("meeting.review_failed", new Error(error.code ?? "db_error"), { meetingId });
    return jsonError(500, "That didn't save. Try again.");
  }
  if (reviewed !== true) return jsonError(404, "Not found.");
  log.info("meeting.reviewed", { meetingId, rated: body.data.rating !== undefined });
  return Response.json({ reviewed: true });
}
