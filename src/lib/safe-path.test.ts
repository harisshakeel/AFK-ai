import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-path";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNextPath("/dashboard", "/")).toBe("/dashboard");
    expect(safeNextPath("/meetings/bmr007?t=120&tab=tasks", "/")).toBe(
      "/meetings/bmr007?t=120&tab=tasks",
    );
  });

  it("gives the fallback for anything that could leave the site", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "dashboard",
      "/ space",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(value, "/fallback"), String(value)).toBe("/fallback");
    }
  });
});
