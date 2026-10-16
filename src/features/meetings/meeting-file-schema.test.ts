import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { meetingFileSchema } from "./meeting-file-schema";

const readMeeting = (id: string) =>
  JSON.parse(readFileSync(`data/meetings/${id}.json`, "utf8")) as unknown;

const base = {
  id: "bad",
  title: "A meeting",
  source: { corpus: "x", session: "x", licence: "x", url: "https://example.com", modified: "" },
  durationSec: 10,
  speakers: [{ code: "a", label: "Speaker A" }],
};

const withTurns = (turns: unknown[], extra: Record<string, unknown> = {}) =>
  meetingFileSchema.safeParse({ ...base, ...extra, turns });

describe("meetingFileSchema", () => {
  it("accepts the long seed meeting as produced by tools/icsi/parse_mrt.py", () => {
    const meeting = meetingFileSchema.parse(readMeeting("bmr007"));
    expect(meeting.title).toBe("Meeting Recorder project meeting");
    expect(meeting.recordedAt).toBe("2000-11-09T14:45:00-08:00");
    expect(meeting.speakers).toHaveLength(8);
    expect(meeting.durationSec).toBeGreaterThan(3500);
    expect(meeting.turns.length).toBeGreaterThan(1000);
  });

  it("accepts every seed meeting, including their overlapping speech", () => {
    const files = readdirSync("data/meetings").filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(5);
    for (const file of files) {
      const meeting = meetingFileSchema.parse(readMeeting(file.replace(".json", "")));
      const overlaps = meeting.turns.filter((turn, i) => {
        const next = meeting.turns[i + 1];
        return next !== undefined && next.startSec < turn.endSec;
      });
      expect(overlaps.length).toBeGreaterThan(0);
    }
  });

  it("rejects a turn that ends before it starts", () => {
    const result = withTurns([{ id: "bad-0", speaker: "a", startSec: 5, endSec: 4, text: "hi" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a turn by an unknown speaker", () => {
    const result = withTurns([{ id: "bad-0", speaker: "zz", startSec: 1, endSec: 2, text: "hi" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a turn that runs past the meeting's length", () => {
    const result = withTurns([{ id: "bad-0", speaker: "a", startSec: 9, endSec: 11, text: "hi" }]);
    expect(result.success).toBe(false);
  });

  it("rejects turns out of start order and duplicate ids", () => {
    const outOfOrder = withTurns([
      { id: "bad-0", speaker: "a", startSec: 5, endSec: 6, text: "hi" },
      { id: "bad-1", speaker: "a", startSec: 1, endSec: 2, text: "hi" },
    ]);
    expect(outOfOrder.success).toBe(false);
    const duplicate = withTurns([
      { id: "bad-0", speaker: "a", startSec: 1, endSec: 2, text: "hi" },
      { id: "bad-0", speaker: "a", startSec: 3, endSec: 4, text: "hi" },
    ]);
    expect(duplicate.success).toBe(false);
  });

  it("requires an ISO 8601 date with an offset, so Postgres reads the right moment", () => {
    const turns = [{ id: "bad-0", speaker: "a", startSec: 1, endSec: 2, text: "hi" }];
    expect(withTurns(turns, { recordedAt: "2000-11-09-1445" }).success).toBe(false);
    expect(withTurns(turns, { recordedAt: "2000-11-09T14:45:00-08:00" }).success).toBe(true);
  });
});
