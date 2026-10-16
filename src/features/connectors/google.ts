import { z } from "zod";

import { GOOGLE_SCOPES } from "./registry.ts";

/**
 * Google OAuth 2.0 and the two APIs, over `fetch` only (requirements-v2 X1, X2, X4, X5).
 * The authorisation URL asks for offline access with a forced consent, which is what
 * makes Google issue a refresh token; the exchange and the refresh are server-side
 * form posts. Every response is validated before it is used.
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class GoogleError extends Error {
  readonly code: "invalid_grant" | "http" | "response";
  readonly status: number | undefined;

  constructor(message: string, code: "invalid_grant" | "http" | "response", status?: number) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
    this.status = status;
  }
}

export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
  id_token: z.string().min(1).optional(),
});

const idTokenClaims = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
});

/** The claims of an id_token straight from Google's token endpoint over TLS. */
export function decodeIdToken(idToken: string, clientId: string) {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new GoogleError("id_token is malformed", "response");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleError("id_token is malformed", "response");
  }
  const parsed = idTokenClaims.safeParse(claims);
  if (!parsed.success) throw new GoogleError("id_token has unexpected claims", "response");
  if (parsed.data.aud !== clientId)
    throw new GoogleError("id_token is for another app", "response");
  if (!/^https:\/\/accounts\.google\.com$|^accounts\.google\.com$/.test(parsed.data.iss)) {
    throw new GoogleError("id_token is not from Google", "response");
  }
  return parsed.data;
}

async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new GoogleError(
      `Google could not be reached: ${error instanceof Error ? error.message : "network"}`,
      "http",
    );
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const errorBody = z.object({ error: z.string(), error_description: z.string().optional() });

function throwForError(status: number, body: unknown, what: string): never {
  const parsed = errorBody.safeParse(body);
  if (parsed.success && parsed.data.error === "invalid_grant") {
    throw new GoogleError(
      "Google no longer accepts this token; reconnect Google.",
      "invalid_grant",
      status,
    );
  }
  const reason = parsed.success ? parsed.data.error : `HTTP ${status}`;
  throw new GoogleError(`${what} failed: ${reason}`, "http", status);
}

export type GoogleTokens = {
  accessToken: string;
  expiresInSec: number;
  refreshToken: string | null;
  scopes: string[];
  /** From the id_token: who connected. */
  subject: string;
  email: string | null;
};

export async function exchangeGoogleCode(
  input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const { status, body } = await postForm(
    GOOGLE_TOKEN_URL,
    {
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    },
    fetchImpl,
  );
  if (status !== 200) throwForError(status, body, "The code exchange");
  const parsed = tokenResponse.safeParse(body);
  if (!parsed.success) throw new GoogleError("The token response was not understood", "response");
  if (!parsed.data.id_token) throw new GoogleError("Google sent no id_token", "response");
  const claims = decodeIdToken(parsed.data.id_token, input.clientId);
  return {
    accessToken: parsed.data.access_token,
    expiresInSec: parsed.data.expires_in,
    refreshToken: parsed.data.refresh_token ?? null,
    scopes: parsed.data.scope.split(" ").filter(Boolean),
    subject: claims.sub,
    email: claims.email_verified === false ? null : (claims.email ?? null),
  };
}

export async function refreshGoogleAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSec: number; scopes: string[] }> {
  const { status, body } = await postForm(
    GOOGLE_TOKEN_URL,
    {
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  if (status !== 200) throwForError(status, body, "The token refresh");
  const parsed = tokenResponse.safeParse(body);
  if (!parsed.success) throw new GoogleError("The token response was not understood", "response");
  return {
    accessToken: parsed.data.access_token,
    expiresInSec: parsed.data.expires_in,
    scopes: parsed.data.scope.split(" ").filter(Boolean),
  };
}

/** Best effort: Google answers 200 for a token it revoked and 400 for one it no longer knows. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const { status } = await postForm(GOOGLE_REVOKE_URL, { token }, fetchImpl);
    return status === 200;
  } catch {
    return false;
  }
}
