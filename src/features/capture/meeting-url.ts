/**
 * Which links AFK may send its bot to (requirement F9): https only, and the host must be
 * exactly a Zoom, Google Meet or Microsoft Teams host. Matching is on the parsed
 * hostname with a dot boundary, so "zoom.us.evil.example" and "evilzoom.us" are refused.
 */
export type MeetingPlatform = "zoom" | "meet" | "teams";

export type MeetingUrlResult =
  { ok: true; url: string; platform: MeetingPlatform } | { ok: false; reason: string };

const PLATFORMS: Array<{ platform: MeetingPlatform; hosts: string[]; path?: RegExp }> = [
  // Meet codes look like abc-defg-hij
  { platform: "meet", hosts: ["meet.google.com"], path: /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i },
  { platform: "zoom", hosts: ["zoom.us", "zoom.com"], path: /^\/(j|my|wc\/join|s)\/[\w.-]+\/?$/i },
  { platform: "teams", hosts: ["teams.microsoft.com", "teams.live.com"] },
];

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function parseMeetingUrl(input: string): MeetingUrlResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "Paste the meeting's link." };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "That doesn't look like a link." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Meeting links start with https://." };
  if (url.username || url.password || url.port) {
    return { ok: false, reason: "That link has parts a meeting link never has." };
  }
  const host = url.hostname.toLowerCase();
  for (const { platform, hosts, path } of PLATFORMS) {
    if (!hosts.some((allowed) => hostMatches(host, allowed))) continue;
    if (path && !path.test(url.pathname)) {
      return { ok: false, reason: "That's not a link to a specific meeting." };
    }
    url.hash = "";
    return { ok: true, url: url.toString(), platform };
  }
  return { ok: false, reason: "AFK can join Zoom, Google Meet and Microsoft Teams links." };
}

export const PLATFORM_NAMES: Record<MeetingPlatform, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  teams: "Microsoft Teams",
};
