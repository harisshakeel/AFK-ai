import { NextResponse, type NextRequest } from "next/server";

import { googleAuthUrl } from "@/features/connectors/google";
import {
  newConnectState,
  pkceChallenge,
  sealConnectState,
} from "@/features/connectors/oauth-state";
import { isProvider } from "@/features/connectors/registry";
import { slackAuthUrl } from "@/features/connectors/slack";
import { isGoogleUser } from "@/lib/google-user";
import { callbackUrl, CONNECT_COOKIE, connectorSetup } from "@/server/connectors/config";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";

/**
 * Starts a connection (requirement X1): a signed-in, non-anonymous user is sent to the
 * provider's consent screen with a state bound to them in a short-lived cookie. Google
 * gets PKCE and a forced consent for offline access; Slack gets the bot scopes.
 */
type Context = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { provider } = await context.params;
  const back = (query: string) =>
    NextResponse.redirect(new URL(`/connectors?${query}`, request.url));
  if (!isProvider(provider)) return NextResponse.redirect(new URL("/connectors", request.url));

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId || !isGoogleUser(data.claims)) {
    return NextResponse.redirect(new URL("/sign-in?next=%2Fconnectors", request.url));
  }

  const setup = connectorSetup();
  const client = setup.tokenKey ? setup[provider] : null;
  if (!client || !setup.tokenKey) return back("error=setup");

  const state = newConnectState(userId, provider);
  const redirectUri = callbackUrl(provider);
  const url =
    provider === "google"
      ? googleAuthUrl({
          clientId: client.clientId,
          redirectUri,
          state: state.nonce,
          codeChallenge: pkceChallenge(state.verifier),
          loginHint: typeof data.claims.email === "string" ? data.claims.email : null,
        })
      : slackAuthUrl({ clientId: client.clientId, redirectUri, state: state.nonce });

  const response = NextResponse.redirect(url);
  response.cookies.set(CONNECT_COOKIE, sealConnectState(state, setup.tokenKey), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/connectors",
    maxAge: 600,
  });
  log.info("connector.start", { provider });
  return response;
}
