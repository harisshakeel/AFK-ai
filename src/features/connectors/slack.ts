import { z } from "zod";

import { SLACK_SCOPES } from "./registry.ts";

/**
 * Slack OAuth v2 and the Web API, over `fetch` only (requirements-v2 X7). The app
 * installs into a workspace and gets a bot token; `chat:write.public` lets it post to
 * any public channel without joining, and `channels:read` lists them for the picker.
 */
export const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_API_URL = "https://slack.com/api";

export class SlackError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = "SlackError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function slackAuthUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(SLACK_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", SLACK_SCOPES.join(","));
  url.searchParams.set("user_scope", "");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function call(
  method: string,
  init: {
    token?: string;
    form?: Record<string, string>;
    json?: unknown;
    query?: Record<string, string>;
  },
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const url = new URL(`${SLACK_API_URL}/${method}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: body === undefined ? "GET" : "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SlackError(
      `Slack could not be reached: ${error instanceof Error ? error.message : "network"}`,
      "network",
      true,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    throw new SlackError(`Slack answered ${response.status}`, `http_${response.status}`, true);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new SlackError("Slack's answer was not JSON", "response");
  }
  const envelope = z.object({ ok: z.boolean(), error: z.string().optional() }).safeParse(parsed);
  if (!envelope.success) throw new SlackError("Slack's answer was not understood", "response");
  if (!envelope.data.ok) {
    throw new SlackError(
      `Slack refused: ${envelope.data.error ?? "unknown error"}`,
      envelope.data.error ?? "unknown",
    );
  }
  return parsed as Record<string, unknown>;
}

const accessResponse = z.object({
  access_token: z.string().min(1),
  scope: z.string().default(""),
  team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
});

export type SlackInstall = { botToken: string; scopes: string[]; teamId: string; teamName: string };

export async function exchangeSlackCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SlackInstall> {
  const body = await call(
    "oauth.v2.access",
    {
      form: {
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
      },
    },
    fetchImpl,
  );
  const parsed = accessResponse.safeParse(body);
  if (!parsed.success)
    throw new SlackError("Slack's install answer was not understood", "response");
  return {
    botToken: parsed.data.access_token,
    scopes: parsed.data.scope.split(",").filter(Boolean),
    teamId: parsed.data.team.id,
    teamName: parsed.data.team.name,
  };
}

export type SlackChannel = { id: string; name: string };

const channelsResponse = z.object({
  channels: z.array(
    z.object({ id: z.string(), name: z.string(), is_archived: z.boolean().optional() }),
  ),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

/** Pages of 200; a workspace with more channels than this gets its first thousand. */
const CHANNEL_PAGES = 5;

export async function listSlackChannels(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < CHANNEL_PAGES; page += 1) {
    const body = await call(
      "conversations.list",
      {
        token,
        query: {
          types: "public_channel",
          exclude_archived: "true",
          limit: "200",
          ...(cursor ? { cursor } : {}),
        },
      },
      fetchImpl,
    );
    const parsed = channelsResponse.safeParse(body);
    if (!parsed.success) {
      throw new SlackError("Slack's channel list was not understood", "response");
    }
    for (const channel of parsed.data.channels) {
      if (!channel.is_archived) channels.push({ id: channel.id, name: channel.name });
    }
    cursor = parsed.data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

const postResponse = z.object({ ts: z.string().min(1), channel: z.string().min(1) });

export async function postSlackMessage(
  input: { token: string; channelId: string; text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ts: string; channelId: string }> {
  const body = await call(
    "chat.postMessage",
    { token: input.token, json: { channel: input.channelId, text: input.text } },
    fetchImpl,
  );
  const parsed = postResponse.safeParse(body);
  if (!parsed.success) throw new SlackError("Slack's post answer was not understood", "response");
  return { ts: parsed.data.ts, channelId: parsed.data.channel };
}

/** Best effort: the token is gone from Slack's side, or it already was. */
export async function revokeSlackToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    await call("auth.revoke", { token, query: { test: "false" } }, fetchImpl);
    return true;
  } catch {
    return false;
  }
}

/** Slack channel ids: C… for public channels, G… for private groups. */
export const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;
