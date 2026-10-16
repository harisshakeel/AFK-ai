import type { MemoryFileForPrompt } from "../memory/files.ts";
import { profileNames } from "./sender.ts";
import type { EmailArgs } from "./ai-schema.ts";

/**
 * The names an email draft is signed and addressed with (2026-10-16, owner's call: the
 * draft must carry my name, not a placeholder). The skill writes "{my name}" and
 * "{first name}", and the model is told what they mean, but the fill is done here, in
 * code, so a draft never leaves with a placeholder when the name is known.
 */
export function fillNamePlaceholders(
  text: string,
  names: { myName: string | null; firstName: string | null },
): string {
  let out = text;
  if (names.myName) out = out.replace(/\{my name\}|\[(?:your|my) name\]/gi, names.myName);
  if (names.firstName) out = out.replace(/\{first name\}|\[first name\]/gi, names.firstName);
  return out;
}

/** The host's name: the profile's "Name" line, else the first name the meeting was sent under. */
export function hostName(
  files: ReadonlyArray<MemoryFileForPrompt> | null | undefined,
  senderNames: ReadonlyArray<string> | null | undefined,
): string | null {
  const profile = files?.find((file) => file.path === "profile.md")?.content;
  const fromProfile = profileNames(profile)[0]?.trim();
  if (fromProfile) return fromProfile;
  const fromSender = senderNames?.find((name) => name && name.trim().length > 1)?.trim();
  return fromSender ?? null;
}

/** A placeholder for the meeting's link or PIN, as a model writes one: "[add meeting link]", "[link]", "{PIN}". */
const LINK_PLACEHOLDER =
  /\[[^\]\n]*\b(?:link|url)\b[^\]\n]*\]|\{[^}\n]*\b(?:link|url)\b[^}\n]*\}/gi;
const PIN_PLACEHOLDER = /\[[^\]\n]*\bpin\b[^\]\n]*\]|\{[^}\n]*\bpin\b[^}\n]*\}/gi;

export function fillLinkPlaceholders(
  text: string,
  link: { url: string; pin: string } | null,
): string {
  if (!link) return text;
  return text.replace(LINK_PLACEHOLDER, link.url).replace(PIN_PLACEHOLDER, link.pin);
}

/**
 * An email draft with its placeholders filled: the host's name, the first recipient's
 * first name, and the meeting's link and PIN when the link is on.
 */
export function fillEmailNames(
  args: EmailArgs,
  myName: string | null,
  link: { url: string; pin: string } | null = null,
): EmailArgs {
  const firstName = args.toNames[0]?.trim().split(/\s+/)[0] ?? null;
  const names = { myName, firstName: firstName || null };
  return {
    ...args,
    subject: fillNamePlaceholders(args.subject, names),
    body: fillLinkPlaceholders(fillNamePlaceholders(args.body, names), link),
  };
}
