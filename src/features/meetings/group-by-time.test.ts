import { describe, expect, it } from "vitest";

import { groupByTime, periodLabel } from "./group-by-time";

describe("group by time", () => {
  // Days are counted in the meeting zone (America/Los_Angeles: -07:00 in October, -08:00 from 1 November), the
  // zone the dates are printed in, whatever the machine running this is set to.
  const now = new Date("2026-11-03T20:00:00-08:00");

  it("names the period a date falls in, relative to now", () => {
    expect(periodLabel(new Date("2026-11-03T09:00:00-08:00"), now)).toBe("Today");
    expect(periodLabel(new Date("2026-11-02T23:00:00-08:00"), now)).toBe("Yesterday");
    expect(periodLabel(new Date("2026-10-29T00:00:00-07:00"), now)).toBe("This week");
    expect(periodLabel(new Date("2026-10-27T00:00:00-07:00"), now)).toBe("October");
    expect(periodLabel(new Date("2026-11-04T00:00:00-08:00"), now)).toBe("Upcoming");
    expect(periodLabel(new Date("2000-11-09T14:45:00-08:00"), now)).toBe("November 2000");
    // Just past midnight UTC is still the evening before in the meeting zone.
    expect(periodLabel(new Date("2026-11-04T01:00:00Z"), now)).toBe("Today");
  });

  it("keeps the list's order and merges neighbours in the same period", () => {
    const groups = groupByTime(
      [
        { id: "a", at: "2026-11-03T10:00:00-08:00" },
        { id: "b", at: "2026-11-03T08:00:00-08:00" },
        { id: "c", at: "2026-10-30T08:00:00-07:00" },
        { id: "d", at: null },
      ],
      (item) => item.at,
      now,
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["This week", ["c"]],
      ["Undated", ["d"]],
    ]);
  });
});
