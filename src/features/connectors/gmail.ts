import { z } from "zod";

/**
 * Gmail send (requirements X4): an RFC 5322 message, base64url, posted to
 * users.messages.send with the host's one-hour access token. Gmail fills in From. The
 * message is built here so the exact bytes are unit-tested; the HTTP call is thin.
 */
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Good enough to refuse junk and header injection; Gmail validates the rest. */
export const EMAIL_ADDRESS = /^[^\s<>@,;:"()[\]\\]+@[^\s<>@,;:"()[\]\\]+\.[^\s<>@,;:"()[\]\\]+$/;

export class GmailError extends Error {
  readonly code: "http" | "response" | "auth";
  readonly status: number | undefined;

  constructor(message: string, code: "http" | "response" | "auth", status?: number) {
    super(message);
    this.name = "GmailError";
    this.code = code;
    this.status = status;
  }
}

const noLineBreaks = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** RFC 2047 encoded-word for anything outside printable ASCII. */
export function encodeHeaderText(value: string): string {
  const clean = noLineBreaks(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function wrap76(base64: string): string {
  return base64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

export function buildRawEmail(input: {
  to: ReadonlyArray<string>;
  subject: string;
  body: string;
  cc?: ReadonlyArray<string>;
}): string {
  const to = input.to.map(noLineBreaks).filter((address) => EMAIL_ADDRESS.test(address));
  if (to.length === 0) throw new GmailError("no valid recipient", "response");
  const cc = (input.cc ?? []).map(noLineBreaks).filter((address) => EMAIL_ADDRESS.test(address));
  const headers = [
    `To: ${to.join(", ")}`,
    cc.length > 0 ? `Cc: ${cc.join(", ")}` : null,
    `Subject: ${encodeHeaderText(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((line) => line !== null);
  const body = wrap76(Buffer.from(input.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"));
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

const sendResponse = z.object({ id: z.string().min(1), threadId: z.string().min(1) });

export async function sendGmail(
  input: { accessToken: string; raw: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string; threadId: string }> {
  let response: Response;
  try {
    response = await fetchImpl(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ raw: toBase64Url(input.raw) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new GmailError(
      `Gmail could not be reached: ${error instanceof Error ? error.message : "network"}`,
      "http",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new GmailError(
      "Gmail refused the token; reconnect Google and allow sending.",
      "auth",
      response.status,
    );
  }
  if (response.status !== 200) {
    throw new GmailError(`Gmail answered ${response.status}`, "http", response.status);
  }
  const parsed = sendResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new GmailError("Gmail's answer was not understood", "response");
  return { messageId: parsed.data.id, threadId: parsed.data.threadId };
}
