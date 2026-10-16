import { cookies } from "next/headers";

import { isLinkCode } from "@/features/meeting-link/link-code";
import { grantCookieName, verifyGrant } from "@/features/meeting-link/link-grant";
import { getSharedMedia } from "@/features/meeting-link/link-queries";
import { serverEnv } from "@/lib/env";
import { jsonError } from "@/server/http";

/**
 * A fresh link to a shared meeting's recording (2026-10-16), for the page to renew
 * before the current one expires. Only with a grant for this code, and only while the
 * link is on.
 */
type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, context: Context) {
  const { code } = await context.params;
  if (!isLinkCode(code)) return jsonError(404, "Not found.");
  const store = await cookies();
  const granted = verifyGrant(
    code,
    store.get(grantCookieName(code))?.value,
    serverEnv().SUPABASE_SECRET_KEY,
  );
  if (!granted) return jsonError(401, "Enter the PIN first.");
  const media = await getSharedMedia(code);
  if (!media) return jsonError(404, "Not found.");
  return Response.json(media, { headers: { "Cache-Control": "private, no-store" } });
}
