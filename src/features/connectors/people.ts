import { z } from "zod";

import { EMAIL_ADDRESS } from "./gmail.ts";

/**
 * Google's People API, read-only (requirement: contacts): the host's saved
 * contacts (people/me/connections) and the people Google lists from who they write to
 * ("other contacts", the names its own address box completes). Names and addresses
 * only; nothing else is asked for, nothing is written. Paged up to a cap; the host
 * imports again when they want more.
 */
export const PEOPLE_API = "https://people.googleapis.com/v1";
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;

export class PeopleError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PeopleError";
    this.status = status;
  }
}

export type Person = { name: string; email: string };

const personSchema = z.object({
  names: z.array(z.object({ displayName: z.string().optional() })).optional(),
  emailAddresses: z.array(z.object({ value: z.string().optional() })).optional(),
});
const pageSchema = z.object({
  connections: z.array(personSchema).optional(),
  otherContacts: z.array(personSchema).optional(),
  nextPageToken: z.string().optional(),
});

/** Every (name, address) a page holds, one per address, addresses lower-cased. */
function peopleIn(rows: ReadonlyArray<z.infer<typeof personSchema>>): Person[] {
  const people: Person[] = [];
  for (const row of rows) {
    const name = row.names?.find((candidate) => candidate.displayName?.trim())?.displayName?.trim();
    for (const address of row.emailAddresses ?? []) {
      const email = address.value?.trim().toLowerCase();
      if (!email || !EMAIL_ADDRESS.test(email)) continue;
      people.push({ name: name ?? email.split("@")[0]!, email });
    }
  }
  return people;
}

async function listPages(
  url: URL,
  listKey: "connections" | "otherContacts",
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<Person[]> {
  const people: Person[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const target = new URL(url);
    if (pageToken) target.searchParams.set("pageToken", pageToken);
    const response = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new PeopleError(`Google People API answered ${response.status}`, response.status);
    const parsed = pageSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new PeopleError("Google People API answered in an unexpected shape", 502);
    people.push(...peopleIn(parsed.data[listKey] ?? []));
    pageToken = parsed.data.nextPageToken;
    if (!pageToken) break;
  }
  return people;
}

/** The host's saved contacts. Needs contacts.readonly. */
export function listSavedContacts(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const url = new URL(`${PEOPLE_API}/people/me/connections`);
  url.searchParams.set("personFields", "names,emailAddresses");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("sortOrder", "LAST_MODIFIED_DESCENDING");
  return listPages(url, "connections", accessToken, fetchImpl);
}

/** The people the host writes to without saving them. Needs contacts.other.readonly. */
export function listOtherContacts(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const url = new URL(`${PEOPLE_API}/otherContacts`);
  url.searchParams.set("readMask", "names,emailAddresses");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  return listPages(url, "otherContacts", accessToken, fetchImpl);
}
