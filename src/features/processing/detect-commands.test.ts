import { describe, expect, it } from "vitest";

import type { Db, ProcessingDeps } from "./config";
import { runDetectCommands } from "./detect-commands";
import type { Job } from "./jobs";

type Row = Record<string, unknown>;

/**
 * A database of a few tables in memory: select, eq, in, order, limit, range and
 * maybeSingle, enough for the parse's reads. Writes never happen in the handler.
 */
function memoryDb(tables: Record<string, Row[]>): Db {
  const query = (rows: Row[]) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => query(rows.filter((row) => row[field] === value)),
      in: (field: string, values: unknown[]) =>
        query(rows.filter((row) => values.includes(row[field]))),
      limit: (count: number) => query(rows.slice(0, count)),
      range: (from: number, to: number) => query(rows.slice(from, to + 1)),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  };
  return {
    from: (table: string) => query(tables[table] ?? []),
    rpc: async (fn: string) =>
      fn === "is_guest"
        ? { data: false, error: null }
        : { data: null, error: { message: `no ${fn}` } },
  } as unknown as Db;
}

const OWNER = "00000000-0000-4000-8000-000000000003";
const EMAIL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TYPED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** A finished meeting whose notes are written, with the host's commands already recorded. */
function finishedMeeting(commands: Row[]) {
  return memoryDb({
    meetings: [
      {
        id: "m1",
        owner_id: OWNER,
        title: "Launch planning",
        recorded_at: "2026-10-21T10:00:00Z",
        duration_sec: 60,
        transcript_hash: "h",
        status: "ready",
        bot_id: null,
        sender_names: ["Haris"],
        analyzed_at: "2026-10-21T11:00:00Z",
        summarized_at: "2026-10-21T11:00:00Z",
      },
    ],
    meeting_speakers: [
      { meeting_id: "m1", code: "a", label: "Haris", is_host: false },
      { meeting_id: "m1", code: "b", label: "Sam", is_host: false },
    ],
    transcript_turns: [
      {
        meeting_id: "m1",
        id: "m1-0000",
        speaker_code: "a",
        start_sec: 0,
        end_sec: 5,
        text: "AFK, draft an email to Sam about the launch plan.",
      },
      {
        meeting_id: "m1",
        id: "m1-0001",
        speaker_code: "b",
        start_sec: 5,
        end_sec: 8,
        text: "Sure.",
      },
      {
        meeting_id: "m1",
        id: "m1-0002",
        speaker_code: "a",
        start_sec: 8,
        end_sec: 14,
        text: "AFK, task for Sam: send the deck by Friday.",
      },
    ],
    meeting_commands: commands.map((command) => ({ meeting_id: "m1", ...command })),
    memory_files: [],
  });
}

function deps(db: Db) {
  const asked: string[] = [];
  const value: ProcessingDeps = {
    db,
    config: {
      workerId: "test",
      attendee: null,
      connectorTokenKey: null,
      google: null,
      siteUrl: "https://afk.example",
    },
    claude: {
      // Nothing understood: every command the model sees comes back unparsed.
      runStructured: async (input: { extra?: string }) => {
        asked.push(input.extra ?? "");
        return {
          data: { commands: [] },
          run: {
            model: "test",
            durationMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            costUsd: null,
          },
        };
      },
    } as unknown as ProcessingDeps["claude"],
    log: () => {},
  };
  return { deps: value, asked };
}

const job = { id: "j1", meeting_id: "m1", kind: "detect_commands" } as unknown as Job;

type Payload = {
  queueGeneration: boolean;
  commands: Array<{ id?: string; turnId: string | null; source: string; kind: string }>;
};

describe("runDetectCommands on a later pass", () => {
  it("re-parses a spoken draft sent back with a note, by its id, and nothing already recorded", async () => {
    const db = finishedMeeting([
      {
        id: EMAIL_ID,
        source: "spoken",
        kind: "email",
        status: "detected",
        turn_id: "m1-0000",
        sentence: "AFK, draft an email to Sam about the launch plan.",
        args: {
          toNames: ["Sam"],
          subject: "Launch",
          body: "…",
          rewriteNote: "shorter, and add the date",
        },
      },
      {
        id: TASK_ID,
        source: "spoken",
        kind: "task",
        status: "applied",
        turn_id: "m1-0002",
        sentence: "AFK, task for Sam: send the deck by Friday.",
        args: { text: "Send the deck" },
      },
    ]);
    const { deps: run, asked } = deps(db);
    const result = await runDetectCommands(run, job);
    const payload = result?.payload as unknown as Payload;

    // The model sees the draft once, under its own id, with the host's note.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`id: ${EMAIL_ID}`);
    expect(asked[0]).toContain("host's note on the last draft: shorter, and add the date");
    expect(asked[0]).not.toContain("id: m1-0000");
    // The task was applied on the first pass: not parsed (or paid for) again.
    expect(asked[0]).not.toContain("id: m1-0002");

    // apply_commands() updates the detected row by id; nothing is inserted beside it.
    expect(payload.commands).toEqual([
      expect.objectContaining({ id: EMAIL_ID, turnId: "m1-0000", source: "spoken", kind: "email" }),
    ]);
    expect(payload.queueGeneration).toBe(false);
  });

  it("parses a typed draft without sending the recorded spoken ones again", async () => {
    const db = finishedMeeting([
      {
        id: EMAIL_ID,
        source: "spoken",
        kind: "email",
        status: "proposed",
        turn_id: "m1-0000",
        sentence: "AFK, draft an email to Sam about the launch plan.",
        args: {},
      },
      {
        id: TASK_ID,
        source: "spoken",
        kind: "task",
        status: "applied",
        turn_id: "m1-0002",
        sentence: "AFK, task for Sam: send the deck by Friday.",
        args: {},
      },
      {
        id: TYPED_ID,
        source: "typed",
        kind: "email",
        status: "detected",
        turn_id: null,
        sentence: "/email Sam the recap",
        args: {},
      },
    ]);
    const { deps: run, asked } = deps(db);
    const result = await runDetectCommands(run, job);
    const payload = result?.payload as unknown as Payload;
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`id: ${TYPED_ID}`);
    expect(asked[0]).not.toContain("id: m1-0000");
    expect(asked[0]).not.toContain("id: m1-0002");
    expect(payload.commands).toEqual([
      expect.objectContaining({ id: TYPED_ID, source: "typed", kind: "email" }),
    ]);
  });

  it("makes no Claude call when every spoken command is recorded and nothing waits", async () => {
    const db = finishedMeeting([
      {
        id: EMAIL_ID,
        source: "spoken",
        kind: "email",
        status: "proposed",
        turn_id: "m1-0000",
        sentence: "AFK, draft an email to Sam about the launch plan.",
        args: {},
      },
      {
        id: TASK_ID,
        source: "spoken",
        kind: "task",
        status: "applied",
        turn_id: "m1-0002",
        sentence: "AFK, task for Sam: send the deck by Friday.",
        args: {},
      },
    ]);
    const { deps: run, asked } = deps(db);
    const result = await runDetectCommands(run, job);
    expect(asked).toEqual([]);
    expect((result?.payload as unknown as Payload).commands).toEqual([]);
  });
});

describe("runDetectCommands on the first pass", () => {
  it("sends every spoken command that needs the model, keyed by its turn", async () => {
    const db = finishedMeeting([]);
    const { deps: run, asked } = deps(db);
    await runDetectCommands(run, job);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("id: m1-0000");
    expect(asked[0]).toContain("id: m1-0002");
  });
});
