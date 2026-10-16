import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth round trip's state (requirement X1): a random nonce bound to the user and
 * the provider, signed so the callback can tell its own start from a link someone else
 * made, plus the PKCE verifier for Google. The signed value lives in a short-lived
 * cookie; only the nonce travels through the provider as `state`.
 */
export type ConnectState = {
  nonce: string;
  userId: string;
  provider: string;
  /** The PKCE code verifier (Google); empty for providers without PKCE. */
  verifier: string;
  /** Unix seconds. */
  expiresAt: number;
};

export const CONNECT_STATE_TTL_SEC = 10 * 60;

const base64url = (value: Buffer) => value.toString("base64url");

export function newConnectState(
  userId: string,
  provider: string,
  now: Date = new Date(),
): ConnectState {
  return {
    nonce: base64url(randomBytes(24)),
    userId,
    provider,
    verifier: base64url(randomBytes(48)),
    expiresAt: Math.floor(now.getTime() / 1000) + CONNECT_STATE_TTL_SEC,
  };
}

/** PKCE S256: the challenge Google gets up front, proved by the verifier at exchange. */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/**
 * Signed under a key derived from CONNECTOR_TOKEN_KEY for this one purpose, never the
 * token-sealing key itself: one secret, one use, so a weakness in either cannot reach
 * the other.
 */
function sign(payload: string, keyBase64: string): string {
  const key = createHmac("sha256", Buffer.from(keyBase64, "base64"))
    .update("afk oauth-state v1")
    .digest();
  return base64url(createHmac("sha256", key).update(payload).digest());
}

/** The cookie value: "<payload>.<signature>", payload base64url JSON. */
export function sealConnectState(state: ConnectState, keyBase64: string): string {
  const payload = base64url(Buffer.from(JSON.stringify(state), "utf8"));
  return `${payload}.${sign(payload, keyBase64)}`;
}

/** The state back from the cookie, or null when it is forged, expired or malformed. */
export function openConnectState(
  sealed: string | undefined,
  keyBase64: string,
  now: Date = new Date(),
): ConnectState | null {
  if (!sealed) return null;
  const [payload, signature, ...rest] = sealed.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = sign(payload, keyBase64);
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as Record<string, unknown>;
  if (
    typeof state.nonce !== "string" ||
    typeof state.userId !== "string" ||
    typeof state.provider !== "string" ||
    typeof state.verifier !== "string" ||
    typeof state.expiresAt !== "number"
  ) {
    return null;
  }
  if (state.expiresAt < Math.floor(now.getTime() / 1000)) return null;
  return state as ConnectState;
}
