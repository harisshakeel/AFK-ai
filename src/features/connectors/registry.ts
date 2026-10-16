import type { CommandKind } from "../commands/registry.ts";

/**
 * The three apps AFK can act through (requirements-v2 X1, X4, X5, X7): Gmail and Google
 * Calendar under one Google consent, and Slack. One table that the Connectors page, the
 * approve route, the Tasks tab and the job runner all read. Shared by the job runner and the web
 * app: no React, no server-only imports.
 */
export type Provider = "google" | "slack";
export type ConnectorAppId = "gmail" | "google-calendar" | "slack";

export type ConnectorApp = {
  id: ConnectorAppId;
  name: string;
  provider: Provider;
  /** The OAuth scope this app needs, as the provider names it. */
  scope: string;
  /** What AFK may do with it, in the owner's words. */
  does: string;
  /** Which commands run through it. */
  commands: ReadonlyArray<CommandKind>;
};

export const GOOGLE_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/**
 * Read-only access to the host's saved contacts and to the people Google lists from who
 * they write to (its "other contacts"), so AFK can suggest addresses.
 */
export const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const GOOGLE_OTHER_CONTACTS_SCOPE =
  "https://www.googleapis.com/auth/contacts.other.readonly";
/** openid + email identify the account; the rest are the two apps and the contacts. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  GOOGLE_GMAIL_SCOPE,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CONTACTS_SCOPE,
  GOOGLE_OTHER_CONTACTS_SCOPE,
];

/** Which of the contacts scopes a Google connection granted, if any. */
export function contactsAccess(connectors: ReadonlyArray<ConnectorView>): {
  saved: boolean;
  others: boolean;
} {
  const google = connectors.find(
    (candidate) => candidate.provider === "google" && candidate.status === "connected",
  );
  return {
    saved: google?.scopes.includes(GOOGLE_CONTACTS_SCOPE) ?? false,
    others: google?.scopes.includes(GOOGLE_OTHER_CONTACTS_SCOPE) ?? false,
  };
}

export const SLACK_SCOPES = ["chat:write", "chat:write.public", "channels:read"];

export const CONNECTOR_APPS: ReadonlyArray<ConnectorApp> = [
  {
    id: "gmail",
    name: "Gmail",
    provider: "google",
    scope: GOOGLE_GMAIL_SCOPE,
    does: "Sends the email drafts you approve, from your own address, so replies come back to you.",
    commands: ["email"],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    provider: "google",
    scope: GOOGLE_CALENDAR_SCOPE,
    does: "Puts follow-ups and reminders you approve on your calendar, with invitations to the people you named.",
    commands: ["followup", "remind"],
  },
  {
    id: "slack",
    name: "Slack",
    provider: "slack",
    scope: "chat:write",
    does: "Posts the messages you approve to one channel you choose.",
    commands: ["slack"],
  },
];

export function connectorApp(id: ConnectorAppId): ConnectorApp {
  const app = CONNECTOR_APPS.find((candidate) => candidate.id === id);
  if (!app) throw new Error(`unknown connector app ${id}`);
  return app;
}

/** The app a command kind runs through, or null for internal kinds. */
export function appForKind(kind: CommandKind | "unknown"): ConnectorApp | null {
  return CONNECTOR_APPS.find((app) => app.commands.includes(kind as CommandKind)) ?? null;
}

export function isProvider(value: string): value is Provider {
  return value === "google" || value === "slack";
}

/** A connected provider as the app and the job runner see it; never the token. */
export type ConnectorView = {
  id: string;
  provider: Provider;
  account: string;
  scopes: string[];
  config: Record<string, unknown>;
  status: "connected" | "expired" | "revoked";
  connectedAt: string;
  lastUsedAt: string | null;
  expiresHintAt: string | null;
};

/** Whether this app can act: a connected provider that granted the app's scope. */
export function appReady(app: ConnectorApp, connectors: ReadonlyArray<ConnectorView>): boolean {
  const connector = connectors.find((candidate) => candidate.provider === app.provider);
  if (!connector || connector.status !== "connected") return false;
  if (app.provider === "slack") return typeof connector.config.channelId === "string";
  return connector.scopes.includes(app.scope);
}

/** Google refresh tokens last seven days while the OAuth app is in Testing. */
export const GOOGLE_TESTING_TOKEN_DAYS = 7;
