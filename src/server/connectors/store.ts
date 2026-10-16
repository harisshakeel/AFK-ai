import "server-only";

import { parseAddressBook, type AddressEntry } from "@/features/connectors/address-book";
import { isProvider, type ConnectorView, type Provider } from "@/features/connectors/registry";
import { sealSecret, tokenBinding } from "@/features/connectors/token-crypto";
import { googleAccessToken, loadConnector } from "@/features/processing/token-source";
import type { Json } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { createSupabaseServerClient } from "@/server/db/supabase-server";

import { connectorSetup } from "./config";

/**
 * Connector rows (requirement X1, X2). Reads happen as the user, so Row Level Security
 * returns only their own; writes go through the admin client after the route has decided
 * who the caller is, as the bot route does. Tokens are sealed before they are stored and
 * opened only here, for a revocation or a Slack channel list.
 */
export async function listConnectors(): Promise<ConnectorView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("connectors")
    .select(
      "id, provider, account, scopes, config, status, connected_at, last_used_at, expires_hint_at",
    )
    .order("provider");
  if (error) throw new Error(`could not load connectors: ${error.message}`);
  return (data ?? [])
    .filter((row) => isProvider(row.provider))
    .map((row) => ({
      id: row.id,
      provider: row.provider as Provider,
      account: row.account,
      scopes: row.scopes ?? [],
      config: (row.config ?? {}) as Record<string, unknown>,
      status: row.status as ConnectorView["status"],
      connectedAt: row.connected_at,
      lastUsedAt: row.last_used_at,
      expiresHintAt: row.expires_hint_at,
    }));
}

export async function storeConnector(input: {
  ownerId: string;
  provider: Provider;
  account: string;
  externalId: string | null;
  scopes: string[];
  config: Record<string, Json>;
  secret: string;
  expiresHintAt: Date | null;
}): Promise<string> {
  const { tokenKey } = connectorSetup();
  if (!tokenKey) throw new Error("CONNECTOR_TOKEN_KEY is not set");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("store_connector", {
    p_owner_id: input.ownerId,
    p_provider: input.provider,
    p_account: input.account,
    // The function takes text; an empty string stands for "none" (Slack and Google both
    // supply one, so this is a safety net, not a path that runs).
    p_external_id: input.externalId ?? "",
    p_scopes: input.scopes,
    p_config: input.config,
    p_ciphertext: sealSecret(input.secret, tokenKey, tokenBinding(input.ownerId, input.provider)),
    p_expires_hint_at: input.expiresHintAt?.toISOString(),
  });
  if (error) throw new Error(`could not store the connector: ${error.message}`);
  return data;
}

/** The opened token of the caller's own connector, for a revocation or a channel list. */
export async function readSecret(ownerId: string, provider: Provider): Promise<string | null> {
  const { tokenKey } = connectorSetup();
  if (!tokenKey) return null;
  const connector = await loadConnector(
    createSupabaseAdminClient(),
    { workerId: "web", attendee: null, connectorTokenKey: tokenKey, google: null, siteUrl: "" },
    ownerId,
    provider,
  );
  return connector?.secret ?? null;
}

/**
 * A fresh Google access token for the caller's own connection, for the web's own calls
 * (the contacts import); the refresh happens as it does in the job runner, and a
 * revoked grant marks the connector expired the same way. Null when Google is not set
 * up here or not connected.
 */
export async function googleAccessForUser(
  ownerId: string,
): Promise<{ accessToken: string; scopes: string[] } | null> {
  const setup = connectorSetup();
  if (!setup.tokenKey || !setup.google) return null;
  const admin = createSupabaseAdminClient();
  const config = {
    workerId: "web",
    attendee: null,
    connectorTokenKey: setup.tokenKey,
    google: setup.google,
    siteUrl: "",
  };
  const connector = await loadConnector(admin, config, ownerId, "google");
  if (!connector || connector.status !== "connected") return null;
  const accessToken = await googleAccessToken(admin, config, connector);
  return { accessToken, scopes: connector.scopes };
}

export async function deleteConnector(ownerId: string, provider: Provider): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("connectors")
    .delete()
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .select("id");
  if (error) throw new Error(`could not delete the connector: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function updateConnectorConfig(
  ownerId: string,
  provider: Provider,
  config: Record<string, Json>,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("connectors")
    .update({ config })
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .select("id");
  if (error) throw new Error(`could not update the connector: ${error.message}`);
  return (data ?? []).length > 0;
}

/** A contact AFK learned, as the Memory page lists it. */
export type ContactView = {
  id: string;
  name: string;
  email: string;
  aliases: string[];
  source: AddressEntry["source"];
  uses: number;
  lastUsedAt: string | null;
};

/** The caller's own learned contacts (RLS: a guest has none), most used first. */
export async function listContacts(): Promise<ContactView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name, email, aliases, source, uses, last_used_at")
    .order("uses", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`could not load contacts: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    aliases: row.aliases ?? [],
    source: row.source as AddressEntry["source"],
    uses: row.uses,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * The book a card resolves names against: the caller's people file, as written, and
 * the contacts AFK learned. The same address in both keeps the file's name and the
 * contact's use count, so the host's own line wins the wording and the history the rank.
 */
export async function loadAddressBook(): Promise<AddressEntry[]> {
  const supabase = await createSupabaseServerClient();
  const [file, contacts] = await Promise.all([
    supabase.from("memory_files").select("content").eq("path", "context/people.md").maybeSingle(),
    listContacts(),
  ]);
  const book: AddressEntry[] = file.data?.content ? parseAddressBook(file.data.content) : [];
  for (const contact of contacts) {
    const written = book.find((entry) => entry.email === contact.email);
    if (written) {
      written.aliases = [contact.name, ...contact.aliases].filter((name) => name !== written.name);
      written.uses = contact.uses;
      written.lastUsedAt = contact.lastUsedAt;
      continue;
    }
    book.push({
      name: contact.name,
      email: contact.email,
      source: contact.source,
      aliases: contact.aliases,
      uses: contact.uses,
      lastUsedAt: contact.lastUsedAt,
    });
  }
  return book;
}
