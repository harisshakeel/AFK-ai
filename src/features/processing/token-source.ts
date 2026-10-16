import { AdapterError } from "../connectors/adapters/adapter.ts";
import { GoogleError, refreshGoogleAccessToken } from "../connectors/google.ts";
import type { Provider } from "../connectors/registry.ts";
import { openSecret, tokenBinding } from "../connectors/token-crypto.ts";
import type { Db, ProcessingConfig } from "./config.ts";
import { TransientError } from "./jobs.ts";

/**
 * The connector a command runs through (design-v2 section 4.5, "TokenSource"): the row
 * and its sealed secret, opened with the server's key, then for Google exchanged for a
 * one-hour access token. The refresh token never leaves this process; a refresh Google
 * refuses marks the connector expired so the Connectors page says "reconnect".
 */
export type LoadedConnector = {
  id: string;
  provider: Provider;
  account: string;
  scopes: string[];
  status: string;
  /** The refresh token (Google) or the bot token (Slack). */
  secret: string;
};

export async function loadConnector(
  db: Db,
  config: ProcessingConfig,
  ownerId: string,
  provider: Provider,
): Promise<LoadedConnector | null> {
  if (!config.connectorTokenKey) {
    throw new AdapterError("CONNECTOR_TOKEN_KEY is not set, so the token cannot be opened.");
  }
  const { data: row, error } = await db
    .from("connectors")
    .select("id, provider, account, scopes, status, connector_secrets(ciphertext)")
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new TransientError(`database read failed: ${error.message}`);
  if (!row) return null;
  const sealed = row.connector_secrets?.ciphertext;
  if (!sealed) return null;
  return {
    id: row.id,
    provider: row.provider as Provider,
    account: row.account,
    scopes: row.scopes ?? [],
    status: row.status,
    secret: openSecret(sealed, config.connectorTokenKey, tokenBinding(ownerId, provider)),
  };
}

export async function googleAccessToken(
  db: Db,
  config: ProcessingConfig,
  connector: LoadedConnector,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!config.google) {
    throw new AdapterError(
      "The Google client id and secret are not set, so Google cannot be used.",
    );
  }
  try {
    const token = await refreshGoogleAccessToken(
      {
        refreshToken: connector.secret,
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
      },
      fetchImpl,
    );
    return token.accessToken;
  } catch (error) {
    if (error instanceof GoogleError && error.code === "invalid_grant") {
      await db.from("connectors").update({ status: "expired" }).eq("id", connector.id);
      throw new AdapterError(
        "Google no longer accepts AFK's access. Reconnect Google on the Connectors page.",
      );
    }
    if (error instanceof GoogleError && error.code === "http" && error.status === undefined) {
      throw new TransientError(error.message);
    }
    throw new AdapterError(
      error instanceof Error ? error.message : "Google refused the token refresh.",
    );
  }
}
