import { describe, expect, it } from "vitest";

import {
  afkRecord,
  isoWeek,
  levelFor,
  streakFor,
  weeksBack,
  xpFor,
  type Call,
  type RecordInput,
} from "./afk-record";

const NOW = new Date("2026-10-22T10:00:00Z");
const call = (week: string, sec: number, title = "Call"): Call => ({
  id: `${week}-${sec}`,
  title,
  sec,
  week,
});

const empty: RecordInput = {
  meetings: 0,
  calls: [],
  decisions: 0,
  actions: 0,
  doneActions: 0,
  spokenCommands: 0,
  typedCommands: 0,
  doneCommands: 0,
  awaitingApproval: 0,
  highlights: 0,
  now: NOW,
};

describe("XP and levels", () => {
  it("starts a new user as a Lurker with nothing to show", () => {
    const record = afkRecord(empty);
    expect(record.xp).toBe(0);
    expect(record.level.name).toBe("Lurker");
    expect(record.level.nextAt).toBe(100);
    expect(record.unlocked).toBe(0);
    expect(record.badges.every((badge) => !badge.unlocked)).toBe(true);
    expect(record.weekly).toHaveLength(12);
    expect(record.weekly.every((point) => point.calls === 0)).toBe(true);
    expect(record.recentWeeks).toEqual(Array(8).fill(false));
    expect(record.longest).toEqual([]);
  });

  it("counts every kind of row at its rate", () => {
    const xp = xpFor({
      ...empty,
      meetings: 2,
      calls: [call("2026-W43", 125 * 60 + 30)],
      decisions: 3,
      actions: 4,
      spokenCommands: 1,
      typedCommands: 1,
      doneCommands: 1,
      highlights: 2,
    });
    expect(xp).toBe(100 + 125 + 30 + 20 + 30 + 25 + 10);
  });

  it("places XP in the level it belongs to, with progress to the next", () => {
    expect(levelFor(0)).toMatchObject({ name: "Lurker", progress: 0 });
    expect(levelFor(99)).toMatchObject({ name: "Lurker" });
    expect(levelFor(100)).toMatchObject({ name: "Attendee", from: 100, nextAt: 300 });
    expect(levelFor(200).progress).toBeCloseTo(0.5);
    expect(levelFor(5000)).toMatchObject({ name: "AFK Legend", nextAt: null, progress: 1 });
  });
});

describe("weeks and streaks", () => {
  it("names ISO weeks, with the year rolling over correctly", () => {
    expect(isoWeek(new Date("2026-10-22T10:00:00Z"))).toBe("2026-W43");
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("lists the last weeks oldest first, ending with this one", () => {
    expect(weeksBack(NOW, 3)).toEqual(["2026-W41", "2026-W42", "2026-W43"]);
    expect(weeksBack(new Date("2026-01-05T00:00:00Z"), 2)).toEqual(["2026-W01", "2026-W02"]);
  });

  it("counts consecutive weeks back from this week", () => {
    expect(streakFor([call("2026-W43", 1), call("2026-W42", 1), call("2026-W41", 1)], NOW)).toBe(3);
    expect(streakFor([call("2026-W43", 1), call("2026-W41", 1)], NOW)).toBe(1);
    expect(streakFor([], NOW)).toBe(0);
  });

  it("does not break on a week that has no call yet", () => {
    const monday = new Date("2026-10-19T08:00:00Z");
    expect(streakFor([call("2026-W42", 1), call("2026-W41", 1)], monday)).toBe(2);
    expect(streakFor([call("2026-W40", 1)], monday)).toBe(0);
  });
});

describe("the charts' series", () => {
  it("sums calls and seconds per week and marks the current week", () => {
    const record = afkRecord({
      ...empty,
      meetings: 3,
      calls: [call("2026-W43", 600), call("2026-W43", 300), call("2026-W37", 1200)],
    });
    const last = record.weekly[record.weekly.length - 1]!;
    expect(last).toEqual({ week: "2026-W43", calls: 2, sec: 900, current: true });
    expect(record.weekly.find((point) => point.week === "2026-W37")).toMatchObject({
      calls: 1,
      sec: 1200,
      current: false,
    });
    // Eight weeks back from W43 start at W36, so W37 is the second dot.
    expect(record.recentWeeks).toEqual([false, true, false, false, false, false, false, true]);
    expect(record.longest.map((item) => item.sec)).toEqual([1200, 600, 300]);
    expect(record.recordedSec).toBe(2100);
  });
});

describe("badges", () => {
  it("unlocks on the exact threshold and shows progress before it", () => {
    const record = afkRecord({
      ...empty,
      meetings: 1,
      calls: [call("2026-W43", 3599), call("2026-W42", 60), call("2026-W41", 60)],
      actions: 4,
      decisions: 10,
      spokenCommands: 1,
    });
    const byId = Object.fromEntries(record.badges.map((badge) => [badge.id, badge]));
    expect(byId["first-seat"]).toMatchObject({ unlocked: true, have: 1, need: 1 });
    expect(byId.marathon).toMatchObject({ unlocked: false, have: 3599, need: 3600 });
    expect(byId.delegator).toMatchObject({ unlocked: false, have: 4, need: 10 });
    expect(byId.receipts?.unlocked).toBe(true);
    expect(byId["magic-word"]?.unlocked).toBe(true);
    expect(byId.habit).toMatchObject({ unlocked: true, have: 3 });
    expect(record.unlocked).toBe(4);
  });
});
