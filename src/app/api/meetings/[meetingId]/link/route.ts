import { z } from "zod";

import { MEETING_ID } from "@/features/meetings/meeting-file-schema";
import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";
import { log } from "@/server/log";

/**
 * The owner's two actions on a meeting's address (2026-10-16): a new code and PIN, or
 * the link switched off or on. Both run as the owner in the database, which answers
 * false for anyone else's meeting.
 */
type Context = { params: Promise<{ meetingId: string }> };

const bodySchema = z.object({ action: z.enum(["rotate", "on", "off"]) });

export async function POST(request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  const { action } = body.data;
  const { data: done, error } =
    action === "rotate"
      ? await visitor.supabase.rpc("rotate_meeting_link", { p_meeting_id: meetingId })
      : await visitor.supabase.rpc("set_meeting_link_enabled", {
          p_meeting_id: meetingId,
          p_enabled: action === "on",
        });
  if (error) return dbFailure("link.change_failed", error);
  if (!done) return jsonError(404, "Not found.");

  const { data: link } = await visitor.supabase
    .from("meeting_links")
    .select("code, pin, enabled")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  log.info("link.changed", { meetingId, action });
  return Response.json({ link });
}
