import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { meetingFileSchema } from "@/features/meetings/meeting-file-schema";
import {
  clampTime,
  currentTurnIndex,
  firstMatchAtOrAfter,
  formatDuration,
  formatTime,
  normaliseClip,
  parseTimeParam,
  turnsInClip,
} from "@/lib/time-rules";

const turns = [
  { startSec: 2, endSec: 6 }, // 0
  { startSec: 4, endSec: 5 }, // 1: overlaps 0
  { startSec: 4, endSec: 8 }, // 2: same start as 1
  { startSec: 12, endSec: 14 }, // 3: after a pause
];

describe("currentTurnIndex", () => {
  it("is -1 before anyone has spoken", () => {
    expect(currentTurnIndex(turns, 0)).toBe(-1);
    expect(currentTurnIndex(turns, 1.999)).toBe(-1);
  });

  it("starts a turn exactly at its start, and leaves it exactly at its end", () => {
    expect(currentTurnIndex(turns, 2)).toBe(0);
    expect(currentTurnIndex(turns, 12)).toBe(3);
    expect(currentTurnIndex(turns, 13.999)).toBe(3);
  });

  it("prefers the latest-starting turn during crosstalk, the later one on equal starts", () => {
    expect(currentTurnIndex(turns, 4)).toBe(2);
    expect(currentTurnIndex(turns, 5.5)).toBe(2);
  });

  it("falls back to the earlier turn still speaking when the later one has ended", () => {
    const nested = [
      { startSec: 0, endSec: 10 },
      { startSec: 3, endSec: 4 },
    ];
    expect(currentTurnIndex(nested, 6)).toBe(0);
  });

  it("keeps the last turn that started during a pause and after the end", () => {
    expect(currentTurnIndex(turns, 10)).toBe(2);
    expect(currentTurnIndex(turns, 99)).toBe(3);
  });

  it("agrees with a brute-force reading of the long seed meeting at 2,000 instants", () => {
    const meeting = meetingFileSchema.parse(
      JSON.parse(readFileSync("data/meetings/bmr007.json", "utf8")) as unknown,
    );
    const brute = (sec: number) => {
      let best = -1;
      meeting.turns.forEach((turn, index) => {
        if (turn.startSec <= sec && sec < turn.endSec) best = index;
      });
      if (best >= 0) return best;
      let last = -1;
      meeting.turns.forEach((turn, index) => {
        if (turn.startSec <= sec) last = index;
      });
      return last;
    };
    for (let i = 0; i < 2000; i++) {
      const sec = (meeting.durationSec * i) / 2000;
      expect(currentTurnIndex(meeting.turns, sec)).toBe(brute(sec));
    }
  });
});

describe("clips", () => {
  it("include every turn that overlaps the half-open range, whole", () => {
    expect(turnsInClip(turns, { startSec: 5, endSec: 12 })).toEqual([turns[0], turns[2]]);
    // a turn that starts exactly at the clip's end is outside it
    expect(turnsInClip(turns, { startSec: 8, endSec: 12 })).toEqual([]);
  });

  it("are ordered, at least a second, at most ten minutes, and inside the meeting", () => {
    expect(normaliseClip({ startSec: 30, endSec: 10 }, 100)).toEqual({ startSec: 10, endSec: 30 });
    expect(normaliseClip({ startSec: 50, endSec: 50.2 }, 100)).toEqual({
      startSec: 50,
      endSec: 51,
    });
    expect(normaliseClip({ startSec: 99.8, endSec: 120 }, 100)).toEqual({
      startSec: 99,
      endSec: 100,
    });
    expect(normaliseClip({ startSec: 0, endSec: 2000 }, 3600)).toEqual({
      startSec: 0,
      endSec: 600,
    });
  });
});

describe("time parsing and formatting", () => {
  it("reads seconds, clock times and 1h2m3s", () => {
    expect(parseTimeParam("754")).toBe(754);
    expect(parseTimeParam("754.5")).toBe(754.5);
    expect(parseTimeParam("12:34")).toBe(754);
    expect(parseTimeParam("1:02:03")).toBe(3723);
    expect(parseTimeParam("12m34s")).toBe(754);
    expect(parseTimeParam("1h2m3s")).toBe(3723);
    for (const bad of ["", "abc", "-5", "1:2:3:4", "m", null])
      expect(parseTimeParam(bad)).toBeNull();
  });

  it("clamps to the meeting", () => {
    expect(clampTime(-3, 100)).toBe(0);
    expect(clampTime(250, 100)).toBe(100);
    expect(clampTime(Number.NaN, 100)).toBe(0);
  });

  it("formats clock times and lengths", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(754.9)).toBe("12:34");
    expect(formatTime(3603.1)).toBe("1:00:03");
    expect(formatDuration(3603)).toBe("1 hr");
    expect(formatDuration(2322)).toBe("39 min");
    expect(formatDuration(5400)).toBe("1 hr 30 min");
  });
});

describe("firstMatchAtOrAfter", () => {
  it("rings the first match at or after the current line, wrapping to the first", () => {
    const matches = [3, 10, 42];
    expect(firstMatchAtOrAfter(matches, 0)).toBe(0);
    expect(firstMatchAtOrAfter(matches, 3)).toBe(0);
    expect(firstMatchAtOrAfter(matches, 4)).toBe(1);
    expect(firstMatchAtOrAfter(matches, 42)).toBe(2);
    expect(firstMatchAtOrAfter(matches, 43)).toBe(0);
    expect(firstMatchAtOrAfter(matches, -1)).toBe(0);
  });

  it("is -1 without matches", () => {
    expect(firstMatchAtOrAfter([], 5)).toBe(-1);
  });
});
