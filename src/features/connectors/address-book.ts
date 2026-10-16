import { normaliseWords as normalise } from "../../lib/words.ts";
import { splitZones } from "../memory/files.ts";
import { EMAIL_ADDRESS } from "./gmail.ts";

/**
 * Who AFK can address (decision 11: addresses come from the host's own text, from what
 * the host confirmed and from the host's own calendar, never scraped from guests). The
 * sources merge into one book:
 *
 *   - the host's people file, a line like "- Sam Lee: designer on Atlas, sam@example.com"
 *     or "- Sam <sam@example.com>", read on every page as the host wrote it: the host's
 *     own zone only, never "Learned by AFK", whose lines carry what anyone on a call
 *     said and the meeting's title (which a stranger's invite chooses);
 *   - the contacts the host taught AFK: every recipient confirmed on a card (with the
 *     name AFK heard for it), and, when imported, Google's own contacts and the people
 *     the host writes to, and (2026-10-16) the people on the calendar invite of every
 *     meeting AFK is sent to. Each carries its source, how often it was used and when,
 *     and the other names the host has called that person.
 *
 * A spoken "Sam" becomes a best guess with its reason, never a silent fill: the card
 * shows the guess, the reason and the other matches, and the host confirms.
 */
export type AddressSource =
  "people_file" | "approval" | "calendar" | "google_contacts" | "google_other";

export type AddressEntry = {
  name: string;
  email: string;
  source: AddressSource;
  aliases?: string[];
  uses?: number;
  lastUsedAt?: string | null;
};

/** One heard name, resolved: the best address with why, and how many others matched. */
export type Suggestion = {
  name: string;
  email: string | null;
  reason: string | null;
  /** The other matches, best first, so the host can swap one in. */
  alternatives: Array<{ email: string; reason: string }>;
};

const EMAIL_IN_TEXT = /[^\s<>@,;:"()[\]\\]+@[^\s<>@,;:"()[\]\\]+\.[^\s<>@,;:"()[\]\\]+/g;

export function parseAddressBook(markdown: string): AddressEntry[] {
  const entries: AddressEntry[] = [];
  for (const rawLine of splitZones(markdown).user.split("\n")) {
    const line = rawLine.replace(/^\s*[-*]\s*/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const emails = (line.match(EMAIL_IN_TEXT) ?? []).filter((email) => EMAIL_ADDRESS.test(email));
    if (emails.length === 0) continue;
    const name = line
      .split(/[:(,<–—]| - /)[0]!
      .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    for (const email of emails) {
      entries.push({
        name: name && !name.includes("@") ? name : email.split("@")[0]!,
        email: email.toLowerCase(),
        source: "people_file",
      });
    }
  }
  return entries;
}

/** The file first (the host wrote it), then the most used, then the most recent. */
const SOURCE_RANK: Record<AddressSource, number> = {
  people_file: 0,
  approval: 1,
  calendar: 2,
  google_contacts: 3,
  google_other: 4,
};

function rank(a: AddressEntry, b: AddressEntry): number {
  return (
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
    (b.uses ?? 0) - (a.uses ?? 0) ||
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "")
  );
}

/** Whether a heard name names this entry: whole words of its name or any alias. */
function matches(needle: string, entry: AddressEntry): boolean {
  const names = [entry.name, ...(entry.aliases ?? [])].map(normalise);
  return names.some((name) => name === needle || ` ${name} `.includes(` ${needle} `));
}

export function reasonFor(entry: AddressEntry): string {
  switch (entry.source) {
    case "people_file":
      return "from your People file";
    case "approval": {
      const uses = entry.uses ?? 0;
      const last = entry.lastUsedAt ? `, last ${shortDate(entry.lastUsedAt)}` : "";
      return uses > 0 ? `used ${uses} ${uses === 1 ? "time" : "times"}${last}` : "confirmed before";
    }
    case "calendar":
      return "on a calendar invite with you";
    case "google_contacts":
      return "from your Google contacts";
    case "google_other":
      return "someone you've written to";
  }
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

/** The best guess per heard name, with its reason and the other matches. */
export function suggestRecipients(
  names: ReadonlyArray<string>,
  book: ReadonlyArray<AddressEntry>,
): Suggestion[] {
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  for (const name of names) {
    const needle = normalise(name);
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    const found = book.filter((entry) => matches(needle, entry)).sort(rank);
    // One address once, whatever names it was found under.
    const unique = found.filter(
      (entry, index) => found.findIndex((other) => other.email === entry.email) === index,
    );
    const [best, ...rest] = unique;
    suggestions.push({
      name,
      email: best?.email ?? null,
      reason: best ? reasonFor(best) : null,
      alternatives: rest
        .slice(0, 3)
        .map((entry) => ({ email: entry.email, reason: reasonFor(entry) })),
    });
  }
  return suggestions;
}

/**
 * The addresses said in the call put first: paired with the heard name they belong to
 * (the local part holds the name's first word), the book's guess kept as an alternative;
 * an address matching no heard name stands on its own.
 */
export function withSaidAddresses(
  suggestions: ReadonlyArray<Suggestion>,
  said: ReadonlyArray<string>,
): Suggestion[] {
  const result = suggestions.map((suggestion) => ({
    ...suggestion,
    alternatives: [...suggestion.alternatives],
  }));
  const own: Suggestion[] = [];
  for (const raw of said) {
    const email = raw.trim().toLowerCase();
    if (!email.includes("@")) continue;
    const local = normalise(email.split("@")[0] ?? "").replace(/\s+/g, "");
    const match = result.find((suggestion) => {
      const first = normalise(suggestion.name).split(" ")[0] ?? "";
      return first.length >= 2 && local.includes(first);
    });
    if (!match) {
      own.push({ name: email, email, reason: "said in the call", alternatives: [] });
      continue;
    }
    if (match.email && match.email !== email) {
      match.alternatives.unshift({ email: match.email, reason: match.reason ?? "known" });
    }
    match.email = email;
    match.reason = "said in the call";
    match.alternatives = match.alternatives.filter((alternative) => alternative.email !== email);
  }
  return [...own, ...result];
}

/** The addresses to pre-fill: the best guess of every resolved name, in order. */
export function suggestedAddresses(suggestions: ReadonlyArray<Suggestion>): string[] {
  const emails: string[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.email && !emails.includes(suggestion.email)) emails.push(suggestion.email);
  }
  return emails;
}

const EVERYONE =
  /\b(everyone|everybody|all of us|the (?:whole |entire )?(?:team|group)|all attendees)\b/i;

/**
 * "Invite everyone" means the people on the call: the heard names plus every speaker but
 * the host. The transcript names them; the book may know their addresses.
 */
export function expandEveryone(
  sentence: string,
  names: ReadonlyArray<string>,
  speakers: ReadonlyArray<string>,
  hostLabel: string | null,
): string[] {
  const out = [...names];
  if (!EVERYONE.test(sentence)) return out;
  const host = hostLabel ? normalise(hostLabel) : "";
  for (const speaker of speakers) {
    const label = speaker.replace(/\s\(\d+\)$/, "");
    if (!label || normalise(label) === host) continue;
    if (!out.some((name) => normalise(name) === normalise(label))) out.push(label);
  }
  return out;
}

/**
 * What a confirmed card teaches: each address the host approved, with the heard name it
 * stands for when that is clear (one name and one address, or a name whose words are in
 * the address), else with no name, so learn_contacts() names it after the address.
 */
export function pairNamesWithAddresses(
  names: ReadonlyArray<string>,
  addresses: ReadonlyArray<string>,
): Array<{ name: string | null; email: string }> {
  const unique = [...new Set(addresses.map((address) => address.trim().toLowerCase()))].filter(
    (address) => EMAIL_ADDRESS.test(address),
  );
  const cleanNames = names.map((name) => name.trim()).filter(Boolean);
  if (unique.length === 1 && cleanNames.length === 1) {
    return [{ name: cleanNames[0]!, email: unique[0]! }];
  }
  return unique.map((email) => {
    const local = normalise(email.split("@")[0]!.replace(/[._-]+/g, " "));
    const name = cleanNames.find((candidate) => {
      const words = normalise(candidate)
        .split(" ")
        .filter((word) => word.length > 1);
      return words.length > 0 && words.every((word) => ` ${local} `.includes(` ${word} `));
    });
    return { name: name ?? null, email };
  });
}
