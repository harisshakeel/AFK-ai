import { z } from "zod";

import { EMAIL_ADDRESS } from "./gmail.ts";
import { SLACK_CHANNEL_ID } from "./slack.ts";

/**
 * What the owner confirms on the card (requirements-v2 C4, C7, decision 9): the exact
 * arguments an adapter runs with. The parse proposes names and time words; the owner
 * fills in addresses, confirms the date and the message, and approves once. Shared by
 * the approve route, the Tasks tab and the job runner.
 */
const address = z.string().trim().max(254).regex(EMAIL_ADDRESS, "not an email address");

export const emailApprovedSchema = z.object({
  to: z.array(address).min(1).max(5),
  cc: z.array(address).max(5).default([]),
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

export const followupApprovedSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(15).max(240),
  attendees: z.array(address).max(10).default([]),
  description: z.string().trim().max(2000).nullable().default(null),
});

export const remindApprovedSchema = z.object({
  text: z.string().trim().min(1).max(300),
  startsAt: z.iso.datetime({ offset: true }),
});

export const slackApprovedSchema = z.object({
  channelId: z.string().regex(SLACK_CHANNEL_ID, "not a Slack channel id"),
  channelName: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(2000),
});

export type EmailApproved = z.infer<typeof emailApprovedSchema>;
export type FollowupApproved = z.infer<typeof followupApprovedSchema>;
export type RemindApproved = z.infer<typeof remindApprovedSchema>;
export type SlackApproved = z.infer<typeof slackApprovedSchema>;

export const APPROVED_SCHEMAS = {
  email: emailApprovedSchema,
  followup: followupApprovedSchema,
  remind: remindApprovedSchema,
  slack: slackApprovedSchema,
} as const;

export type ApprovableKind = keyof typeof APPROVED_SCHEMAS;

/** Takes the row's plain string, so no call site needs a cast. */
export function isApprovableKind(kind: string): kind is ApprovableKind {
  return Object.hasOwn(APPROVED_SCHEMAS, kind);
}

/** Comma- or newline-separated addresses from a text field, de-duplicated. */
export function splitAddresses(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,\n;]+/)) {
    const candidate = part.trim().replace(/^<|>$/g, "");
    if (candidate && !seen.has(candidate.toLowerCase())) seen.add(candidate.toLowerCase());
  }
  return [...seen];
}

/**
 * A datetime-local input and an ISO date-time with an offset, kept as the wall-clock
 * time the host said: the input shows the ISO's own hours and minutes, and the ISO
 * going back keeps the ISO's own offset. No timezone conversion, so the server and the
 * browser render the same value and the time stays the one that was spoken.
 */
export function isoToInputValue(iso: string | null): string {
  if (!iso) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]}T${match[2]}` : "";
}

/** The "+05:00" or "Z" an ISO date-time carries, or null when it has none. */
export function offsetOf(iso: string | null): string | null {
  if (!iso) return null;
  return /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1] ?? null;
}

/** The browser's offset at a given wall-clock time, as "+05:00". Client-side only. */
export function browserOffset(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`;
}

export function inputValueToIso(value: string, offset: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  if (!/^([+-]\d{2}:\d{2}|Z)$/.test(offset)) return null;
  const iso = `${value}:00${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
