import { describe, expect, it } from "vitest";

import { fillEmailNames, fillLinkPlaceholders, fillNamePlaceholders, hostName } from "./fill-names";

describe("the names an email draft is signed and addressed with", () => {
  it("fills the host's and the recipient's placeholders, and leaves what it does not know", () => {
    expect(
      fillNamePlaceholders("Hi {first name},\n\nBest, {my name}", {
        myName: "Haris",
        firstName: "Shumail",
      }),
    ).toBe("Hi Shumail,\n\nBest, Haris");
    expect(
      fillNamePlaceholders("Regards,\n[your name]", { myName: "Haris", firstName: null }),
    ).toBe("Regards,\nHaris");
    // No name known: the placeholder stays for the host to fill on the card.
    expect(fillNamePlaceholders("Best, {my name}", { myName: null, firstName: null })).toBe(
      "Best, {my name}",
    );
    // "[name]" and "[date]" are the model's own blanks for facts not said: untouched.
    expect(fillNamePlaceholders("by [date], with [name]", { myName: "H", firstName: "S" })).toBe(
      "by [date], with [name]",
    );
  });

  it("takes the host's name from the profile first, then from the names the meeting was sent under", () => {
    const files = [
      { path: "profile.md" as const, content: "# Profile\n\n- Name: Haris Shakeel\n" },
    ];
    expect(hostName(files, ["Muhammad Haris"])).toBe("Haris Shakeel");
    expect(hostName([], ["Muhammad Haris", "Haris"])).toBe("Muhammad Haris");
    expect(hostName(null, null)).toBeNull();
  });

  it("fills a draft from its first recipient's first name", () => {
    const filled = fillEmailNames(
      {
        toNames: ["Shumail Ahmed"],
        toAddresses: [],
        subject: "Your interview, {first name}",
        body: "Hi {first name},\n\nThanks.\n\nBest, {my name}",
      },
      "Haris",
    );
    expect(filled.subject).toBe("Your interview, Shumail");
    expect(filled.body).toBe("Hi Shumail,\n\nThanks.\n\nBest, Haris");
  });

  it("fills a link or PIN placeholder with the meeting's address when the link is on", () => {
    const link = { url: "https://afk.example/m/abcdefghjkmn", pin: "0420" };
    expect(
      fillLinkPlaceholders("Meeting link: [add meeting link]\nPIN: [add PIN]\n\nHaris", link),
    ).toBe("Meeting link: https://afk.example/m/abcdefghjkmn\nPIN: 0420\n\nHaris");
    expect(fillLinkPlaceholders("Watch it here: {link} ({pin})", link)).toBe(
      "Watch it here: https://afk.example/m/abcdefghjkmn (0420)",
    );
    // Other blanks stay, and nothing changes when the link is off.
    expect(fillLinkPlaceholders("by [date], see [the recording link]", null)).toBe(
      "by [date], see [the recording link]",
    );
    expect(fillLinkPlaceholders("by [date], see [the recording link]", link)).toBe(
      "by [date], see https://afk.example/m/abcdefghjkmn",
    );
    const filled = fillEmailNames(
      {
        toNames: ["Shumail"],
        toAddresses: [],
        subject: "Recording",
        body: "{first name}: [link], PIN [pin]. {my name}",
      },
      "Haris",
      link,
    );
    expect(filled.body).toBe("Shumail: https://afk.example/m/abcdefghjkmn, PIN 0420. Haris");
  });
});
