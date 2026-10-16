import { describe, expect, it } from "vitest";

import { checklistItems } from "./first-run-checklist";

describe("the first-run checklist", () => {
  it("lists the four things a Google user does once, ticked from what exists", () => {
    const items = checklistItems({
      guest: false,
      googleReady: true,
      slackChannel: false,
      nameInCalls: false,
      sentOnce: true,
    });
    expect(items.map((item) => `${item.key}:${item.done}`)).toEqual([
      "google:true",
      "slack:false",
      "name:false",
      "send:true",
    ]);
    expect(items.find((item) => item.key === "slack")?.href).toBe("/connectors");
  });

  it("asks a guest only to try one call and to continue with Google", () => {
    const items = checklistItems({
      guest: true,
      googleReady: false,
      slackChannel: false,
      nameInCalls: false,
      sentOnce: false,
    });
    expect(items.map((item) => item.key)).toEqual(["send", "google"]);
  });
});
