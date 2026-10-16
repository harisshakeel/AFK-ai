import { describe, expect, it } from "vitest";

import { recordOf } from "./record";

describe("recordOf", () => {
  it("makes one entry per key, each from its key", () => {
    expect(recordOf(["a", "bb"] as const, (key) => key.length)).toEqual({ a: 1, bb: 2 });
  });
});
