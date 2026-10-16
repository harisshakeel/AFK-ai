import { describe, expect, it } from "vitest";

import { fillSignOff, notesEmail } from "./share-notes";

describe("sharing the notes by email", () => {
  it("lays out the decisions, the action items with owners and dates, and the summary by section", () => {
    const email = notesEmail({
      title: "Launch planning",
      headline: "The launch date was settled.",
      decisions: ["Launch on the twentieth"],
      actions: [
        { text: "Send the deck", owner: "Sam", due: "by Friday" },
        { text: "Check the pricing page", owner: null, due: null },
      ],
      points: [
        { section: "What you missed", text: "The date moved to the twentieth." },
        { section: "What needs you", text: "The deck is Sam's." },
      ],
      signOff: "Cheers, Haris",
      link: { url: "https://afk.example/m/abcdefghjkmn", pin: "0420" },
    });
    expect(email.subject).toBe("Notes from Launch planning");
    expect(email.body).toBe(
      [
        "Hi all,",
        "",
        "Here are the notes from Launch planning.",
        "",
        "The launch date was settled.",
        "",
        "What we decided",
        "- Launch on the twentieth",
        "",
        "Action items",
        "- Send the deck (Sam, by Friday)",
        "- Check the pricing page",
        "",
        "Summary",
        "",
        "What you missed",
        "- The date moved to the twentieth.",
        "",
        "What needs you",
        "- The deck is Sam's.",
        "",
        "The recording, the transcript and the summary: https://afk.example/m/abcdefghjkmn",
        "PIN: 0420",
        "",
        "Cheers, Haris",
      ].join("\n"),
    );
    const bare = notesEmail({
      title: "Sync",
      headline: null,
      decisions: [],
      actions: [],
      points: [],
      signOff: null,
      link: null,
    });
    expect(bare.body).toContain("Best,\n[your name]");
    expect(bare.body).not.toContain("What we decided");
  });

  it("fills the sign-off's placeholders: the host's name, or a blank to fill in; no one first name", () => {
    expect(fillSignOff("Best, {my name}", "Haris")).toBe("Best, Haris");
    expect(fillSignOff("Best, {my name}", null)).toBe("Best, [your name]");
    expect(fillSignOff("Thanks {first name}, {My Name}", " Haris ")).toBe("Thanks all, Haris");
    expect(fillSignOff(null, "Haris")).toBeNull();
  });
});
