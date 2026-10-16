import { z } from "zod";

import { cleanPin, isLinkCode } from "@/features/meeting-link/link-code";
import { GRANT_DAYS, grantCookieName, mintGrant } from "@/features/meeting-link/link-grant";
import { serverEnv } from "@/lib/env";
import { clientAddress, clientKey } from "@/lib/read-limit";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { dbFailure, jsonError, readJson } from "@/server/http";
import { log } from "@/server/log";

/**
 * The PIN for a meeting's link (2026-10-16). The database checks it under a lock and
 * counts wrong tries per link and visitor; a right one earns a signed grant cookie for
 * this code, good for seven days. Unknown codes answer like wrong PINs.
 */
type Context = { params: Promise<{ code: string }> };

const bodySchema = z.object({ pin: z.string().max(16) });

const outcomeSchema = z.union([
  z.object({ ok: z.literal(true), meetingId: z.string() }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["wrong", "locked"]),
    triesLeft: z.number().optional(),
    lockedUntil: z.string().optional(),
  }),
]);

export async function POST(request: Request, context: Context) {
  const { code } = await context.params;
  if (!isLinkCode(code)) return jsonError(404, "Not found.");
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const pin = cleanPin(body.data.pin);
  if (!pin) return jsonError(400, "The PIN is four digits.");

  const env = serverEnv();
  const key = clientKey(clientAddress(request.headers), env.SUPABASE_SECRET_KEY);
  // open_meeting_link() is the service role's: a PIN holder has no session, and the
  // function itself checks the code, the PIN and the tries before it names a meeting.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("open_meeting_link", {
    p_code: code,
    p_pin: pin,
    p_client_key: key,
  });
  if (error) return dbFailure("link.open_failed", error);
  const outcome = outcomeSchema.safeParse(data);
  if (!outcome.success) return jsonError(500, "That didn't work. Try again.");
  if (!outcome.data.ok) {
    if (outcome.data.reason === "locked") {
      log.info("link.locked", { code });
      return Response.json(
        { error: "Too many wrong PINs. Try again in fifteen minutes.", reason: "locked" },
        { status: 423 },
      );
    }
    const left = outcome.data.triesLeft ?? 0;
    return Response.json(
      {
        error: `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`,
        reason: "wrong",
        triesLeft: left,
      },
      { status: 401 },
    );
  }

  log.info("link.opened", { meetingId: outcome.data.meetingId });
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${grantCookieName(code)}=${mintGrant(code, env.SUPABASE_SECRET_KEY)}`,
    "Path=/",
    `Max-Age=${GRANT_DAYS * 86_400}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
