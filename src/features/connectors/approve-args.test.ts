import { describe, expect, it } from "vitest";

import { APPROVED_SCHEMAS, approvalIssueMessage } from "./approve-args";

describe("approvalIssueMessage", () => {
  it("names the field to fix, in words, for each kind's schema", () => {
    const first = (kind: keyof typeof APPROVED_SCHEMAS, args: unknown) => {
      const parsed = APPROVED_SCHEMAS[kind].safeParse(args);
      return parsed.success ? null : approvalIssueMessage(parsed.error.issues[0]);
    };
    expect(first("email", { to: [], cc: [], subject: "S", body: "B" })).toBe(
      "Add at least one valid email address.",
    );
    expect(first("email", { to: ["a@example.com"], cc: ["nope"], subject: "S", body: "B" })).toBe(
      "Check the addresses to copy.",
    );
    expect(first("remind", { text: "Call Sam", startsAt: "tomorrow" })).toBe(
      "Pick a date and time.",
    );
    expect(first("slack", { channelId: "general", channelName: "general", message: "Hi" })).toBe(
      "Pick a channel.",
    );
    expect(approvalIssueMessage(undefined)).toBe("Check the details.");
  });
});
