import { describe, expect, it } from "vitest";

import { cleanPin, isLinkCode, linkMessage, linkUrl } from "./link-code";

describe("a meeting's address", () => {
  it("knows a code and a PIN when it sees one", () => {
    expect(isLinkCode("abcdefghjkmn")).toBe(true);
    expect(isLinkCode("abcdefghjkm")).toBe(false);
    expect(isLinkCode("ABCDEFGHJKMN")).toBe(false);
    expect(isLinkCode("abcdefghjkm/")).toBe(false);
    expect(cleanPin("0420")).toBe("0420");
    expect(cleanPin(" 04 20 ")).toBe("0420");
    expect(cleanPin("042")).toBeNull();
    expect(cleanPin("04201")).toBeNull();
  });

  it("writes the address and the line to pass on", () => {
    expect(linkUrl("https://afk.example/", "abcdefghjkmn")).toBe(
      "https://afk.example/m/abcdefghjkmn",
    );
    expect(linkMessage("https://afk.example/m/abcdefghjkmn", "0420")).toBe(
      "https://afk.example/m/abcdefghjkmn (PIN 0420)",
    );
  });
});
