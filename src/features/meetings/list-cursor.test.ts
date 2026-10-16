import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./list-cursor";

describe("list cursor", () => {
  it("round-trips a sort key through a URL-safe string", () => {
    const cursor = {
      recordedAt: "2000-11-09T18:00:00.000+00:00",
      createdAt: "2026-10-20T10:00:00.123+00:00",
      id: "bmr007",
    };
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
    expect(decodeCursor(encodeCursor({ ...cursor, recordedAt: null }))).toEqual({
      ...cursor,
      recordedAt: null,
    });
  });

  it("treats anything malformed as the first page", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not base64!")).toBeNull();
    expect(decodeCursor(btoa('{"id":"x"}'))).toBeNull();
    expect(decodeCursor(btoa('{"recordedAt":null,"createdAt":"soon","id":"bmr007"}'))).toBeNull();
    expect(decodeCursor("A".repeat(400))).toBeNull();
    expect(decodeCursor(["b", "c"])).toBeNull();
  });
});
