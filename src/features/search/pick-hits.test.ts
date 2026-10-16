import { describe, expect, it } from "vitest";

import { pickHits } from "./pick-hits";

const hit = (kind: string, id: number) => ({ kind, id });

describe("pickHits", () => {
  it("keeps spoken lines visible when notes outrank them", () => {
    const hits = [
      hit("point", 1),
      hit("point", 2),
      hit("action", 3),
      hit("decision", 4),
      hit("point", 5),
      hit("turn", 6),
      hit("turn", 7),
      hit("turn", 8),
      hit("turn", 9),
    ];
    expect(pickHits(hits, 5).map((h) => h.id)).toEqual([1, 2, 6, 7, 8]);
  });

  it("fills with notes when there are few spoken lines, and the reverse", () => {
    const mostlyNotes = [hit("point", 1), hit("point", 2), hit("action", 3), hit("turn", 4)];
    expect(pickHits(mostlyNotes, 5).map((h) => h.id)).toEqual([1, 2, 3, 4]);
    const mostlySpoken = [hit("turn", 1), hit("turn", 2), hit("turn", 3), hit("turn", 4)];
    expect(pickHits(mostlySpoken, 3).map((h) => h.id)).toEqual([1, 2, 3]);
  });

  it("never exceeds the limit and keeps rank order", () => {
    const hits = Array.from({ length: 12 }, (_, i) => hit(i % 3 === 0 ? "turn" : "point", i));
    const picked = pickHits(hits, 5);
    expect(picked).toHaveLength(5);
    expect(picked.map((h) => h.id)).toEqual([...picked.map((h) => h.id)].sort((a, b) => a - b));
  });
});
