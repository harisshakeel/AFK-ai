import type { SupabaseClient } from "@supabase/supabase-js";

import { ATTENDEE_DEFAULT_URL } from "../capture/attendee.ts";
import type { Database } from "../../lib/database.types.ts";
import type { ServerEnv } from "../../lib/env.ts";
import type { ClaudeRunner } from "./claude.ts";

/**
 * What a processing run needs, handed in by the web app's server module
 * (src/server/jobs.ts): the service-role client, the Claude runner, and the keys the
 * ingest and the connectors use. No module in this folder reads the environment; the
 * one mapping from it lives here.
 */
export type Db = SupabaseClient<Database>;

export type ProcessingConfig = {
  /** Recorded on the jobs this run claims. */
  workerId: string;
  attendee: { apiKey: string; baseUrl: string } | null;
  /** The key that opens sealed connector tokens, and Google's OAuth client. */
  connectorTokenKey: string | null;
  google: { clientId: string; clientSecret: string } | null;
  /** Where the site answers, for links in what AFK sends (the note to the owner). */
  siteUrl: string;
};

type ProcessingEnv = Pick<
  ServerEnv,
  | "ATTENDEE_API_KEY"
  | "ATTENDEE_API_URL"
  | "CONNECTOR_TOKEN_KEY"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
>;

export function buildProcessingConfig(
  workerId: string,
  env: ProcessingEnv,
  siteUrl: string,
): ProcessingConfig {
  return {
    workerId,
    siteUrl,
    attendee: env.ATTENDEE_API_KEY
      ? { apiKey: env.ATTENDEE_API_KEY, baseUrl: env.ATTENDEE_API_URL ?? ATTENDEE_DEFAULT_URL }
      : null,
    connectorTokenKey: env.CONNECTOR_TOKEN_KEY ?? null,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
  };
}

export type ProcessingLog = (
  event: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
) => void;

export type ProcessingDeps = {
  db: Db;
  config: ProcessingConfig;
  claude: ClaudeRunner;
  log: ProcessingLog;
};
