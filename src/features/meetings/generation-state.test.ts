import { describe, expect, it } from "vitest";

import { generationStates, hasPendingWork, needsKick, pendingWorkKey } from "./generation-state";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("generationStates", () => {
  it("reads the latest analyze and summarize jobs, and none when there is none", () => {
    const states = generationStates(
      [
        { kind: "summarize", status: "done", updated_at: ago(1) },
        { kind: "analyze", status: "running", updated_at: ago(1) },
        { kind: "analyze", status: "failed", updated_at: ago(30) },
      ],
      NOW,
    );
    expect(states.map((state) => [state.kind, state.status, state.stale])).toEqual([
      ["analyze", "running", false],
      ["summarize", "done", false],
    ]);
    expect(generationStates([], NOW).map((state) => state.status)).toEqual(["none", "none"]);
  });

  it("counts the notes as queued while the command parse runs", () => {
    const states = generationStates(
      [{ kind: "detect_commands", status: "running", updated_at: ago(1) }],
      NOW,
    );
    expect(states.map((state) => state.status)).toEqual(["queued", "queued"]);
  });

  it("marks a job queued for over fifteen minutes as stale", () => {
    const [fresh] = generationStates(
      [{ kind: "analyze", status: "queued", updated_at: ago(14) }],
      NOW,
    );
    const [held] = generationStates(
      [{ kind: "analyze", status: "queued", updated_at: ago(16) }],
      NOW,
    );
    expect(fresh?.stale).toBe(false);
    expect(held?.stale).toBe(true);
  });

  it("marks a job still running after its lease could have lasted as stale", () => {
    // Every job function lives at most 300 s, and a lease outlives its budget by 60 s.
    const [working] = generationStates(
      [{ kind: "analyze", status: "running", updated_at: ago(4) }],
      NOW,
    );
    const [cutOff] = generationStates(
      [{ kind: "analyze", status: "running", updated_at: ago(7) }],
      NOW,
    );
    expect(working?.stale).toBe(false);
    expect(cutOff?.stale).toBe(true);
  });
});

describe("needsKick", () => {
  it("kicks for a transcribed meeting, a queued job, or a running job cut off mid-run", () => {
    const running = generationStates(
      [{ kind: "analyze", status: "running", updated_at: ago(4) }],
      NOW,
    );
    const cutOff = generationStates(
      [{ kind: "analyze", status: "running", updated_at: ago(7) }],
      NOW,
    );
    const queued = generationStates(
      [{ kind: "summarize", status: "queued", updated_at: ago(0) }],
      NOW,
    );
    expect(needsKick("transcribed", [])).toBe(true);
    expect(needsKick("ready", queued)).toBe(true);
    expect(needsKick("ready", cutOff)).toBe(true);
    // Another function is working on it: left to that one.
    expect(needsKick("ready", running)).toBe(false);
    expect(needsKick("ready", generationStates([], NOW))).toBe(false);
  });
});

describe("hasPendingWork", () => {
  const settled = generationStates(
    [
      { kind: "analyze", status: "done", updated_at: ago(5) },
      { kind: "summarize", status: "done", updated_at: ago(5) },
    ],
    NOW,
  );

  it("is true while the notes are queued or being written", () => {
    const writing = generationStates(
      [{ kind: "summarize", status: "running", updated_at: ago(1) }],
      NOW,
    );
    const queued = generationStates(
      [{ kind: "analyze", status: "queued", updated_at: ago(20) }],
      NOW,
    );
    expect(hasPendingWork(writing, [])).toBe(true);
    expect(hasPendingWork(queued, [])).toBe(true);
  });

  it("is true while a card is being drafted or run, and false once everything has settled", () => {
    expect(hasPendingWork(settled, [{ status: "detected" }])).toBe(true);
    expect(hasPendingWork(settled, [{ status: "approved" }])).toBe(true);
    expect(hasPendingWork(settled, [{ status: "running" }])).toBe(true);
    expect(
      hasPendingWork(settled, [{ status: "proposed" }, { status: "done" }, { status: "failed" }]),
    ).toBe(false);
    expect(hasPendingWork(generationStates([], NOW), [])).toBe(false);
  });
});

describe("pendingWorkKey", () => {
  it("changes when new work starts, so a refresher that gave up starts again", () => {
    const writing = generationStates(
      [{ kind: "summarize", status: "running", updated_at: ago(1) }],
      NOW,
    );
    const before = pendingWorkKey(writing, [{ id: "c1", status: "done" }]);
    const after = pendingWorkKey(writing, [
      { id: "c1", status: "done" },
      { id: "c2", status: "detected" },
    ]);
    expect(after).not.toBe(before);
    expect(pendingWorkKey(writing, [{ id: "c1", status: "done" }])).toBe(before);
  });
});
