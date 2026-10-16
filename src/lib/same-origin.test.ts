import { describe, expect, it } from "vitest";

import { isCrossSiteWrite } from "./same-origin";

const ORIGIN = "https://afk.example";
const headers = (values: Record<string, string>) => new Headers(values);

describe("isCrossSiteWrite", () => {
  it("lets this site's own writes and every read through", () => {
    expect(isCrossSiteWrite("POST", headers({ "sec-fetch-site": "same-origin" }), ORIGIN)).toBe(
      false,
    );
    expect(isCrossSiteWrite("DELETE", headers({ origin: ORIGIN }), ORIGIN)).toBe(false);
    expect(isCrossSiteWrite("GET", headers({ "sec-fetch-site": "cross-site" }), ORIGIN)).toBe(
      false,
    );
  });

  it("refuses a write another site's page sent", () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(isCrossSiteWrite("POST", headers({ "sec-fetch-site": site }), ORIGIN), site).toBe(
        true,
      );
    }
    expect(isCrossSiteWrite("POST", headers({ origin: "https://evil.example" }), ORIGIN)).toBe(
      true,
    );
    expect(isCrossSiteWrite("PUT", headers({ origin: "null" }), ORIGIN)).toBe(true);
  });

  it("lets a caller that is not a browser through to its own checks", () => {
    expect(isCrossSiteWrite("POST", headers({ authorization: "Bearer x" }), ORIGIN)).toBe(false);
  });
});
