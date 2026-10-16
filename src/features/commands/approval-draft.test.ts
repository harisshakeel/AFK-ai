import { describe, expect, it } from "vitest";

import { APPROVED_SCHEMAS } from "../connectors/approve-args";
import { approvalArgs, durationChoices, initialFields } from "./approval-draft";

const base = {
  suggested: ["sam@example.com"],
  skills: { alwaysInvite: ["ops@example.com", "sam@example.com"], alwaysCopy: ["me@example.com"] },
  skillMinutes: null,
  defaultChannel: null,
};

describe("the approval card's fields", () => {
  it("start from the draft, the address book and the skills", () => {
    const email = initialFields({
      ...base,
      kind: "email",
      args: { subject: "Launch", body: "Hi Sam" },
    });
    expect(email).toMatchObject({
      to: "sam@example.com",
      cc: "me@example.com",
      subject: "Launch",
      body: "Hi Sam",
    });
    // A follow-up also invites the skill's "always invite" people, each once.
    const followup = initialFields({ ...base, kind: "followup", args: { durationMin: 45 } });
    expect(followup.to).toBe("sam@example.com, ops@example.com");
    expect(followup.duration).toBe("45");
  });

  it("become details the kind's schema accepts", () => {
    const fields = initialFields({
      ...base,
      kind: "followup",
      args: { title: "Follow-up: launch", startsAt: "2026-10-21T15:00:00+05:00" },
    });
    const args = approvalArgs("followup", fields, "2026-10-21T15:00:00+05:00");
    const parsed = APPROVED_SCHEMAS.followup.safeParse(args);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.startsAt).toBe("2026-10-21T15:00:00+05:00");
    expect(parsed.data?.durationMin).toBe(30);

    const slack = initialFields({
      ...base,
      kind: "slack",
      args: { message: "Deck is out" },
      defaultChannel: { id: "C0123ABCD", name: "launch" },
    });
    expect(APPROVED_SCHEMAS.slack.safeParse(approvalArgs("slack", slack, null)).success).toBe(true);
  });

  it("offer the usual lengths, with the calendar skill's own among them", () => {
    expect(durationChoices(null)).toEqual([15, 30, 45, 60, 90, 120]);
    expect(durationChoices(50)).toEqual([15, 30, 45, 50, 60, 90, 120]);
    // A spoken length is among them, so the select shows what approving sends.
    const followup = initialFields({ ...base, kind: "followup", args: { durationMin: 40 } });
    expect(durationChoices(null, followup.duration)).toContain(40);
    expect(durationChoices(50, "50")).toEqual([15, 30, 45, 50, 60, 90, 120]);
  });
});
