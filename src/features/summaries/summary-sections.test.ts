import { describe, expect, it } from "vitest";

import { summaryFor } from "./summary-sections";

const item = (
  id: string,
  kind: string,
  templateKey: string | null,
  sectionIdx: number | null,
  section: string | null,
) => ({ id, kind, templateKey, sectionIdx, section, text: id, turnIds: [] });

describe("a summary as the page shows it", () => {
  it("lists the templates the meeting has, picks the one asked for or the first, and groups its points", () => {
    const items = [
      item("p1", "point", "catch_up", 1, "What needs attention"),
      item("p2", "point", "catch_up", 0, "What you missed"),
      item("p3", "point", "general", 0, "Overview"),
      item("a1", "action", null, null, null),
      item("n1", "note", null, null, null),
    ];
    const chosen = summaryFor(items, "general");
    expect(chosen.current?.key).toBe("general");
    expect(chosen.sections).toEqual([{ heading: "Overview", points: [items[2]] }]);
    expect(chosen.notes).toEqual([items[4]]);
    const first = summaryFor(items, null);
    expect(first.available.map((definition) => definition.key)).toEqual(["catch_up", "general"]);
    expect(first.current?.key).toBe("catch_up");
    expect(first.sections.map((section) => section.heading)).toEqual([
      "What you missed",
      "What needs attention",
    ]);
    expect(summaryFor([], "catch_up")).toEqual({
      available: [],
      current: undefined,
      sections: [],
      notes: [],
    });
  });
});
