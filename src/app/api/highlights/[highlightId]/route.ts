import { z } from "zod";

import { normaliseClip } from "@/lib/time-rules";
import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";

/** Adjust or delete one of the visitor's highlights (requirement F6). */
type Context = { params: Promise<{ highlightId: string }> };

const idSchema = z.uuid();
const patchSchema = z.object({
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(request: Request, context: Context) {
  const { highlightId } = await context.params;
  if (!idSchema.safeParse(highlightId).success)
    return jsonError(404, "That highlight doesn't exist.");
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, patchSchema);
  if (!body.ok) return body.response;

  const { data: current } = await visitor.supabase
    .from("highlights")
    .select("start_sec, end_sec, meetings(duration_sec)")
    .eq("id", highlightId)
    .maybeSingle();
  if (!current?.meetings?.duration_sec) return jsonError(404, "That highlight doesn't exist.");

  const clip = normaliseClip(
    {
      startSec: body.data.startSec ?? Number(current.start_sec),
      endSec: body.data.endSec ?? Number(current.end_sec),
    },
    Number(current.meetings.duration_sec),
  );
  const { data: updated, error } = await visitor.supabase
    .from("highlights")
    .update({
      start_sec: clip.startSec,
      end_sec: clip.endSec,
      ...(body.data.note !== undefined ? { note: body.data.note } : {}),
    })
    .eq("id", highlightId)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure("highlight.update_failed", error);
  // Deleted between the read and the write (another tab): say so, never report a save.
  if (!updated) return jsonError(404, "That highlight doesn't exist.");
  return Response.json({ highlight: { id: highlightId, ...clip } });
}

export async function DELETE(_request: Request, context: Context) {
  const { highlightId } = await context.params;
  if (!idSchema.safeParse(highlightId).success)
    return jsonError(404, "That highlight doesn't exist.");
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const { data, error } = await visitor.supabase
    .from("highlights")
    .delete()
    .eq("id", highlightId)
    .select("id");
  if (error) return dbFailure("highlight.delete_failed", error);
  if (!data || data.length === 0) return jsonError(404, "That highlight doesn't exist.");
  return Response.json({ deleted: true });
}
