import { visitorFetch } from "@/lib/visitor-api";

import type { SlackChannel } from "./slack";

/**
 * The connected workspace's channels, asked for once and shared: every Slack card on a
 * page (and the Connectors panel) wants the same list, and each request reads up to five
 * pages from Slack, whose limit on that call is about twenty a minute. One request in
 * flight, kept a minute; a failure is forgotten so the next caller asks again.
 */
const KEEP_MS = 60_000;
let shared: { at: number; channels: Promise<SlackChannel[]> } | null = null;

export function loadSlackChannels(): Promise<SlackChannel[]> {
  if (shared && Date.now() - shared.at < KEEP_MS) return shared.channels;
  const channels = visitorFetch<{ channels: SlackChannel[] }>("/api/connectors/slack/channels", {
    method: "GET",
  }).then((result) => result.channels);
  const entry = { at: Date.now(), channels };
  shared = entry;
  channels.catch(() => {
    if (shared === entry) shared = null;
  });
  return channels;
}
