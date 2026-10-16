import { MEETING_ID } from "@/features/meetings/meeting-file-schema";
import { jsonError, requireVisitor } from "@/server/http";

/** Later on a nudge: the meeting is not nudged again for a day (snooze_wrap_up). */
type Context = { params: Promise<{ meetingId: string }> };

export async function POST(_request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const { data, error } = await visitor.supabase.rpc("snooze_wrap_up", { p_meeting_id: meetingId });
  if (error) return jsonError(500, "That didn't save. Try again.");
  if (data !== true) return jsonError(404, "Not found.");
  return Response.json({ snoozed: true });
}
