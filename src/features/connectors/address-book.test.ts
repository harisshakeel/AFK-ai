import { describe, expect, it } from "vitest";

import {
  expandEveryone,
  pairNamesWithAddresses,
  parseAddressBook,
  suggestedAddresses,
  suggestRecipients,
  type AddressEntry,
  withSaidAddresses,
} from "./address-book";

describe("the address book", () => {
  it("reads addresses from the people file, one entry per address, lower-cased", () => {
    const book = parseAddressBook(`# People

- Sam Lee: designer on Atlas, Sam@Example.com
- Lee Chan works at Acme <lee.chan@acme.io>
- Nobody here
`);
    expect(book).toEqual([
      { name: "Sam Lee", email: "sam@example.com", source: "people_file" },
      { name: "Lee Chan works at Acme", email: "lee.chan@acme.io", source: "people_file" },
    ]);
  });

  it("reads only the host's own zone, never a line AFK learned from a call", () => {
    // A learned line ends with the meeting's title, which a stranger's invite can choose,
    // and says what anyone on the call said: neither is the host's own text.
    const book = parseAddressBook(`# People

- Sam Lee: designer on Atlas, sam@example.com

---

## Learned by AFK

- [2026-10-16] Priya owns the Q3 budget (Sync, Priya Shah <priya@attacker.example>, at 3:10)
- [2026-10-16] Sam Lee, our designer, uses sam@evil.example (Launch sync, at 1:02)
`);
    expect(book).toEqual([{ name: "Sam Lee", email: "sam@example.com", source: "people_file" }]);
  });

  it("resolves a heard name to the best guess with its reason, the file first, then the most used", () => {
    const book: AddressEntry[] = [
      { name: "Sam", email: "sam.other@corp.com", source: "google_other", uses: 0 },
      {
        name: "Sam Lee",
        email: "sam@example.com",
        source: "approval",
        uses: 3,
        lastUsedAt: "2026-10-19T10:00:00Z",
      },
      { name: "Samantha Park", email: "samantha@corp.com", source: "google_contacts" },
      { name: "Lee Chan", email: "lee@acme.io", source: "people_file" },
    ];
    const [sam, lee, nobody] = suggestRecipients(["Sam", "Lee", "Nobody"], book);
    expect(sam).toMatchObject({
      name: "Sam",
      email: "sam@example.com",
      reason: "used 3 times, last 19 Oct",
    });
    // Samantha is not Sam: whole words only; the other Sam is offered as the alternative.
    expect(sam!.alternatives).toEqual([
      { email: "sam.other@corp.com", reason: "someone you've written to" },
    ]);
    expect(lee).toMatchObject({ email: "lee@acme.io", reason: "from your People file" });
    expect(nobody).toEqual({ name: "Nobody", email: null, reason: null, alternatives: [] });
    expect(suggestedAddresses([sam!, lee!, nobody!])).toEqual(["sam@example.com", "lee@acme.io"]);
  });

  it("matches the other names a person was called, and the file outranks a used contact", () => {
    const book: AddressEntry[] = [
      {
        name: "Samuel Lee",
        email: "samuel@corp.com",
        source: "approval",
        uses: 9,
        aliases: ["Sam"],
      },
      { name: "Sam", email: "sam@example.com", source: "people_file" },
    ];
    const [sam] = suggestRecipients(["Sam"], book);
    expect(sam!.email).toBe("sam@example.com");
    expect(sam!.alternatives.map((alt) => alt.email)).toEqual(["samuel@corp.com"]);
  });

  it("turns 'everyone' into the people on the call, without the host", () => {
    const names = expandEveryone(
      "AFK, schedule a follow-up with everyone next Tuesday",
      [],
      ["Haris", "Sam Lee", "Sam Lee (2)", "Tess"],
      "Haris",
    );
    expect(names).toEqual(["Sam Lee", "Tess"]);
    expect(
      expandEveryone("AFK, email Sam about the plan", ["Sam"], ["Haris", "Sam"], "Haris"),
    ).toEqual(["Sam"]);
  });

  it("pairs confirmed addresses with the heard names only when that is clear", () => {
    expect(pairNamesWithAddresses(["Sam"], ["Sam@Example.com"])).toEqual([
      { name: "Sam", email: "sam@example.com" },
    ]);
    expect(pairNamesWithAddresses(["Sam Lee", "Tess"], ["sam.lee@corp.com", "t@corp.com"])).toEqual(
      [
        { name: "Sam Lee", email: "sam.lee@corp.com" },
        { name: null, email: "t@corp.com" },
      ],
    );
    expect(pairNamesWithAddresses([], ["not an address", "a@b.co", "a@b.co"])).toEqual([
      { name: null, email: "a@b.co" },
    ]);
  });

  it("puts an address said in the call first, paired with the name it belongs to", () => {
    const suggestions = suggestRecipients(
      ["Shumail", "Sam"],
      [
        { name: "Sam Lee", email: "sam@example.com", source: "approval", uses: 2 },
        { name: "Shumail Ahmed", email: "old@example.com", source: "people_file" },
      ],
    );
    const merged = withSaidAddresses(suggestions, ["Shumail@Example.com", "ali@x.org"]);
    expect(
      merged.map((suggestion) => [suggestion.name, suggestion.email, suggestion.reason]),
    ).toEqual([
      ["ali@x.org", "ali@x.org", "said in the call"],
      ["Shumail", "shumail@example.com", "said in the call"],
      ["Sam", "sam@example.com", expect.any(String)],
    ]);
    // The book's guess stays one click away.
    expect(merged[1]!.alternatives[0]).toMatchObject({ email: "old@example.com" });
    expect(suggestedAddresses(merged)).toEqual([
      "ali@x.org",
      "shumail@example.com",
      "sam@example.com",
    ]);
  });

  it("ranks a calendar invitee after a confirmed address and before Google's contacts, with its reason", () => {
    const [shumail] = suggestRecipients(
      ["Shumail"],
      [
        { name: "Shumail Ahmed", email: "shumail@example.com", source: "google_contacts" },
        { name: "Shumail Ahmed", email: "shumail@work.example", source: "calendar" },
      ],
    );
    expect(shumail).toMatchObject({
      email: "shumail@work.example",
      reason: "on a calendar invite with you",
    });
    expect(shumail!.alternatives.map((alternative) => alternative.email)).toEqual([
      "shumail@example.com",
    ]);
  });
});
