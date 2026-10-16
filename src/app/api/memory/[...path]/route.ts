import { z } from "zod";

import { isAfkOnly, isMemoryPath, MEMORY_FILE_LIMIT_BYTES } from "@/features/memory/files";
import { dbFailure, jsonError, readJson, requireUser } from "@/server/http";

/**
 * Save one memory file (requirement M6). Owner-only through RLS; the database trigger
 * counts the write against the limit and stamps who and when. The check and the write
 * are one statement, save_memory_file(): a save over a newer version is refused (409)
 * so an append by AFK and an edit never silently overwrite each other, whatever the
 * timing. AFK's own history files cannot be edited.
 */
type Context = { params: Promise<{ path: string[] }> };

const bodySchema = z.object({
  content: z
    .string()
    .refine((value) => new TextEncoder().encode(value).length <= MEMORY_FILE_LIMIT_BYTES, {
      message: "too large",
    }),
  /** The updated_at the editor loaded; the save is refused if the row moved on since. */
  updatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export async function PUT(request: Request, context: Context) {
  const path = (await context.params).path.join("/");
  if (!isMemoryPath(path)) return jsonError(404, "Not found.");
  if (isAfkOnly(path))
    return jsonError(403, "AFK writes this file; you can erase it, not edit it.");

  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const visitor = await requireUser("Sign in to keep memory.", { countWrite: false });
  if (!visitor.ok) return visitor.response;

  // As the user (RLS and column grants apply): updates the row only if its updated_at
  // is still the one the editor loaded, inserts when there is no row yet, and raises
  // P0006 when the row moved on meanwhile.
  const { data: updatedAt, error } = await visitor.supabase.rpc("save_memory_file", {
    p_path: path,
    p_content: body.data.content,
    p_expected_updated_at: body.data.updatedAt ?? undefined,
  });
  if (error) {
    if (error.code === "P0006") {
      return jsonError(409, "This file changed meanwhile. Reload it, then make your change again.");
    }
    return dbFailure("memory.save_failed", error);
  }
  return Response.json({ updatedAt });
}
