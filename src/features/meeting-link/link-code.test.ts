import { describe, expect, it } from "vitest";

import { cleanPin, isLinkCode, linkCodesIn, linkMessage, linkUrl } from "./link-code";

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

  it("finds every meeting address in a message, by its code, once each", () => {
    const body =
      "Notes: https://afk-ai-tau.vercel.app/m/abcdefghjkmn (PIN 0420). Again: /m/abcdefghjkmn";
    expect(linkCodesIn(body)).toEqual(["abcdefghjkmn"]);
    expect(linkCodesIn("see /m/abcdefghjkmn and /m/zzzzzzzzzzzz.")).toEqual([
      "abcdefghjkmn",
      "zzzzzzzzzzzz",
    ]);
    expect(linkCodesIn("/m/abcdefghjkmnx is too long, /m/short too short")).toEqual([]);
    expect(linkCodesIn("no address here")).toEqual([]);
  });
});
