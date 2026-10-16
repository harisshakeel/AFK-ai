import { describe, expect, it } from "vitest";

import { isTypedCommandCap } from "./typed-cap";

describe("isTypedCommandCap", () => {
  it("knows the database's refusal of a 21st typed command by its SQLSTATE and message", () => {
    expect(
      isTypedCommandCap({ code: "23514", message: "at most 20 typed commands a meeting" }),
    ).toBe(true);
  });

  it("is false for PostgreSQL's condition name, which PostgREST never sends as the code", () => {
    expect(
      isTypedCommandCap({
        code: "check_violation",
        message: "at most 20 typed commands a meeting",
      }),
    ).toBe(false);
  });

  it("is false for the other caps and for any other check", () => {
    expect(
      isTypedCommandCap({ code: "23514", message: "at most 20 spoken commands a meeting" }),
    ).toBe(false);
    expect(
      isTypedCommandCap({ code: "23514", message: "at most 20 skipped commands a meeting" }),
    ).toBe(false);
    expect(
      isTypedCommandCap({ code: "23514", message: 'new row violates check constraint "x"' }),
    ).toBe(false);
  });
});
