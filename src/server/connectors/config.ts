import "server-only";

import type { Provider } from "@/features/connectors/registry";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * What this deployment can connect (requirement X1): each provider needs its OAuth
 * client in the environment, and every provider needs the key that seals tokens. A
 * missing value makes the Connectors page say so instead of failing at the callback.
 */
export type ProviderSetup = { clientId: string; clientSecret: string };

export function connectorSetup(): {
  tokenKey: string | null;
  google: ProviderSetup | null;
  slack: ProviderSetup | null;
} {
  const env = serverEnv();
  return {
    tokenKey: env.CONNECTOR_TOKEN_KEY ?? null,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    slack:
      env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET
        ? { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET }
        : null,
  };
}

/** The redirect URI registered with the provider: always the site's own origin. */
export function callbackUrl(provider: Provider): string {
  return new URL(`/connectors/${provider}/callback`, publicEnv.NEXT_PUBLIC_SITE_URL).toString();
}

export const CONNECT_COOKIE = "afk-connect";
