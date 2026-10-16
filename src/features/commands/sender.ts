/**
 * Who AFK listens to: the person who sent it, and nobody else (owner's decision).
 * The meeting platform's "host" flag marks whoever organised the call,
 * which is not the same person, so it carries no authority here.
 *
 * The sender is found among the speakers by the names they are known by: the name on
 * their AFK account, the "Name" and "Name in calls" lines of their profile. A speaker
 * matches when one name is contained in the other, token by token, so "Haris" matches
 * "Haris Shakeel" and "Haris Shakeel" matches "Muhammad Haris Shakeel". When no name
 * matches and only one person spoke in the sender's own meeting, that person is the
 * sender. Two matching speakers is a tie, and a tie is nobody: AFK would rather take no
 * orders than a stranger's.
 */
export type SenderMatch = { code: string; by: "name" | "only" };

/** Lower case, no accents or punctuation, one space between words, Meet's "(2)" dropped; letters of any script kept. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(\d+\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The sender's names, cleaned and deduplicated; blanks and one-letter names dropped. */
export function senderNames(parts: ReadonlyArray<string | null | undefined>): string[] {
  const names = new Set<string>();
  for (const part of parts) {
    const name = part ? normalizeName(part) : "";
    if (name.length >= 2) names.add(name);
  }
  return [...names];
}

const tokens = (name: string) => name.split(" ").filter((token) => token.length >= 2);

/** Whether a speaker's label is one of the sender's names, or one contains the other. */
export function matchesSender(label: string, names: ReadonlyArray<string>): boolean {
  const mine = tokens(normalizeName(label));
  if (mine.length === 0) return false;
  return names.some((name) => {
    const theirs = tokens(name);
    if (theirs.length === 0) return false;
    const [shorter, longer] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
    return shorter.every((token) => longer.includes(token));
  });
}

/**
 * The sender among the speakers: the one whose label matches a name, else the only
 * speaker there is, else nobody. A tie between two matching speakers is nobody.
 */
export function findSender(
  speakers: ReadonlyArray<{ code: string; label: string }>,
  names: ReadonlyArray<string>,
): SenderMatch | null {
  const matched = speakers.filter((speaker) => matchesSender(speaker.label, names));
  if (matched.length === 1) return { code: matched[0]!.code, by: "name" };
  if (matched.length === 0 && speakers.length === 1) return { code: speakers[0]!.code, by: "only" };
  return null;
}

/** The "Name" and "Name in calls" lines of profile.md, as written. */
export function profileNames(profile: string | null | undefined): string[] {
  if (!profile) return [];
  const names: string[] = [];
  for (const line of profile.split("\n")) {
    const match = /^\s*-\s*Name(?: in calls)?\s*:\s*(.+?)\s*$/i.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}
