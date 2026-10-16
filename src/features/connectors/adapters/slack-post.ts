import type { SlackApproved } from "../approve-args.ts";
import type { ActionResult } from "../history.ts";
import { postSlackMessage, SlackError } from "../slack.ts";
import { AdapterError, AMBIGUOUS_SUFFIX } from "./adapter.ts";

/** Posts the approved message to the chosen channel (requirement X7). Never retried. */
export async function runSlackPost(input: {
  args: SlackApproved;
  botToken: string;
  teamName: string;
  fetchImpl?: typeof fetch;
}): Promise<ActionResult> {
  try {
    const posted = await postSlackMessage(
      { token: input.botToken, channelId: input.args.channelId, text: input.args.message },
      input.fetchImpl ?? fetch,
    );
    return {
      kind: "slack",
      channelName: input.args.channelName,
      message: input.args.message,
      ts: posted.ts,
      teamName: input.teamName,
    };
  } catch (error) {
    if (error instanceof SlackError) {
      // The request may have arrived: a dropped connection, or a 5xx Slack sent after it.
      const ambiguous = error.code === "network" || /^http_5/.test(error.code);
      const reason =
        error.code === "channel_not_found"
          ? "Slack can't find that channel any more. Pick another on the Connectors page."
          : error.code === "not_in_channel"
            ? "AFK's Slack app can't post there. Invite it to the channel, or pick a public one."
            : error.code === "token_revoked" || error.code === "invalid_auth"
              ? "Slack no longer accepts AFK's token. Reconnect Slack."
              : error.message;
      throw new AdapterError(
        ambiguous ? `${reason}. It may have been posted.${AMBIGUOUS_SUFFIX}` : reason,
        {
          ambiguous,
        },
      );
    }
    throw error;
  }
}
