import { describe, expect, it } from "vitest";

import { ownerNoteEmail } from "./notify-owner";

describe("the note to the owner", () => {
  it("says what was written up, what waits, and where, in a few plain lines", () => {
    const note = ownerNoteEmail({
      title: "Launch planning",
      headline: "The launch date was settled and the deck has an owner.",
      actions: 3,
      decisions: 1,
      waiting: 2,
      meetingUrl: "https://afk.example/meetings/abc",
    });
    expect(note.subject).toBe("2 waiting: Launch planning is written up");
    expect(note.body).toContain("The launch date was settled");
    expect(note.body).toContain("3 action items, 1 decision.");
    expect(note.body).toContain("2 cards are waiting for your approval");
    expect(note.body).toContain("Open it: https://afk.example/meetings/abc");
    const quiet = ownerNoteEmail({
      title: "Stand-up",
      headline: null,
      actions: 1,
      decisions: 0,
      waiting: 0,
      meetingUrl: "https://afk.example/meetings/x",
    });
    expect(quiet.subject).toBe("Stand-up is written up");
    expect(quiet.body).toContain("Nothing is waiting for your approval.");
    expect(quiet.body).toContain("1 action item, 0 decisions.");
  });
});
