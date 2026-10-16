import { jsonError, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * Forget one learned contact. Deleted as the caller, so Row Level Security allows only
 * their own rows; a guest has none and is refused like any other memory write.
 */
type Context = { params: Promise<{ contactId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: Context) {
  const { contactId } = await context.params;
  if (!UUID.test(contactId)) return jsonError(404, "Not found.");
  const visitor = await requireUser("Sign in with Google to manage the people AFK knows.");
  if (!visitor.ok) return visitor.response;
  const { data, error } = await visitor.supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .select("id");
  if (error) {
    log.error("contacts.delete_failed", new Error(error.code ?? "db_error"));
    return jsonError(500, "That didn't save. Try again.");
  }
  if (!data || data.length === 0) return jsonError(404, "Not found.");
  log.info("contacts.deleted", { userId: visitor.userId });
  return Response.json({ deleted: true });
}
