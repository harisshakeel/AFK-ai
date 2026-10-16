import { describe, expect, it } from "vitest";

import { listOtherContacts, listSavedContacts, PeopleError } from "./people";

/** A People API that answers two pages for connections and one for other contacts. */
function fakePeople() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    calls.push(target.pathname + (target.searchParams.get("pageToken") ? "?page2" : ""));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    if (target.pathname.endsWith("/connections")) {
      const second = target.searchParams.get("pageToken") === "p2";
      return Response.json(
        second
          ? {
              connections: [
                {
                  names: [{ displayName: "Lee Chan" }],
                  emailAddresses: [{ value: "Lee@Acme.io" }],
                },
              ],
            }
          : {
              connections: [
                {
                  names: [{ displayName: "Sam Lee" }],
                  emailAddresses: [{ value: "sam@example.com" }, { value: "sam.lee@corp.com" }],
                },
                { names: [], emailAddresses: [{ value: "noname@example.com" }] },
                {
                  names: [{ displayName: "Nobody" }],
                  emailAddresses: [{ value: "not an address" }],
                },
              ],
              nextPageToken: "p2",
            },
      );
    }
    return Response.json({
      otherContacts: [
        { names: [{ displayName: "Tess" }], emailAddresses: [{ value: "tess@corp.com" }] },
      ],
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("Google People API", () => {
  it("lists saved contacts across pages, one person per address, skipping bad ones", async () => {
    const { fetchImpl, calls } = fakePeople();
    expect(await listSavedContacts("tok", fetchImpl)).toEqual([
      { name: "Sam Lee", email: "sam@example.com" },
      { name: "Sam Lee", email: "sam.lee@corp.com" },
      { name: "noname", email: "noname@example.com" },
      { name: "Lee Chan", email: "lee@acme.io" },
    ]);
    expect(calls).toEqual(["/v1/people/me/connections", "/v1/people/me/connections?page2"]);
  });

  it("lists the other contacts, and fails loudly on a refusal", async () => {
    const { fetchImpl } = fakePeople();
    expect(await listOtherContacts("tok", fetchImpl)).toEqual([
      { name: "Tess", email: "tess@corp.com" },
    ]);
    const refused = (async () => new Response("no", { status: 403 })) as typeof fetch;
    await expect(listSavedContacts("tok", refused)).rejects.toBeInstanceOf(PeopleError);
  });
});
