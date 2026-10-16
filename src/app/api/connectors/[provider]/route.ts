import { z } from "zod";

import { revokeGoogleToken } from "@/features/connectors/google";
import { isProvider } from "@/features/connectors/registry";
import { revokeSlackToken, SLACK_CHANNEL_ID } from "@/features/connectors/slack";
import { deleteConnector, readSecret, updateConnectorConfig } from "@/server/connectors/store";
import { jsonError, readJson, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * Your own connector (requirement X2): DELETE disconnects, which revokes the token at
 * the provider (best effort) and deletes the row and its secret; PATCH stores the
 * non-secret settings, today the Slack channel. Owner-only: the caller's id is the key.
 */
type Context = { params: Promise<{ provider: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { provider } = await context.params;
  if (!isProvider(provider)) return jsonError(404, "Not found.");
  const visitor = await requireUser("Sign in to manage connectors.");
  if (!visitor.ok) return visitor.response;

  const secret = await readSecret(visitor.userId, provider);
  if (secret) {
    const revoked =
      provider === "google" ? await revokeGoogleToken(secret) : await revokeSlackToken(secret);
    log.info("connector.revoke", { provider, revoked });
  }
  const removed = await deleteConnector(visitor.userId, provider);
  if (!removed) return jsonError(404, "Nothing to disconnect.");
  log.info("connector.disconnected", { provider });
  return Response.json({ ok: true });
}

const settingsSchema = z.object({
  channelId: z.string().regex(SLACK_CHANNEL_ID),
  channelName: z.string().trim().min(1).max(80),
});

export async function PATCH(request: Request, context: Context) {
  const { provider } = await context.params;
  if (provider !== "slack") return jsonError(404, "Not found.");
  const visitor = await requireUser("Sign in to manage connectors.");
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, settingsSchema);
  if (!body.ok) return body.response;
  const updated = await updateConnectorConfig(visitor.userId, "slack", {
    channelId: body.data.channelId,
    channelName: body.data.channelName,
  });
  if (!updated) return jsonError(404, "Connect Slack first.");
  log.info("connector.settings", { provider });
  return Response.json({ ok: true });
}
