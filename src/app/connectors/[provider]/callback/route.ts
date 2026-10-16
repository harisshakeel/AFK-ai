import { NextResponse, type NextRequest } from "next/server";

import { exchangeGoogleCode, GoogleError } from "@/features/connectors/google";
import { openConnectState } from "@/features/connectors/oauth-state";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_GMAIL_SCOPE,
  GOOGLE_TESTING_TOKEN_DAYS,
  isProvider,
} from "@/features/connectors/registry";
import { exchangeSlackCode, SlackError } from "@/features/connectors/slack";
import { isGoogleUser } from "@/lib/google-user";
import { callbackUrl, CONNECT_COOKIE, connectorSetup } from "@/server/connectors/config";
import { storeConnector } from "@/server/connectors/store";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";

/**
 * The provider sends the user back here with a code (requirement X1). The state cookie
 * proves this browser, this user and this provider started the round trip; the code is
 * exchanged server-side; the refresh token (Google) or bot token (Slack) is sealed and
 * stored once, and never reaches the browser or a log.
 */
type Context = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { provider } = await context.params;
  const url = request.nextUrl;
  const done = (query: string) => {
    const response = NextResponse.redirect(new URL(`/connectors?${query}`, request.url));
    response.cookies.set(CONNECT_COOKIE, "", { path: "/connectors", maxAge: 0 });
    return response;
  };
  if (!isProvider(provider)) return done("error=provider");

  const setup = connectorSetup();
  const client = setup.tokenKey ? setup[provider] : null;
  if (!client || !setup.tokenKey) return done("error=setup");

  const state = openConnectState(request.cookies.get(CONNECT_COOKIE)?.value, setup.tokenKey);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (
    !state ||
    !userId ||
    !isGoogleUser(data.claims) ||
    state.userId !== userId ||
    state.provider !== provider ||
    url.searchParams.get("state") !== state.nonce
  ) {
    log.warn("connector.state_mismatch", { provider });
    return done("error=state");
  }

  if (url.searchParams.get("error")) {
    log.info("connector.denied", { provider });
    return done("error=denied");
  }
  const code = url.searchParams.get("code");
  if (!code) return done("error=state");

  try {
    if (provider === "google") {
      const tokens = await exchangeGoogleCode({
        code,
        codeVerifier: state.verifier,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        redirectUri: callbackUrl("google"),
      });
      if (!tokens.refreshToken) return done("error=no_refresh");
      const granted = tokens.scopes.filter(
        (scope) => scope === GOOGLE_GMAIL_SCOPE || scope === GOOGLE_CALENDAR_SCOPE,
      );
      if (granted.length === 0) return done("error=scopes");
      await storeConnector({
        ownerId: userId,
        provider: "google",
        account: tokens.email ?? tokens.subject,
        externalId: tokens.subject,
        scopes: tokens.scopes,
        config: {},
        secret: tokens.refreshToken,
        expiresHintAt: new Date(Date.now() + GOOGLE_TESTING_TOKEN_DAYS * 86_400_000),
      });
      log.info("connector.connected", { provider, scopes: granted.length });
      return done(`connected=google${granted.length < 2 ? "&partial=1" : ""}`);
    }

    const install = await exchangeSlackCode({
      code,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: callbackUrl("slack"),
    });
    await storeConnector({
      ownerId: userId,
      provider: "slack",
      account: install.teamName,
      externalId: install.teamId,
      scopes: install.scopes,
      config: {},
      secret: install.botToken,
      expiresHintAt: null,
    });
    log.info("connector.connected", { provider });
    return done("connected=slack");
  } catch (error) {
    const reason =
      error instanceof GoogleError || error instanceof SlackError ? error.code : "unknown";
    log.error("connector.callback_failed", new Error(reason), { provider });
    return done("error=exchange");
  }
}
