import type { EmailApproved } from "../approve-args.ts";
import { buildRawEmail, GmailError, sendGmail } from "../gmail.ts";
import type { ActionResult } from "../history.ts";
import { AdapterError, AMBIGUOUS_SUFFIX } from "./adapter.ts";

/** Sends the approved draft from the host's own Gmail (requirement X4). Never retried. */
export async function runGmailSend(input: {
  args: EmailApproved;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<ActionResult> {
  const raw = buildRawEmail({
    to: input.args.to,
    cc: input.args.cc,
    subject: input.args.subject,
    body: input.args.body,
  });
  try {
    const sent = await sendGmail({ accessToken: input.accessToken, raw }, input.fetchImpl ?? fetch);
    return {
      kind: "email",
      to: [...input.args.to, ...input.args.cc],
      subject: input.args.subject,
      messageId: sent.messageId,
    };
  } catch (error) {
    if (error instanceof GmailError) {
      // The request may have arrived: a dropped connection, or a 5xx Gmail sent after it.
      const ambiguous =
        error.code === "http" && (error.status === undefined || error.status >= 500);
      throw new AdapterError(
        ambiguous ? `${error.message}. It may have been sent.${AMBIGUOUS_SUFFIX}` : error.message,
        { ambiguous },
      );
    }
    throw error;
  }
}
