import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The grant a visitor holds after the right PIN (2026-10-16): a cookie for that code,
 * signed by the server, good for seven days. Nothing is stored for it; the signature
 * is the proof. A grant names its code, so one link's cookie opens no other.
 */
export const GRANT_DAYS = 7;

export function grantCookieName(code: string): string {
  return `afk-m-${code}`;
}

function key(serverSecret: string): Buffer {
  return createHmac("sha256", serverSecret).update("afk meeting-link grant v1").digest();
}

function sign(code: string, expiresAt: number, serverSecret: string): string {
  return createHmac("sha256", key(serverSecret)).update(`${code}.${expiresAt}`).digest("hex");
}

/** "<expiry>.<signature>": the cookie's value for a code, from now. */
export function mintGrant(code: string, serverSecret: string, now = Date.now()): string {
  const expiresAt = now + GRANT_DAYS * 86_400_000;
  return `${expiresAt}.${sign(code, expiresAt, serverSecret)}`;
}

/** Whether a cookie value is a live grant for this code. */
export function verifyGrant(
  code: string,
  value: string | undefined,
  serverSecret: string,
  now = Date.now(),
): boolean {
  if (!value) return false;
  const [expiry, signature] = value.split(".");
  if (!expiry || !signature || !/^\d{1,16}$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(sign(code, expiresAt, serverSecret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
