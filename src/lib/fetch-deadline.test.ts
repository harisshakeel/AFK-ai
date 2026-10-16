import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithDeadline } from "./fetch-deadline";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithDeadline", () => {
  it("gives up on a request that outlasts the deadline", async () => {
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(fetchWithDeadline(20)("https://db.example/rest/v1/x")).rejects.toThrow();
  });

  it("keeps the caller's own signal", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response("ok");
    });
    const controller = new AbortController();
    await fetchWithDeadline(1_000)("https://db.example", { signal: controller.signal });
    controller.abort();
    expect(seen[0]?.aborted).toBe(true);
  });
});
