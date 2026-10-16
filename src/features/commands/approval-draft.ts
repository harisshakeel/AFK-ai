import {
  browserOffset,
  inputValueToIso,
  isoToInputValue,
  offsetOf,
  splitAddresses,
  type ApprovableKind,
} from "../connectors/approve-args.ts";

/**
 * What an approval card's fields hold, and the details they become: the pure half of the
 * approval form (requirement C4). The card fills the fields from the draft, the address
 * book and the skills; the owner edits them; approving sends approvalArgs(), which the
 * kind's schema then checks in the browser and again on the server.
 */
export type ApprovalFields = {
  to: string;
  cc: string;
  subject: string;
  body: string;
  title: string;
  /** A datetime-local value, in the meeting's or the browser's offset. */
  when: string;
  duration: string;
  text: string;
  message: string;
  channel: { id: string; name: string } | null;
};

const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

export function initialFields(input: {
  kind: ApprovableKind;
  args: Record<string, unknown>;
  /** Addresses the address book or the call gave for the heard names, best first. */
  suggested: ReadonlyArray<string>;
  skills: { alwaysInvite: ReadonlyArray<string>; alwaysCopy: ReadonlyArray<string> };
  skillMinutes: number | null;
  defaultChannel: { id: string; name: string } | null;
}): ApprovalFields {
  const { kind, args } = input;
  const to = [...input.suggested, ...(kind === "followup" ? input.skills.alwaysInvite : [])];
  return {
    to: to.filter((email, index) => to.indexOf(email) === index).join(", "),
    cc: input.skills.alwaysCopy.join(", "),
    subject: asString(args.subject) ?? "",
    body: asString(args.body) ?? "",
    title: asString(args.title) ?? "",
    when: isoToInputValue(asString(args.startsAt)),
    duration: String(asNumber(args.durationMin) ?? input.skillMinutes ?? 30),
    text: asString(args.text) ?? "",
    message: asString(args.message) ?? "",
    channel: input.defaultChannel,
  };
}

/** The details approving sends, for the kind's schema to check. */
export function approvalArgs(
  kind: ApprovableKind,
  fields: ApprovalFields,
  draftStartsAt: string | null,
): unknown {
  // The time is read in the offset the draft was written for, else the browser's.
  const offset = offsetOf(draftStartsAt) ?? browserOffset();
  switch (kind) {
    case "email":
      return {
        to: splitAddresses(fields.to),
        cc: splitAddresses(fields.cc),
        subject: fields.subject,
        body: fields.body,
      };
    case "followup":
      return {
        title: fields.title,
        startsAt: inputValueToIso(fields.when, offset) ?? "",
        durationMin: Number(fields.duration),
        attendees: splitAddresses(fields.to),
        description: null,
      };
    case "remind":
      return { text: fields.text, startsAt: inputValueToIso(fields.when, offset) ?? "" };
    case "slack":
      return {
        channelId: fields.channel?.id ?? "",
        channelName: fields.channel?.name ?? "",
        message: fields.message,
      };
  }
}

/**
 * The lengths a follow-up offers: the usual ones, the calendar skill's own, and the one
 * the draft carries (a spoken "40 minutes"), so the select shows what approving sends.
 */
export function durationChoices(
  skillMinutes: number | null,
  draftMinutes: string | null = null,
): number[] {
  const choices = [15, 30, 45, 60, 90, 120];
  const drafted = draftMinutes === null ? NaN : Number(draftMinutes);
  for (const minutes of [skillMinutes, Number.isInteger(drafted) ? drafted : null]) {
    if (minutes && !choices.includes(minutes)) choices.push(minutes);
  }
  return choices.sort((a, b) => a - b);
}
