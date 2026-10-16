import { z } from "zod";

import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";
import { log } from "@/server/log";

const bodySchema = z.object({ email: z.email().max(254) });

/**
 * POST: a visitor asks to be added to the Google test users, the only people who can
 * sign in while the app is in Testing (docs/going-live.md). The visitor's own identity
 * writes the row, so the visitor write limit applies. An address already on the list
 * gets the same answer as a new one, so the form cannot be used to probe the list. One
 * identity can ask three times (the database's cap, migration 46).
 */
export async function POST(request: Request) {
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  // The table's own trigger counts this write against the limit (migration 29).
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const email = body.data.email.trim().toLowerCase();
  const { error } = await visitor.supabase.from("access_requests").insert({ email });
  if (error?.code === "P0007") {
    return jsonError(429, "AFK has your requests already. The owner adds people by hand.");
  }
  if (error && error.code !== "23505") return dbFailure("access_request.insert_failed", error);
  log.info("access_request.created", { userId: visitor.userId });
  return Response.json({ ok: true });
}
