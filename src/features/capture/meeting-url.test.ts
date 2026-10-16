import { describe, expect, it } from "vitest";

import { parseMeetingUrl } from "./meeting-url";

describe("parseMeetingUrl", () => {
  it.each([
    ["https://meet.google.com/abc-defg-hij", "meet"],
    ["meet.google.com/abc-defg-hij?authuser=1", "meet"],
    ["https://us02web.zoom.us/j/81234567890?pwd=abc", "zoom"],
    ["https://zoom.us/j/81234567890", "zoom"],
    ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0", "teams"],
    ["https://teams.live.com/meet/9876543210", "teams"],
  ])("accepts %s", (input, platform) => {
    const result = parseMeetingUrl(input);
    expect(result).toMatchObject({ ok: true, platform });
  });

  it.each([
    "http://meet.google.com/abc-defg-hij",
    "https://zoom.us.evil.example/j/123",
    "https://evilzoom.us/j/123",
    "https://meet.google.com.attacker.io/abc-defg-hij",
    "https://user:pass@zoom.us/j/123",
    "https://zoom.us:8443/j/123",
    "https://meet.google.com/",
    "https://example.com/meeting",
    "javascript:alert(1)",
    "",
    "not a link at all",
  ])("refuses %s", (input) => {
    expect(parseMeetingUrl(input).ok).toBe(false);
  });

  it("drops the fragment and keeps the query", () => {
    const result = parseMeetingUrl("https://zoom.us/j/81234567890?pwd=x#success");
    expect(result).toEqual({
      ok: true,
      url: "https://zoom.us/j/81234567890?pwd=x",
      platform: "zoom",
    });
  });
});
