import { z } from "zod";

import { dbFailure, jsonError, requireVisitor } from "@/server/http";

/**
 * Make (or return the existing) share link for one of the visitor's highlights
 * (requirement F7). The token is 32 random bytes minted by the database (a trigger
 * overwrites whatever a client sends); RLS only lets the highlight's owner create it. The
 * database counts the write against the visitor's limit.
 */
type Context = { params: Promise<{ highlightId: string }> };

export async function POST(_request: Request, context: Context) {
  const { highlightId } = await context.params;
  if (!z.uuid().safeParse(highlightId).success)
    return jsonError(404, "That highlight doesn't exist.");
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;

  const { data: existing, error: readError } = await visitor.supabase
    .from("share_links")
    .select("token")
    .eq("highlight_id", highlightId)
    .is("revoked_at", null)
    .maybeSingle();
  if (readError) return dbFailure("share.read_failed", readError);
  if (existing) return Response.json({ token: existing.token });

  // The value is a placeholder of the right shape; the database replaces it.
  const { data: created, error } = await visitor.supabase
    .from("share_links")
    .insert({ token: "0".repeat(64), highlight_id: highlightId })
    .select("token")
    .single();
  if (error) {
    // Not the owner's highlight (RLS) looks the same as a missing one.
    if (error.code === "42501") return jsonError(404, "That highlight doesn't exist.");
    if (error.code === "23505") {
      // Two overlapping "Share" clicks: the other one made the link; return it.
      const { data: live } = await visitor.supabase
        .from("share_links")
        .select("token")
        .eq("highlight_id", highlightId)
        .is("revoked_at", null)
        .maybeSingle();
      if (live) return Response.json({ token: live.token });
    }
    return dbFailure("share.create_failed", error);
  }
  return Response.json({ token: created.token }, { status: 201 });
}

/** Turn the link off. The row stays (revoked_at), so the owner keeps the history. */
export async function DELETE(_request: Request, context: Context) {
  const { highlightId } = await context.params;
  if (!z.uuid().safeParse(highlightId).success)
    return jsonError(404, "That highlight doesn't exist.");
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const { error } = await visitor.supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("highlight_id", highlightId)
    .is("revoked_at", null);
  if (error) return dbFailure("share.revoke_failed", error);
  return Response.json({ revoked: true });
}
