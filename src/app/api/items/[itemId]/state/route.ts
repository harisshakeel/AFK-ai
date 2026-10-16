import { z } from "zod";

import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";

/** Tick or untick an action item, privately to this visitor (requirement F5). */
type Context = { params: Promise<{ itemId: string }> };

const bodySchema = z.object({ done: z.boolean() });

export async function PUT(request: Request, context: Context) {
  const { itemId } = await context.params;
  if (!z.uuid().safeParse(itemId).success) return jsonError(404, "That action item doesn't exist.");
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  // Update first, insert if there was nothing to update. (An upsert would also try to
  // rewrite item_id, which visitors may not update.)
  const { data: updated, error: updateError } = await visitor.supabase
    .from("item_states")
    .update({ done: body.data.done })
    .eq("item_id", itemId)
    .select("item_id");
  if (updateError) return dbFailure("item_state.save_failed", updateError);
  if (!updated || updated.length === 0) {
    const { error } = await visitor.supabase
      .from("item_states")
      .insert({ item_id: itemId, done: body.data.done });
    if (error && error.code === "23505") {
      // Another request inserted first: apply this value on top, so the last write wins
      // and the response matches the row.
      const { error: retryError } = await visitor.supabase
        .from("item_states")
        .update({ done: body.data.done })
        .eq("item_id", itemId);
      if (retryError) return dbFailure("item_state.save_failed", retryError);
    } else if (error) {
      if (error.code === "42501") return jsonError(404, "That action item doesn't exist.");
      return dbFailure("item_state.save_failed", error);
    }
  }
  return Response.json({ itemId, done: body.data.done });
}
