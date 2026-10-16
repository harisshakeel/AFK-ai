import { listSlackChannels, SlackError } from "@/features/connectors/slack";
import { readSecret } from "@/server/connectors/store";
import { jsonError, requireUser } from "@/server/http";
import { log } from "@/server/log";

/** The public channels of your connected Slack workspace, for the channel picker. */
export async function GET() {
  const visitor = await requireUser("Sign in to manage connectors.", { countWrite: false });
  if (!visitor.ok) return visitor.response;
  const token = await readSecret(visitor.userId, "slack").catch((error: unknown) => {
    log.warn("connector.secret_unreadable", {
      provider: "slack",
      error: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  });
  if (token === undefined) {
    return jsonError(502, "AFK can't read the Slack connection. Reconnect Slack on this page.");
  }
  if (!token) return jsonError(404, "Connect Slack first.");
  try {
    const channels = await listSlackChannels(token);
    return Response.json({ channels });
  } catch (error) {
    log.warn("connector.channels_failed", {
      code: error instanceof SlackError ? error.code : "unknown",
    });
    return jsonError(502, "Slack didn't answer. Try again in a moment.");
  }
}
