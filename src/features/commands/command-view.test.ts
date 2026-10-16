import { describe, expect, it } from "vitest";

import { canRewrite, cardError } from "./command-view";

describe("cardError", () => {
  it("shows an error written for the owner as it is", () => {
    for (const error of [
      "Google no longer accepts AFK's access. Reconnect Google on the Connectors page.",
      "Nothing followed the command word.",
      "Past the limit of 20 spoken commands for this meeting, so not applied.",
    ]) {
      expect(cardError({ status: "failed", error })).toBe(error);
    }
  });

  it("replaces a line the runner logged with a plain one for the card's state", () => {
    expect(cardError({ status: "failed", error: "start_command failed: permission denied" })).toBe(
      "AFK couldn't finish this one.",
    );
    expect(cardError({ status: "approved", error: "Gmail answered 400" })).toBe(
      "The last try didn't go through. AFK tries again shortly.",
    );
    expect(
      cardError({ status: "failed", error: "the output could not be stored (23514)" }),
    ).not.toContain("23514");
    expect(
      cardError({ status: "failed", error: "Claude did not answer in the time it was given" }),
    ).toBe("AFK couldn't finish this one.");
    expect(cardError({ status: "proposed", error: null })).toBeNull();
  });
});

describe("canRewrite", () => {
  it("allows three rewrites, and none on a Share the notes card", () => {
    expect(canRewrite({ rewrites: 2, args: {} })).toBe(true);
    expect(canRewrite({ rewrites: 3, args: {} })).toBe(false);
    expect(canRewrite({ rewrites: 0, args: { sharedNotes: true } })).toBe(false);
  });
});
