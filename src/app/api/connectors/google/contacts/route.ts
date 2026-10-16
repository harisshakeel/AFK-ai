import { contactsAccess } from "@/features/connectors/registry";
import { listOtherContacts, listSavedContacts, PeopleError } from "@/features/connectors/people";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { googleAccessForUser, listConnectors } from "@/server/connectors/store";
import { dbFailure, jsonError, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * Import the caller's Google contacts into the people AFK knows: the saved contacts and
 * the people Google lists from who they write to, whichever the connection allows.
 * Read-only at Google; written through learn_contacts() without counting a use, so a
 * confirmed card still outranks an imported name. Counts only in the answer and the log.
 */
export const maxDuration = 60;

export async function POST() {
  const visitor = await requireUser("Sign in with Google to import your contacts.");
  if (!visitor.ok) return visitor.response;
  const access = contactsAccess(await listConnectors());
  if (!access.saved && !access.others) {
    return jsonError(409, "Reconnect Google and allow the contacts boxes to import them.");
  }
  const google = await googleAccessForUser(visitor.userId).catch((error: unknown) => {
    log.warn("contacts.token_failed", { error: error instanceof Error ? error.name : "unknown" });
    return null;
  });
  if (!google) return jsonError(409, "Google is not connected. Connect it on this page first.");

  // learn_contacts() is the service role's: it writes the session user's own contacts
  // (p_owner_id is the visitor's id from requireUser, never a value from the request).
  const admin = createSupabaseAdminClient();
  const counts = { saved: 0, others: 0 };
  try {
    if (access.saved) {
      const people = await listSavedContacts(google.accessToken);
      const { data, error } = await admin.rpc("learn_contacts", {
        p_owner_id: visitor.userId,
        p_people: people,
        p_source: "google_contacts",
        p_used: false,
      });
      if (error) return dbFailure("contacts.learn_failed", error);
      counts.saved = data ?? 0;
    }
    if (access.others) {
      const people = await listOtherContacts(google.accessToken);
      const { data, error } = await admin.rpc("learn_contacts", {
        p_owner_id: visitor.userId,
        p_people: people,
        p_source: "google_other",
        p_used: false,
      });
      if (error) return dbFailure("contacts.learn_failed", error);
      counts.others = data ?? 0;
    }
  } catch (error) {
    log.warn("contacts.import_failed", {
      status: error instanceof PeopleError ? error.status : 0,
      error: error instanceof Error ? error.name : "unknown",
    });
    return jsonError(502, "Google didn't answer. Try again in a moment.");
  }
  log.info("contacts.imported", { count: counts.saved + counts.others });
  return Response.json(counts);
}
