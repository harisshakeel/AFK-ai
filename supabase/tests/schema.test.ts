import { readFileSync } from "node:fs";

import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { isTypedCommandCap } from "../../src/features/commands/typed-cap";
import { meetingFileSchema } from "../../src/features/meetings/meeting-file-schema";
import { transcriptHash } from "../../src/features/meetings/transcript-hash";
import { as, as as asCaller, type Caller, createTestDatabase, createUser } from "./harness";

const VISITOR = "00000000-0000-4000-8000-000000000001";
const OTHER_VISITOR = "00000000-0000-4000-8000-000000000002";
const OWNER = "00000000-0000-4000-8000-000000000003";
const STRANGER = "00000000-0000-4000-8000-000000000004";

const speakers = [
  { code: "a", label: "Speaker A" },
  { code: "b", label: "Speaker B" },
];
const turnsFor = (meetingId: string) => [
  {
    id: `${meetingId}-0000`,
    speaker: "a",
    startSec: 0,
    endSec: 5,
    text: "We will launch on the twentieth.",
  },
  {
    id: `${meetingId}-0001`,
    speaker: "b",
    startSec: 4,
    endSec: 9,
    text: "Haris will send the deck by Friday.",
  },
  {
    id: `${meetingId}-0002`,
    speaker: "a",
    startSec: 10,
    endSec: 12,
    text: "Someone should check the pricing page.",
  },
];

async function ingest(
  db: PGlite,
  meetingId: string,
  turns = turnsFor(meetingId),
  durationSec = 12,
) {
  const hash = transcriptHash({ durationSec, speakers, turns });
  const rows = await db.query<{ changed: boolean }>(
    "select public.ingest_transcript($1, $2, $3, $4, $5) as changed",
    [meetingId, durationSec, JSON.stringify(speakers), JSON.stringify(turns), hash],
  );
  return { changed: rows.rows[0]?.changed, hash };
}

async function addMeeting(
  db: PGlite,
  id: string,
  { owner = null, ready = true }: { owner?: string | null; ready?: boolean } = {},
) {
  await db.query(
    "insert into public.meetings (id, owner_id, title, status) values ($1, $2, $3, 'transcribed')",
    [id, owner, `Meeting ${id}`],
  );
  const { hash } = await ingest(db, id);
  if (ready) {
    await db.query("update public.meetings set audio_path = $2, status = 'ready' where id = $1", [
      id,
      `${id}/v1.m4a`,
    ]);
  }
  return hash;
}

type Job = {
  id: string;
  kind: string;
  claim_token: string;
  attempts: number;
  meeting_id: string;
  command_id: string | null;
};

const claim = async (db: PGlite, kinds: string[] | null = null) =>
  (
    await as<Job>(db, { role: "service_role" }, "select * from public.claim_job('w1', $1)", [kinds])
  )[0];

const complete = async (
  db: PGlite,
  job: Pick<Job, "id" | "claim_token">,
  outcome: string,
  payload: unknown = null,
) =>
  (
    await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.complete_job($1, $2, $3, $4) as ok",
      [job.id, job.claim_token, outcome, payload === null ? null : JSON.stringify(payload)],
    )
  )[0]?.ok;

const analysis = (meetingId: string) => ({
  headline: "Launch date agreed; deck owner named.",
  chapters: [{ title: "Launch", firstTurnId: `${meetingId}-0000` }],
  actions: [
    {
      text: "Send the deck",
      ownerName: "Haris",
      dueText: "by Friday",
      turnIds: [`${meetingId}-0001`],
    },
    { text: "Check the pricing page", turnIds: [`${meetingId}-0002`] },
  ],
  decisions: [{ text: "Launch on the 20th", turnIds: [`${meetingId}-0000`] }],
});

let db: PGlite;

beforeEach(async () => {
  db = await createTestDatabase();
  for (const id of [VISITOR, OTHER_VISITOR, OWNER, STRANGER]) await createUser(db, id);
});

describe("reading meetings", () => {
  it("shows ready seed meetings to everyone and private meetings only to their owner", async () => {
    await addMeeting(db, "seed1");
    await addMeeting(db, "seed-importing", { ready: false });
    await addMeeting(db, "private1", { owner: OWNER });

    const ids = async (caller: Parameters<typeof as>[1]) =>
      (await as<{ id: string }>(db, caller, "select id from public.meetings order by id")).map(
        (r) => r.id,
      );

    expect(await ids({ role: "anon" })).toEqual(["seed1"]);
    expect(await ids({ role: "authenticated", userId: VISITOR })).toEqual(["seed1"]);
    expect(await ids({ role: "authenticated", userId: OWNER, isAnonymous: false })).toEqual([
      "private1",
      "seed1",
    ]);
    const privateTurns = await as(
      db,
      { role: "authenticated", userId: VISITOR },
      "select id from public.transcript_turns where meeting_id = 'private1'",
    );
    expect(privateTurns).toHaveLength(0);
  });

  it("does not let visitors write meetings or turns", async () => {
    await addMeeting(db, "seed1");
    await expect(
      as(
        db,
        { role: "authenticated", userId: VISITOR },
        "insert into public.meetings (id, title) values ('mine', 'x')",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(
        db,
        { role: "authenticated", userId: VISITOR },
        "update public.transcript_turns set text = 'changed'",
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("ingest_transcript", () => {
  it("loads a real seed meeting, then skips an unchanged re-import", async () => {
    const file = meetingFileSchema.parse(
      JSON.parse(readFileSync("data/meetings/bro015.json", "utf8")) as unknown,
    );
    await db.query(
      "insert into public.meetings (id, title, status) values ($1, $2, 'transcribed')",
      [file.id, file.title],
    );
    const hash = transcriptHash(file);
    const run = () =>
      db.query<{ changed: boolean }>(
        "select public.ingest_transcript($1, $2, $3, $4, $5) as changed",
        [
          file.id,
          file.durationSec,
          JSON.stringify(file.speakers),
          JSON.stringify(file.turns),
          hash,
        ],
      );
    expect((await run()).rows[0]?.changed).toBe(true);
    expect((await run()).rows[0]?.changed).toBe(false);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.transcript_turns where meeting_id = $1",
      [file.id],
    );
    expect(count.rows[0]?.n).toBe(file.turns.length);
    const jobs = await db.query("select kind from public.processing_jobs where meeting_id = $1", [
      file.id,
    ]);
    expect(jobs.rows).toHaveLength(2);
  });

  it("rejects a turn by an unknown speaker and leaves the old transcript in place", async () => {
    await addMeeting(db, "m1");
    const bad = [
      ...turnsFor("m1"),
      { id: "m1-0003", speaker: "zz", startSec: 11, endSec: 12, text: "who?" },
    ];
    await expect(ingest(db, "m1", bad)).rejects.toThrow(/foreign key/);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.transcript_turns where meeting_id = 'm1'",
    );
    expect(count.rows[0]?.n).toBe(3);
  });

  it("rejects turns that run past the meeting's length", async () => {
    await db.query(
      "insert into public.meetings (id, title, status) values ('m1', 'x', 'transcribed')",
    );
    await expect(ingest(db, "m1", turnsFor("m1"), 11)).rejects.toThrow(/after the meeting/);
  });

  it("a changed transcript removes the old AI output and retires its jobs", async () => {
    await addMeeting(db, "m1");
    const job = await claim(db, ["analyze"]);
    expect(await complete(db, job!, "done", analysis("m1"))).toBe(true);
    const running = await claim(db, ["summarize"]);

    const changed = turnsFor("m1").map((t) => ({ ...t, text: `${t.text} (corrected)` }));
    expect((await ingest(db, "m1", changed)).changed).toBe(true);

    const items = await db.query("select id from public.meeting_items where meeting_id = 'm1'");
    expect(items.rows).toHaveLength(0);
    // the worker still running on the old transcript cannot publish
    expect(await complete(db, running!, "done", { templates: [] })).toBe(false);
  });
});

describe("processing jobs", () => {
  it("leases one job per claim and refuses a finish without the claim", async () => {
    await addMeeting(db, "m1");
    const first = await claim(db);
    const second = await claim(db);
    expect(first?.kind).not.toBe(second?.kind);
    expect(await claim(db)).toBeUndefined();
    expect(
      await complete(db, { id: first!.id, claim_token: crypto.randomUUID() }, "done", {}),
    ).toBe(false);
  });

  it("recovers a job whose worker stopped, and fails it after three attempts", async () => {
    await addMeeting(db, "m1");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = await claim(db, ["analyze"]);
      expect(job?.attempts).toBe(attempt);
      await db.query(
        "update public.processing_jobs set lease_until = now() - interval '1 second' where id = $1",
        [job!.id],
      );
    }
    expect(await claim(db, ["analyze"])).toBeUndefined();
    const status = await db.query<{ status: string }>(
      "select status from public.processing_jobs where kind = 'analyze'",
    );
    expect(status.rows[0]?.status).toBe("failed");
  });

  it("a released job (usage limit) keeps its attempts", async () => {
    await addMeeting(db, "m1");
    const job = await claim(db, ["analyze"]);
    await as(
      db,
      { role: "service_role" },
      "select public.complete_job($1, $2, 'release', null, 'usage limit', null, now())",
      [job!.id, job!.claim_token],
    );
    const again = await claim(db, ["analyze"]);
    expect(again?.attempts).toBe(1);
  });

  it("queues the chain for every owner: commands first for owned meetings, notes first for seed", async () => {
    await addMeeting(db, "stranger1", { owner: STRANGER });
    await addMeeting(db, "seed1");
    const kinds = async (meetingId: string) =>
      (
        await db.query<{ kind: string }>(
          "select kind from public.processing_jobs where meeting_id = $1 order by kind",
          [meetingId],
        )
      ).rows.map((row) => row.kind);
    expect(await kinds("stranger1")).toEqual(["detect_commands"]);
    expect(await kinds("seed1")).toEqual(["analyze", "summarize"]);
    // Ingest (no Claude) is claimed like any other job.
    await db.query(
      "update public.meetings set status = 'transcribed', bot_id = 'bot_s1' where id = 'stranger1'",
    );
    await db.query(
      "insert into public.processing_jobs (meeting_id, kind) values ('stranger1', 'ingest_media')",
    );
    expect((await claim(db, ["ingest_media"]))?.meeting_id).toBe("stranger1");
  });

  it("discards output for a meeting deleted mid-run", async () => {
    await addMeeting(db, "m1");
    const job = await claim(db, ["analyze"]);
    await db.query("delete from public.meetings where id = 'm1'");
    expect(await complete(db, job!, "done", analysis("m1"))).toBe(false);
  });

  it("visitors cannot claim or complete jobs", async () => {
    await expect(
      as(db, { role: "authenticated", userId: VISITOR }, "select * from public.claim_job('x')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, { role: "anon" }, "select public.ingest_transcript('m', 1, '[]', '[]', 'x')"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("AI output", () => {
  it("publishes analysis with citations the database checked", async () => {
    await addMeeting(db, "m1");
    const job = await claim(db, ["analyze"]);
    expect(await complete(db, job!, "done", analysis("m1"))).toBe(true);
    const items = await as<{ kind: string; owner_name: string | null }>(
      db,
      { role: "anon" },
      "select kind, owner_name from public.meeting_items where meeting_id = 'm1' order by kind, idx",
    );
    expect(items.map((i) => i.kind)).toEqual(["action", "action", "decision"]);
    const headline = await db.query<{ ai_headline: string }>(
      "select ai_headline from public.meetings",
    );
    expect(headline.rows[0]?.ai_headline).toMatch(/Launch/);
  });

  it("deletes a meeting whose analysis and summaries are published", async () => {
    await addMeeting(db, "private1", { owner: OWNER });
    // An owned meeting is parsed for commands first; analysis follows from that.
    const detect = await claim(db, ["detect_commands"]);
    expect(await complete(db, detect!, "done", { commands: [], queueGeneration: true })).toBe(true);
    const analyze = await claim(db, ["analyze"]);
    expect(await complete(db, analyze!, "done", analysis("private1"))).toBe(true);
    const summarize = await claim(db, ["summarize"]);
    expect(
      await complete(db, summarize!, "done", {
        templates: [
          {
            key: "brief",
            sections: [
              {
                heading: "In three points",
                points: [{ text: "Launch on the 20th", turnIds: ["private1-0000"] }],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
    const counts = async () =>
      (
        await db.query<{ items: number; citations: number; chapters: number; turns: number }>(
          `select (select count(*)::int from public.meeting_items) as items,
                  (select count(*)::int from public.item_citations) as citations,
                  (select count(*)::int from public.chapters) as chapters,
                  (select count(*)::int from public.transcript_turns) as turns`,
        )
      ).rows[0]!;
    expect((await counts()).citations).toBeGreaterThan(0);

    // The owner deletes it (the route acts with the service role after its own check).
    await as(db, { role: "service_role" }, "delete from public.meetings where id = 'private1'");
    expect(await counts()).toEqual({ items: 0, citations: 0, chapters: 0, turns: 0 });
  });

  it("rejects a citation to a turn that does not exist, or to another meeting's turn", async () => {
    await addMeeting(db, "m1");
    await addMeeting(db, "m2");
    const job = await claim(db, ["analyze"]);
    const invented = {
      ...analysis(job!.meeting_id),
      decisions: [{ text: "x", turnIds: ["m1-9999"] }],
    };
    await expect(complete(db, job!, "done", invented)).rejects.toThrow(/foreign key/);
    const other = job!.meeting_id === "m1" ? "m2" : "m1";
    const crossed = {
      ...analysis(job!.meeting_id),
      decisions: [{ text: "x", turnIds: [`${other}-0000`] }],
    };
    await expect(complete(db, job!, "done", crossed)).rejects.toThrow(/foreign key/);
    // nothing was half-published
    const items = await db.query("select id from public.meeting_items");
    expect(items.rows).toHaveLength(0);
  });

  it("stores summary points per template and section", async () => {
    await addMeeting(db, "m1");
    const job = await claim(db, ["summarize"]);
    const payload = {
      templates: [
        {
          key: "general",
          sections: [
            { heading: "Overview", points: [{ text: "Launch is set.", turnIds: ["m1-0000"] }] },
            { heading: "Next steps", points: [{ text: "Deck by Friday.", turnIds: ["m1-0001"] }] },
          ],
        },
      ],
    };
    expect(await complete(db, job!, "done", payload)).toBe(true);
    const points = await db.query<{ section: string }>(
      "select section from public.meeting_items where kind = 'point' order by section_idx",
    );
    expect(points.rows.map((p) => p.section)).toEqual(["Overview", "Next steps"]);
  });
});

describe("highlights, shares and ticks", () => {
  const visitor = { role: "authenticated", userId: VISITOR } as const;
  const otherVisitor = { role: "authenticated", userId: OTHER_VISITOR } as const;

  it("lets a visitor highlight a seed meeting but not a private one", async () => {
    await addMeeting(db, "seed1");
    await addMeeting(db, "private1", { owner: OWNER });
    await as(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 1, 4)",
    );
    await expect(
      as(
        db,
        visitor,
        "insert into public.highlights (meeting_id, start_sec, end_sec) values ('private1', 0, 12)",
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await as(db, otherVisitor, "select id from public.highlights")).toHaveLength(0);
  });

  it("does not let a highlight be moved to another meeting", async () => {
    await addMeeting(db, "seed1");
    await as(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 1, 4)",
    );
    await expect(
      as(db, visitor, "update public.highlights set meeting_id = 'seed2'"),
    ).rejects.toThrow(/permission denied/);
  });

  it("a share link shows only the clip, and nothing once revoked", async () => {
    await addMeeting(db, "seed1");
    const [highlight] = await as<{ id: string }>(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 4.5, 9) returning id",
    );
    const [minted] = await as<{ token: string }>(
      db,
      visitor,
      "insert into public.share_links (token, highlight_id) values ($1, $2) returning token",
      ["0".repeat(64), highlight!.id],
    );
    const token = minted!.token;

    const [shared] = await as<{
      clip: { turns: { id: string }[]; audioPath: string | null } | null;
    }>(db, { role: "anon" }, "select public.get_shared_clip($1) as clip", [token]);
    // turns overlapping [4.5, 9): the one still speaking at 4.5 and the one starting at 4
    expect(shared?.clip?.turns.map((t) => t.id)).toEqual(["seed1-0000", "seed1-0001"]);
    expect(shared?.clip?.audioPath).toBe("seed1/v1.m4a");

    await as(db, visitor, "update public.share_links set revoked_at = now() where token = $1", [
      token,
    ]);
    const [revoked] = await as<{ clip: unknown }>(
      db,
      { role: "anon" },
      "select public.get_shared_clip($1) as clip",
      [token],
    );
    expect(revoked?.clip).toBeNull();
  });

  it("shares of a private meeting carry no audio path", async () => {
    await addMeeting(db, "private1", { owner: OWNER });
    const owner = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
    const [highlight] = await as<{ id: string }>(
      db,
      owner,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('private1', 0, 3) returning id",
    );
    const [minted] = await as<{ token: string }>(
      db,
      owner,
      "insert into public.share_links (token, highlight_id) values ($1, $2) returning token",
      ["0".repeat(64), highlight!.id],
    );
    const token = minted!.token;
    const [shared] = await as<{ clip: { audioPath: string | null; turns: unknown[] } }>(
      db,
      { role: "anon" },
      "select public.get_shared_clip($1) as clip",
      [token],
    );
    expect(shared?.clip.audioPath).toBeNull();
    expect(shared?.clip.turns).toHaveLength(1);
  });

  it("cannot share someone else's highlight", async () => {
    await addMeeting(db, "seed1");
    const [highlight] = await as<{ id: string }>(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 1, 4) returning id",
    );
    await expect(
      as(db, otherVisitor, "insert into public.share_links (token, highlight_id) values ($1, $2)", [
        "c".repeat(64),
        highlight!.id,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("re-importing exported AI output for an unchanged meeting keeps visitors' ticks", async () => {
    const hash = await addMeeting(db, "seed1");
    const load = async () =>
      (
        await db.query<{ applied: boolean }>(
          "select public.import_generated('seed1', $1, 'analyze', $2) as applied",
          [hash, JSON.stringify(analysis("seed1"))],
        )
      ).rows[0]?.applied;
    expect(await load()).toBe(true);
    const [action] = (
      await db.query<{ id: string }>(
        "select id from public.meeting_items where kind = 'action' order by idx",
      )
    ).rows;
    await as(db, visitor, "insert into public.item_states (item_id, done) values ($1, true)", [
      action!.id,
    ]);

    // The job is done, so a second import (the owner re-running the seed script) is a no-op.
    expect(await load()).toBe(false);
    const ticks = await as<{ item_id: string }>(
      db,
      visitor,
      "select item_id from public.item_states",
    );
    expect(ticks.map((t) => t.item_id)).toEqual([action!.id]);

    // A changed transcript queues new jobs, so the next export loads again.
    const changed = await ingest(db, "seed1", [
      ...turnsFor("seed1"),
      { id: "seed1-0003", speaker: "a", startSec: 10, endSec: 11, text: "One more thing." },
    ]);
    expect(changed.changed).toBe(true);
    expect(
      (
        await db.query<{ applied: boolean }>(
          "select public.import_generated('seed1', $1, 'analyze', $2) as applied",
          [changed.hash, JSON.stringify(analysis("seed1"))],
        )
      ).rows[0]?.applied,
    ).toBe(true);
  });

  it("caps highlights per visitor and links per highlight", async () => {
    await addMeeting(db, "seed1");
    // Filled by the service role (the write limit is per visitor and would stop at 60);
    // the cap itself counts the owner's rows whoever inserted them.
    await db.query(
      `insert into public.highlights (meeting_id, owner_id, start_sec, end_sec)
       select 'seed1', $1, g * 0.01, g * 0.01 + 0.005 from generate_series(1, 300) as g`,
      [VISITOR],
    );
    await expect(
      as(
        db,
        visitor,
        "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 5, 6)",
      ),
    ).rejects.toThrow(/at most 300 highlights/);
    // Another visitor's count is their own.
    await as(
      db,
      otherVisitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 5, 6)",
    );

    const [highlight] = await as<{ id: string }>(
      db,
      otherVisitor,
      "select id from public.highlights where owner_id = $1",
      [OTHER_VISITOR],
    );
    // Share, turn off, share again: each cycle leaves a revoked row behind. The first
    // fifty are written by the service role (the visitor's write limit would stop at 60
    // writes); the fifty-first, as the visitor, hits the cap.
    for (let n = 1; n <= 50; n++) {
      await db.query(
        "insert into public.share_links (token, highlight_id, owner_id) values ('x', $1, $2)",
        [highlight!.id, OTHER_VISITOR],
      );
      await db.query(
        "update public.share_links set revoked_at = now() where highlight_id = $1 and revoked_at is null",
        [highlight!.id],
      );
    }
    await expect(
      as(db, otherVisitor, "insert into public.share_links (token, highlight_id) values ($1, $2)", [
        "0".repeat(64),
        highlight!.id,
      ]),
    ).rejects.toThrow(/at most 50 links/);
  });

  it("keeps the tick check away from anon, as the grant list says", async () => {
    const [row] = (
      await db.query<{ ok: boolean }>(
        "select has_function_privilege('anon', 'public.can_tick_item(uuid)', 'execute') as ok",
      )
    ).rows;
    expect(row?.ok).toBe(false);
  });

  it("keeps each visitor's ticks separate, and only on action items", async () => {
    await addMeeting(db, "seed1");
    const job = await claim(db, ["analyze"]);
    await complete(db, job!, "done", analysis("seed1"));
    const items = await db.query<{ id: string; kind: string }>(
      "select id, kind from public.meeting_items order by kind, idx",
    );
    const action = items.rows.find((i) => i.kind === "action")!;
    const decision = items.rows.find((i) => i.kind === "decision")!;

    await as(db, visitor, "insert into public.item_states (item_id, done) values ($1, true)", [
      action.id,
    ]);
    expect(await as(db, otherVisitor, "select * from public.item_states")).toHaveLength(0);
    await expect(
      as(db, visitor, "insert into public.item_states (item_id, done) values ($1, true)", [
        decision.id,
      ]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("the meeting bot", () => {
  it("allows one active bot per user", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, bot_id, status) values ('b1', $1, 'Call', 'bot_1', 'recording')",
      [OWNER],
    );
    await expect(
      db.query(
        "insert into public.meetings (id, owner_id, title, status) values ('b2', $1, 'Call', 'requested')",
        [OWNER],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("caps a user at five bot requests a day, even after deleting, separately per user", async () => {
    const send = (id: string, owner: string) =>
      db.query(
        "insert into public.meetings (id, owner_id, title, status, source) values ($1, $2, 'Call', 'requested', '{\"kind\":\"bot\"}')",
        [id, owner],
      );
    for (let i = 0; i < 5; i++) {
      await send(`cap${i}`, STRANGER);
      await db.query("delete from public.meetings where id = $1", [`cap${i}`]);
    }
    await expect(send("cap5", STRANGER)).rejects.toThrow(/at most 5 bot meetings/);
    // Another user's allowance is their own, and seed imports are never bot requests.
    await send("other1", OWNER);
    await db.query(
      "insert into public.meetings (id, title, status, source) values ('seed1', 'Seed', 'transcribed', '{\"kind\":\"bot\"}')",
    );
    const rows = await db.query<{ n: string }>(
      "select count(*)::text as n from public.bot_requests",
    );
    expect(rows.rows[0]?.n).toBe("6");
  });

  it("the webhook write is idempotent and never brings a deleted meeting back", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, bot_id, status) values ('b1', $1, 'Call', 'bot_1', 'recording')",
      [OWNER],
    );
    const finish = async () =>
      (
        await as<{ id: string | null }>(
          db,
          { role: "service_role" },
          "select public.mark_bot_finished('bot_1', true) as id",
        )
      )[0]?.id;
    expect(await finish()).toBe("b1");
    expect(await finish()).toBeNull();
    const jobs = await db.query(
      "select id from public.processing_jobs where kind = 'ingest_media'",
    );
    expect(jobs.rows).toHaveLength(1);

    await db.query("delete from public.meetings where id = 'b1'");
    expect(await finish()).toBeNull();
    const meetings = await db.query("select id from public.meetings");
    expect(meetings.rows).toHaveLength(0);
  });
});

describe("search", () => {
  it("finds words in transcripts and AI output, within what the caller can read", async () => {
    await addMeeting(db, "seed1");
    await addMeeting(db, "private1", { owner: OWNER });
    const job = await claim(db, ["analyze"]);
    await complete(db, job!, "done", analysis(job!.meeting_id));

    const hits = await as<{ meeting_id: string; kind: string; snippet: string }>(
      db,
      { role: "anon" },
      "select * from public.search_meetings('pricing')",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((h) => h.meeting_id))).toEqual(new Set(["seed1"]));
    expect(hits.find((h) => h.kind === "turn")?.snippet).toContain("⟦pricing⟧");

    const nothing = await as(
      db,
      { role: "anon" },
      "select * from public.search_meetings('\"unmatched -\" or')",
    );
    expect(nothing).toHaveLength(0);
  });
});

describe("meeting commands", () => {
  const owner = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const payload = (meetingId: string) => ({
    host: { speakerCode: "a", detectedBy: "name" },
    queueGeneration: true,
    commands: [
      {
        turnId: `${meetingId}-0000`,
        source: "spoken",
        kind: "decision",
        sentence: "AFK, decision: we launch on the twentieth.",
        status: "applied",
        args: { text: "we launch on the twentieth." },
        item: { text: "we launch on the twentieth." },
      },
      {
        turnId: `${meetingId}-0001`,
        source: "spoken",
        kind: "highlight",
        sentence: "AFK, highlight that.",
        status: "applied",
        args: {},
        highlight: { startSec: 0, endSec: 4 },
      },
      {
        turnId: `${meetingId}-0002`,
        source: "spoken",
        kind: "email",
        sentence: "AFK, draft an email to Sam about the launch.",
        status: "proposed",
        args: { toNames: ["Sam"], subject: "Launch", body: "Hi Sam, ..." },
      },
    ],
  });

  async function parse(meetingId: string) {
    const job = await claim(db, ["detect_commands"]);
    expect(job?.meeting_id).toBe(meetingId);
    expect(await complete(db, job!, "done", payload(meetingId))).toBe(true);
  }

  it("applies internal commands, proposes the email, records the host and queues analysis", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await parse("op1");
    const commands = await as<{ kind: string; status: string; needs_approval: boolean }>(
      db,
      owner,
      "select kind, status, needs_approval from public.meeting_commands where meeting_id = 'op1' order by created_at, kind",
    );
    expect(commands).toEqual([
      { kind: "decision", status: "applied", needs_approval: false },
      { kind: "email", status: "proposed", needs_approval: true },
      { kind: "highlight", status: "applied", needs_approval: false },
    ]);
    const items = await db.query<{ kind: string; source: string; turn_id: string }>(
      "select i.kind, i.source, c.turn_id from public.meeting_items i join public.item_citations c on c.item_id = i.id where i.meeting_id = 'op1'",
    );
    expect(items.rows).toEqual([{ kind: "decision", source: "command", turn_id: "op1-0000" }]);
    const highlights = await db.query<{ owner_id: string; command_id: string | null }>(
      "select owner_id, command_id from public.highlights where meeting_id = 'op1'",
    );
    expect(highlights.rows).toHaveLength(1);
    expect(highlights.rows[0]?.owner_id).toBe(OWNER);
    expect(highlights.rows[0]?.command_id).not.toBeNull();
    const meeting = await db.query<{ host_speaker_code: string; host_detected_by: string }>(
      "select host_speaker_code, host_detected_by from public.meetings where id = 'op1'",
    );
    expect(meeting.rows[0]).toEqual({ host_speaker_code: "a", host_detected_by: "name" });
    const jobs = await db.query<{ kind: string }>(
      "select kind from public.processing_jobs where meeting_id = 'op1' and status = 'queued' order by kind",
    );
    expect(jobs.rows.map((row) => row.kind)).toEqual(["analyze", "summarize"]);
  });

  it("re-applying the same parse records nothing twice, and analysis keeps explicit items", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await parse("op1");
    await as(db, { role: "service_role" }, "select public.apply_commands('op1', $1)", [
      JSON.stringify(payload("op1")),
    ]);
    const count = await db.query<{ n: string }>(
      "select count(*)::text as n from public.meeting_commands where meeting_id = 'op1'",
    );
    expect(count.rows[0]?.n).toBe("3");
    const job = await claim(db, ["analyze"]);
    expect(await complete(db, job!, "done", analysis("op1"))).toBe(true);
    const decisions = await db.query<{ source: string }>(
      "select source from public.meeting_items where meeting_id = 'op1' and kind = 'decision' order by source",
    );
    expect(decisions.rows.map((row) => row.source)).toEqual(["ai", "command"]);
  });

  it("dismissing a command removes what it created, once", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await parse("op1");
    const [decision] = await db
      .query<{ id: string }>(
        "select id from public.meeting_commands where meeting_id = 'op1' and kind = 'decision'",
      )
      .then((result) => result.rows);
    const dismissed = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.dismiss_command($1) as ok",
      [decision!.id],
    );
    expect(dismissed[0]?.ok).toBe(true);
    const items = await db.query(
      "select id from public.meeting_items where meeting_id = 'op1' and source = 'command'",
    );
    expect(items.rows).toHaveLength(0);
    const again = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.dismiss_command($1) as ok",
      [decision!.id],
    );
    expect(again[0]?.ok).toBe(false);
  });

  it("is readable by the meeting's owner only", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await parse("op1");
    const mine = await as<{ id: string }>(db, owner, "select id from public.meeting_commands");
    expect(mine).toHaveLength(3);
    const theirs = await as<{ id: string }>(
      db,
      { role: "authenticated", userId: STRANGER, isAnonymous: false },
      "select id from public.meeting_commands",
    );
    expect(theirs).toHaveLength(0);
    await expect(
      as(db, { role: "anon" }, "select id from public.meeting_commands"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, owner, "update public.meeting_commands set status = 'done'"),
    ).rejects.toThrow(/permission denied/);
  });

  it("a parse that fails for good still lets the analysis run", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.query(
        "update public.processing_jobs set run_after = now() where meeting_id = 'op1'",
      );
      const job = await claim(db, ["detect_commands"]);
      expect(job?.attempts).toBe(attempt);
      expect(await complete(db, job!, "failed")).toBe(true);
    }
    const jobs = await db.query<{ kind: string; status: string }>(
      "select kind, status from public.processing_jobs where meeting_id = 'op1' order by kind",
    );
    expect(jobs.rows).toEqual([
      { kind: "analyze", status: "queued" },
      { kind: "detect_commands", status: "failed" },
      { kind: "summarize", status: "queued" },
    ]);
  });
});

describe("hardening (review)", () => {
  const visitor = { role: "authenticated", userId: VISITOR } as const;

  it("counts Data API writes against the visitor's limit, and clamps clips, in the database", async () => {
    await addMeeting(db, "m1");
    for (let i = 0; i < 60; i++) {
      await as(
        db,
        visitor,
        "insert into public.highlights (meeting_id, start_sec, end_sec) values ('m1', 1, 3)",
      );
    }
    await expect(
      as(
        db,
        visitor,
        "insert into public.highlights (meeting_id, start_sec, end_sec) values ('m1', 1, 3)",
      ),
    ).rejects.toThrow(/too many changes/);
    // A clip past the recording is clamped to it (duration 12 s); an empty one is refused.
    await db.query("delete from public.visitor_writes");
    const clamped = await as<{ end_sec: string }>(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('m1', 10, 500) returning end_sec",
    );
    expect(Number(clamped[0]?.end_sec)).toBe(12);
    await expect(
      as(
        db,
        visitor,
        "insert into public.highlights (meeting_id, start_sec, end_sec) values ('m1', 12, 500)",
      ),
    ).rejects.toThrow(/must end after it starts/);
  });

  it("mints the share token itself, whatever the client sends", async () => {
    await addMeeting(db, "m1");
    const [highlight] = await as<{ id: string }>(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('m1', 1, 3) returning id",
    );
    const [link] = await as<{ token: string }>(
      db,
      visitor,
      "insert into public.share_links (token, highlight_id) values ($1, $2) returning token",
      ["0".repeat(64), highlight!.id],
    );
    expect(link?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(link?.token).not.toBe("0".repeat(64));
  });

  it("enforces the deployment-wide bot cap atomically", async () => {
    await db.query("update public.app_settings set value = '2' where key = 'bot_daily_cap'");
    const send = (id: string, owner: string) =>
      db.query(
        "insert into public.meetings (id, owner_id, title, status, source) values ($1, $2, 'Call', 'requested', '{\"kind\":\"bot\"}')",
        [id, owner],
      );
    await send("g1", OWNER);
    await db.query("delete from public.meetings where id = 'g1'");
    await send("g2", STRANGER);
    await db.query("delete from public.meetings where id = 'g2'");
    await expect(send("g3", VISITOR)).rejects.toThrow(/fully booked/);
  });

  it("apply_typed_command returns the id it created", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    const [row] = await as<{ id: string }>(
      db,
      { role: "service_role" },
      "select public.apply_typed_command('op1', $1) as id",
      [
        JSON.stringify({
          source: "typed",
          turnId: "op1-0000",
          kind: "decision",
          sentence: "/decision we ship Monday",
          status: "applied",
          args: { text: "we ship Monday" },
          item: { text: "we ship Monday" },
        }),
      ],
    );
    const stored = await db.query<{ id: string; status: string }>(
      "select id, status from public.meeting_commands where meeting_id = 'op1'",
    );
    expect(stored.rows).toEqual([{ id: row!.id, status: "applied" }]);
  });
});

describe("list pages and read limits (gaps closed)", () => {
  const visitor = { role: "authenticated", userId: VISITOR } as const;
  const owner = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  type Row = { id: string; recorded_at: string | null; created_at: string; speakers: unknown };
  const list = (caller: typeof visitor | typeof owner, own: boolean, limit = 20, cursor?: Row) =>
    as<Row>(
      caller,
      "select id, recorded_at, created_at, speakers from public.list_meetings($1, $2, $3, $4, $5)",
      [own, limit, cursor?.recorded_at ?? null, cursor?.created_at ?? null, cursor?.id ?? null],
    );
  // `as` takes the database first; bind it so the helper reads naturally.
  function as<T>(caller: typeof visitor | typeof owner, sql: string, params: unknown[]) {
    return asCaller<T>(db, caller, sql, params);
  }

  it("pages the sample meetings newest first with a cursor that never repeats a row", async () => {
    for (const [id, recorded] of [
      ["s1", "2000-11-09T18:00:00Z"],
      ["s2", "2001-01-10T18:00:00Z"],
      ["s3", "2000-11-09T18:00:00Z"],
      ["s4", null],
    ] as const) {
      await addMeeting(db, id);
      await db.query("update public.meetings set recorded_at = $2 where id = $1", [id, recorded]);
    }
    await addMeeting(db, "private1", { owner: OWNER });
    const all = await list(visitor, false);
    // Newest recorded first; a tie breaks on created_at then id; unrecorded last.
    expect(all.map((row) => row.id)).toEqual(["s2", "s3", "s1", "s4"]);
    expect(all[0]?.speakers).toEqual([
      { code: "a", label: "Speaker A" },
      { code: "b", label: "Speaker B" },
    ]);
    const first = await list(visitor, false, 2);
    const second = await list(visitor, false, 2, first[1]);
    const third = await list(visitor, false, 2, second[1]);
    expect(first.map((row) => row.id)).toEqual(["s2", "s3"]);
    expect(second.map((row) => row.id)).toEqual(["s1", "s4"]);
    expect(third).toEqual([]);
  });

  it("shows a signed-in user only their own meetings, and a visitor none of them", async () => {
    await addMeeting(db, "s1");
    await addMeeting(db, "mine", { owner: OWNER });
    await addMeeting(db, "theirs", { owner: STRANGER });
    expect((await list(owner, true)).map((row) => row.id)).toEqual(["mine"]);
    expect((await list(owner, false)).map((row) => row.id)).toEqual(["s1"]);
    expect(await list(visitor, true)).toEqual([]);
  });

  it("counts read hits per bucket and client, for the server only", async () => {
    const hit = async (bucket: string, key: string, limit = 3) =>
      (
        await asCaller<{ ok: boolean }>(
          db,
          { role: "service_role" },
          "select public.note_read_hit($1, $2, $3) as ok",
          [bucket, key, limit],
        )
      )[0]?.ok;
    const alice = "a".repeat(32);
    const bob = "b".repeat(32);
    for (let i = 0; i < 3; i++) expect(await hit("search", alice)).toBe(true);
    expect(await hit("search", alice)).toBe(false);
    expect(await hit("share", alice)).toBe(true);
    expect(await hit("search", bob)).toBe(true);
    await expect(
      asCaller(db, { role: "anon" }, "select public.note_read_hit('search', $1, 3)", [alice]),
    ).rejects.toThrow(/permission denied/);
    await expect(asCaller(db, visitor, "select * from public.read_hits", [])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("memory files (Phase A2)", () => {
  const user = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const other = { role: "authenticated", userId: STRANGER, isAnonymous: false } as const;
  const anonymous = { role: "authenticated", userId: VISITOR, isAnonymous: true } as const;
  const append = (owner: string, path: string, lines: string[], template = "") =>
    asCaller(db, { role: "service_role" }, "select public.append_memory_lines($1, $2, $3, $4)", [
      owner,
      path,
      lines,
      template,
    ]);
  const read = async (owner: string, path: string) =>
    (
      await db.query<{ content: string; updated_by: string }>(
        "select content, updated_by from public.memory_files where owner_id = $1 and path = $2",
        [owner, path],
      )
    ).rows[0];

  it("is the owner's alone: another user and an anonymous visitor see and write nothing", async () => {
    await asCaller(
      db,
      user,
      "insert into public.memory_files (owner_id, path, content) values ($1, 'profile.md', '# Profile')",
      [OWNER],
    );
    const mine = await asCaller<{ path: string; updated_by: string }>(
      db,
      user,
      "select path, updated_by from public.memory_files",
      [],
    );
    expect(mine).toEqual([{ path: "profile.md", updated_by: "you" }]);
    expect(await asCaller(db, other, "select path from public.memory_files", [])).toEqual([]);
    expect(await asCaller(db, anonymous, "select path from public.memory_files", [])).toEqual([]);
    await expect(
      asCaller(
        db,
        anonymous,
        "insert into public.memory_files (owner_id, path, content) values ($1, 'profile.md', 'x')",
        [VISITOR],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asCaller(
        db,
        other,
        "insert into public.memory_files (owner_id, path, content) values ($1, 'profile.md', 'x')",
        [OWNER],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asCaller(
        db,
        user,
        "insert into public.memory_files (owner_id, path, content) values ($1, 'secrets.md', 'x')",
        [OWNER],
      ),
    ).rejects.toThrow(/check/);
  });

  it("appends AFK's lines below the rule, never touching the user's zone, and trims the oldest", async () => {
    await asCaller(
      db,
      user,
      "insert into public.memory_files (owner_id, path, content) values ($1, 'context/people.md', $2)",
      [OWNER, "# People\n\n- Sam: designer on Atlas\n"],
    );
    await append(OWNER, "context/people.md", ["- [2026-10-20] Ana leads QA (Weekly sync)"]);
    await append(OWNER, "context/people.md", ["- [2026-10-21] Lee joined sales (Kickoff)"]);
    const after = await read(OWNER, "context/people.md");
    expect(after?.updated_by).toBe("afk");
    expect(after?.content).toBe(
      "# People\n\n- Sam: designer on Atlas\n\n---\n\n## Learned by AFK\n\n- [2026-10-20] Ana leads QA (Weekly sync)\n- [2026-10-21] Lee joined sales (Kickoff)\n",
    );
    // A file that does not exist yet is created from the template.
    await append(
      OWNER,
      "context/glossary.md",
      ["- [2026-10-20] PRM: the model (Sync)"],
      "# Glossary\n",
    );
    expect((await read(OWNER, "context/glossary.md"))?.content).toContain(
      "# Glossary\n\n---\n\n## Learned by AFK\n\n- [2026-10-20] PRM",
    );
    // Past 32 KB the oldest learned lines go first; the user's zone stays whole.
    const long = Array.from({ length: 120 }, (_, i) => `- [2026-01-01] ${"x".repeat(400)} ${i}`);
    await append(OWNER, "context/people.md", long);
    const trimmed = await read(OWNER, "context/people.md");
    expect(Buffer.byteLength(trimmed!.content, "utf8")).toBeLessThanOrEqual(32768);
    expect(trimmed?.content.startsWith("# People\n\n- Sam: designer on Atlas\n")).toBe(true);
    expect(trimmed?.content).not.toContain("Ana leads QA");
    expect(trimmed?.content).toContain(" 119\n");
    // Visitors cannot call the writer.
    await expect(
      asCaller(db, user, "select public.append_memory_lines($1, 'context/people.md', array['x'])", [
        OWNER,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("notes a processed meeting in history when its summaries are published", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await db.query("update public.meetings set ai_headline = 'Launch agreed.' where id = 'op1'");
    await db.query(
      "insert into public.processing_jobs (meeting_id, kind) values ('op1', 'summarize') on conflict do nothing",
    );
    const job = await claim(db, ["summarize"]);
    expect(job?.meeting_id).toBe("op1");
    expect(
      await complete(db, job!, "done", {
        templates: [
          {
            key: "general",
            sections: [
              { heading: "Overview", points: [{ text: "Launch agreed.", turnIds: ["op1-0000"] }] },
            ],
          },
        ],
      }),
    ).toBe(true);
    const history = await read(OWNER, "history/meetings.md");
    expect(history?.content).toMatch(/^- \[\d{4}-\d{2}-\d{2}|^- \[undated\]/);
    expect(history?.content).toContain("Meeting op1: Launch agreed. (0 open action items)");
  });

  it("a /remember command appends its line to the file the parser chose", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await asCaller(db, { role: "service_role" }, "select public.apply_commands('op1', $1)", [
      JSON.stringify({
        commands: [
          {
            turnId: "op1-0001",
            source: "spoken",
            kind: "remember",
            sentence: "AFK, remember: Haris sends the decks.",
            status: "applied",
            args: { text: "Haris sends the decks", path: "context/people.md" },
            memory: {
              path: "context/people.md",
              line: "- [2026-10-20] Haris sends the decks (Meeting op1)",
              template: "# People\n",
            },
          },
        ],
      }),
    ]);
    expect((await read(OWNER, "context/people.md"))?.content).toContain(
      "## Learned by AFK\n\n- [2026-10-20] Haris sends the decks (Meeting op1)",
    );
    const stored = await db.query<{ status: string }>(
      "select status from public.meeting_commands where meeting_id = 'op1' and kind = 'remember'",
    );
    expect(stored.rows).toEqual([{ status: "applied" }]);
  });
});

describe("search, signed in", () => {
  it("with p_own_only, finds only the caller's own meetings", async () => {
    await addMeeting(db, "seed1");
    await addMeeting(db, "private1", { owner: OWNER });
    const owner = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
    const own = await as<{ meeting_id: string }>(
      db,
      owner,
      "select distinct meeting_id from public.search_meetings('launch', 60, true)",
    );
    expect(own.map((row) => row.meeting_id)).toEqual(["private1"]);
    const all = await as<{ meeting_id: string }>(
      db,
      owner,
      "select distinct meeting_id from public.search_meetings('launch', 60, false) order by 1",
    );
    expect(all.map((row) => row.meeting_id)).toEqual(["private1", "seed1"]);
  });
});

describe("write rate limit", () => {
  it("allows 60 writes a minute per visitor, separately for each visitor", async () => {
    const write = async (userId: string) =>
      (
        await as<{ ok: boolean }>(
          db,
          { role: "authenticated", userId },
          "select public.note_visitor_write() as ok",
        )
      )[0]?.ok;
    for (let i = 0; i < 60; i++) expect(await write(VISITOR)).toBe(true);
    expect(await write(VISITOR)).toBe(false);
    expect(await write(OTHER_VISITOR)).toBe(true);
    await expect(as(db, { role: "anon" }, "select public.note_visitor_write()")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("connectors and execution (Phase B)", () => {
  const owner = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const service = { role: "service_role" } as const;
  const GMAIL = "https://www.googleapis.com/auth/gmail.send";
  const CALENDAR = "https://www.googleapis.com/auth/calendar.events";

  const store = (owner: string, provider: string, scopes: string[], config = {}) =>
    as<{ id: string }>(
      db,
      service,
      "select public.store_connector($1, $2, $3, $4, $5::text[], $6::jsonb, $7, $8) as id",
      [
        owner,
        provider,
        provider === "google" ? "me@example.com" : "Acme",
        `ext-${provider}`,
        `{${scopes.map((scope) => `"${scope}"`).join(",")}}`,
        JSON.stringify(config),
        "v1.sealed.token.tag",
        null,
      ],
    ).then((rows) => rows[0]!.id);

  /** One proposed external command on a meeting, as the parser would record it. */
  const propose = async (meetingId: string, turn: number, kind: string, args: object) => {
    await as(db, service, "select public.apply_commands($1, $2)", [
      meetingId,
      JSON.stringify({
        queueGeneration: false,
        commands: [
          {
            turnId: `${meetingId}-000${turn}`,
            source: "spoken",
            kind,
            sentence: `AFK, ${kind} something.`,
            status: "proposed",
            args,
          },
        ],
      }),
    ]);
    const rows = await db.query<{ id: string }>(
      "select id from public.meeting_commands where meeting_id = $1 and turn_id = $2",
      [meetingId, `${meetingId}-000${turn}`],
    );
    return rows.rows[0]!.id;
  };

  const approve = (id: string, args: object | null = null) =>
    as<{ ok: boolean }>(db, service, "select public.approve_command($1, $2) as ok", [
      id,
      args === null ? null : JSON.stringify(args),
    ]).then((rows) => rows[0]!.ok);

  const start = (id: string, job: Job, token = job.claim_token) =>
    as<{ gate: string }>(db, service, "select public.start_command($1, $2, $3) as gate", [
      id,
      job.id,
      token,
    ]).then((rows) => rows[0]!.gate);

  const command = (id: string) =>
    db
      .query<{
        status: string;
        executed_at: string | null;
        error: string | null;
        result: unknown;
        approved_args: unknown;
      }>(
        "select status, executed_at, error, result, approved_args from public.meeting_commands where id = $1",
        [id],
      )
      .then((rows) => rows.rows[0]!);

  const jobsFor = (id: string) =>
    db
      .query<{ status: string; max_attempts: number; last_error: string | null }>(
        "select status, max_attempts, last_error from public.processing_jobs where command_id = $1 order by created_at",
        [id],
      )
      .then((rows) => rows.rows);

  const emailArgs = { to: ["sam@example.com"], cc: [], subject: "Launch", body: "Hi" };

  it("keeps one connector per provider, replaces it on reconnect, and hides the token from every user", async () => {
    const first = await store(OWNER, "google", [GMAIL]);
    const second = await store(OWNER, "google", [GMAIL, CALENDAR]);
    expect(second).toBe(first);
    const mine = await as<{ provider: string; scopes: string[]; status: string }>(
      db,
      owner,
      "select provider, scopes, status from public.connectors",
    );
    expect(mine).toEqual([{ provider: "google", scopes: [GMAIL, CALENDAR], status: "connected" }]);
    expect(
      await as(
        db,
        { role: "authenticated", userId: STRANGER, isAnonymous: false },
        "select id from public.connectors",
      ),
    ).toEqual([]);
    await expect(as(db, { role: "anon" }, "select id from public.connectors")).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(db, owner, "select ciphertext from public.connector_secrets")).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(db, owner, "update public.connectors set scopes = '{}'")).rejects.toThrow(
      /permission denied/,
    );
    const secrets = await db.query<{ n: string }>(
      "select count(*)::text as n from public.connector_secrets",
    );
    expect(secrets.rows[0]?.n).toBe("1");
  });

  it("approval stores the confirmed details and queues one run job, once", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    const id = await propose("op1", 2, "email", {
      toNames: ["Sam"],
      subject: "Launch",
      body: "Hi",
    });
    expect(await approve(id, emailArgs)).toBe(true);
    expect(await approve(id, emailArgs)).toBe(false);
    const row = await command(id);
    expect(row.status).toBe("approved");
    expect(row.approved_args).toEqual(emailArgs);
    const jobs = await jobsFor(id);
    expect(jobs).toEqual([{ status: "queued", max_attempts: 1, last_error: null }]);
    const typed = await db.query<{ kind: string }>(
      "select kind from public.processing_jobs where meeting_id = 'op1' and status = 'queued'",
    );
    // The owner meeting's own parse job is still queued; no analysis was re-queued.
    expect(typed.rows.map((job) => job.kind).sort()).toEqual(["detect_commands", "run_command"]);
  });

  it("hands a run job to a meeting whose owner is not an owner, and gates it exactly once", async () => {
    await addMeeting(db, "u1", { owner: VISITOR });
    const id = await propose("u1", 2, "slack", { message: "The demo moved." });
    await approve(id, {
      channelId: "C0123456",
      channelName: "general",
      message: "The demo moved.",
    });
    const job = await claim(db, ["run_command"]);
    expect(job?.meeting_id).toBe("u1");
    expect(await start(id, job!, "00000000-0000-4000-8000-000000000000")).toBe("lost");
    expect(await start(id, job!)).toBe("go");
    expect((await command(id)).status).toBe("running");
    expect((await command(id)).executed_at).not.toBeNull();
    expect(await start(id, job!)).toBe("ambiguous");
    // Finishing writes the result, the connector's use and the history line.
    await store(VISITOR, "slack", ["chat:write"], { channelId: "C0123456" });
    expect(
      await complete(db, job!, "done", {
        result: {
          kind: "slack",
          channelName: "general",
          message: "The demo moved.",
          ts: "1.2",
          teamName: "Acme",
        },
        line: '- [2026-10-20 14:02] Posted to #general in Acme: "The demo moved." (Meeting u1)',
        provider: "slack",
      }),
    ).toBe(true);
    const done = await command(id);
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({ kind: "slack", ts: "1.2" });
    const history = await as<{ content: string }>(
      db,
      { role: "authenticated", userId: VISITOR, isAnonymous: false },
      "select content from public.memory_files where path = 'history/actions.md'",
    );
    expect(history[0]?.content).toContain("Posted to #general in Acme");
    const used = await db.query<{ last_used_at: string | null }>(
      "select last_used_at from public.connectors where owner_id = $1 and provider = 'slack'",
      [VISITOR],
    );
    expect(used.rows[0]?.last_used_at).not.toBeNull();
  });

  it("a follow-up may run again after a failure; an email may not once it reached the adapter", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    const email = await propose("op1", 1, "email", { toNames: [], subject: "x", body: "y" });
    const followup = await propose("op1", 2, "followup", {
      title: "Follow-up",
      whenText: null,
      startsAt: null,
      durationMin: 30,
      attendeeNames: [],
    });
    await approve(email, emailArgs);
    await approve(followup, {
      title: "Follow-up",
      startsAt: "2026-10-28T15:00:00+05:00",
      durationMin: 30,
      attendees: [],
      description: null,
    });
    expect((await jobsFor(followup))[0]?.max_attempts).toBe(3);

    const emailJob = await claim(db, ["run_command"]);
    expect(await start(email, emailJob!)).toBe("go");
    expect(await complete(db, emailJob!, "failed")).toBe(true);
    expect((await command(email)).status).toBe("failed");
    expect(await approve(email)).toBe(false);

    const followupJob = await claim(db, ["run_command"]);
    expect(await start(followup, followupJob!)).toBe("go");
    await db.query("update public.processing_jobs set attempts = max_attempts where id = $1", [
      followupJob!.id,
    ]);
    expect(await complete(db, followupJob!, "failed")).toBe(true);
    expect((await command(followup)).status).toBe("failed");
    expect(await approve(followup)).toBe(true);
    expect((await command(followup)).status).toBe("approved");
    expect((await jobsFor(followup)).map((job) => job.status)).toEqual(["failed", "queued"]);
    const again = await claim(db, ["run_command"]);
    expect(await start(followup, again!)).toBe("go");
  });

  it("dismissing drops a queued run, and a dead worker fails the command it was running", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    const one = await propose("op1", 1, "email", { toNames: [], subject: "x", body: "y" });
    const two = await propose("op1", 2, "email", { toNames: [], subject: "x", body: "y" });
    await approve(one, emailArgs);
    await approve(two, emailArgs);
    expect(
      (await as<{ ok: boolean }>(db, service, "select public.dismiss_command($1) as ok", [one]))[0]
        ?.ok,
    ).toBe(true);
    expect((await jobsFor(one))[0]).toMatchObject({
      status: "failed",
      last_error: "dismissed by the owner",
    });

    const job = await claim(db, ["run_command"]);
    expect(await start(two, job!)).toBe("go");
    await db.query(
      "update public.processing_jobs set lease_until = now() - interval '1 minute' where id = $1",
      [job!.id],
    );
    expect(await claim(db, ["run_command"])).toBeUndefined();
    const row = await command(two);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/stopped mid-way/);
    expect(await approve(two)).toBe(false);
  });
});

describe("memory saves as one statement (completion plan, batch 2)", () => {
  const user = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const other = { role: "authenticated", userId: STRANGER, isAnonymous: false } as const;
  const anonymous = { role: "authenticated", userId: VISITOR, isAnonymous: true } as const;
  const PATH = "context/people.md";
  // Stamps travel as text: PGlite would otherwise hand back a Date with the microseconds
  // gone, and the equality in the function is exact.
  const save = async (caller: Caller, content: string, expected: string | null) =>
    (
      await asCaller<{ at: string }>(
        db,
        caller,
        "select public.save_memory_file($1, $2, $3::timestamptz)::text as at",
        [PATH, content, expected],
      )
    )[0]!.at;
  const read = async (owner: string) =>
    (
      await db.query<{ content: string; updated_by: string; at: string }>(
        "select content, updated_by, updated_at::text as at from public.memory_files where owner_id = $1 and path = $2",
        [owner, PATH],
      )
    ).rows[0];

  it("refuses a save over a line AFK appended meanwhile, and takes it once reloaded", async () => {
    // The editor loads the file (t0) and the user starts typing.
    const t0 = await save(user, "# People\n\n- Sam: designer on Atlas\n", null);
    expect((await read(OWNER))?.at).toBe(t0);

    // AFK's worker appends a learned line while the editor is open.
    await asCaller(
      db,
      { role: "service_role" },
      "select public.append_memory_lines($1, $2, $3, '')",
      [OWNER, PATH, ["- [2026-10-21] Ana leads QA (Weekly sync)"]],
    );
    const appended = await read(OWNER);
    expect(appended?.updated_by).toBe("afk");
    expect(appended?.at).not.toBe(t0);

    // The user's save still carries t0: refused, and AFK's line is still there.
    await expect(
      save(user, "# People\n\n- Sam: designer on Atlas\n- Lee: sales\n", t0),
    ).rejects.toThrow(/changed meanwhile/);
    const kept = await read(OWNER);
    expect(kept?.content).toContain("Ana leads QA");
    expect(kept?.content).not.toContain("Lee: sales");

    // Reloaded, the editor holds AFK's line and the new stamp: the edit goes through.
    const t2 = await save(
      user,
      kept!.content.replace("- Sam: designer on Atlas", "- Sam: designer on Atlas\n- Lee: sales"),
      kept!.at,
    );
    const after = await read(OWNER);
    expect(after?.at).toBe(t2);
    expect(after?.updated_by).toBe("you");
    expect(after?.content).toContain("Lee: sales");
    expect(after?.content).toContain("Ana leads QA");

    // The same stamp cannot be used twice: the second writer with t2's predecessor loses.
    await expect(save(user, "# People\n", kept!.at)).rejects.toThrow(/changed meanwhile/);
    // Without a stamp (a fresh editor on a file it never loaded) the save is unconditional.
    expect(await save(user, "# People\n", null)).not.toBe(t2);
  });

  it("writes only the caller's own file, and never for an anonymous visitor", async () => {
    await save(user, "# People\n\n- mine\n", null);
    await save(other, "# People\n\n- theirs\n", null);
    expect((await read(OWNER))?.content).toContain("mine");
    expect((await read(STRANGER))?.content).toContain("theirs");
    await expect(save(anonymous, "# People\n", null)).rejects.toThrow(/row-level security/);
    await expect(
      asCaller(db, { role: "anon" }, "select public.save_memory_file($1, 'x')", [PATH]),
    ).rejects.toThrow(/permission denied/);
  });

  it("counts against the visitor's sixty writes a minute like every other write", async () => {
    for (let i = 0; i < 60; i++) await save(user, `# People ${i}\n`, null);
    await expect(save(user, "# People\n", null)).rejects.toThrow(/too many changes/);
    // Refused means untouched: the last accepted content stands.
    expect((await read(OWNER))?.content).toBe("# People 59\n");
  });
});

describe("the keep-alive's trace (completion plan, batch 3)", () => {
  it("is written by the server only and read by no user role", async () => {
    await as(
      db,
      { role: "service_role" },
      "insert into public.cron_runs (job, meetings, pruned) values ('keepalive', 5, 0)",
    );
    const rows = await as<{ job: string; meetings: number }>(
      db,
      { role: "service_role" },
      "select job, meetings from public.cron_runs",
    );
    expect(rows).toEqual([{ job: "keepalive", meetings: 5 }]);
    await expect(as(db, { role: "anon" }, "select * from public.cron_runs")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, { role: "authenticated", userId: OWNER }, "select * from public.cron_runs"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(
        db,
        { role: "service_role" },
        "insert into public.cron_runs (job, meetings, pruned) values ('other', 1, 0)",
      ),
    ).rejects.toThrow(/check/);
  });
});

describe("stale bots and commands past the cap (completion plan, batch 4)", () => {
  const service = { role: "service_role" } as const;

  it("the sweep closes bots that never reported back after six hours, and leaves the rest", async () => {
    // One active bot per owner, so each stale row belongs to a different user.
    await db.query(
      `insert into public.meetings (id, owner_id, title, status, created_at) values
         ('old-req', $1, 'Old request', 'requested', now() - interval '7 hours'),
         ('old-rec', $2, 'Old recording', 'recording', now() - interval '6 hours 1 minute'),
         ('new-rec', $3, 'New recording', 'recording', now() - interval '5 hours')`,
      [OWNER, STRANGER, VISITOR],
    );
    await addMeeting(db, "m1");
    const swept = (await as<{ n: number }>(db, service, "select public.sweep_stale_bots() as n"))[0]
      ?.n;
    expect(swept).toBe(2);
    const rows = await db.query<{ id: string; status: string; status_detail: string | null }>(
      "select id, status, status_detail from public.meetings order by id",
    );
    expect(rows.rows.map((row) => [row.id, row.status])).toEqual([
      ["m1", "ready"],
      ["new-rec", "recording"],
      ["old-rec", "failed"],
      ["old-req", "failed"],
    ]);
    expect(rows.rows.find((row) => row.id === "old-rec")?.status_detail).toMatch(/six hours/);
    // The owner's next bot is no longer blocked by the closed row.
    await db.query(
      "insert into public.meetings (id, owner_id, title, status) values ('next', $1, 'Next', 'requested')",
      [OWNER],
    );
    // Only the server runs the sweep.
    await expect(
      as(db, { role: "authenticated", userId: OWNER }, "select public.sweep_stale_bots()"),
    ).rejects.toThrow(/permission denied/);
    // The keep-alive's trace records what it swept.
    await as(
      db,
      service,
      "insert into public.cron_runs (job, meetings, pruned, swept) values ('keepalive', 5, 0, 2)",
    );
  });

  it("lists commands past the cap as skipped, outside the cap, with their own ceiling", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await addMeeting(db, "op2", { owner: STRANGER });
    const kinds = [
      "task",
      "decision",
      "note",
      "highlight",
      "email",
      "followup",
      "remind",
      "slack",
      "remember",
    ];
    // Spoken commands are unique per (turn, kind): 27 combinations over the three turns.
    const combos: Array<[string, string]> = [];
    for (const turn of ["0000", "0001", "0002"])
      for (const kind of kinds) combos.push([turn, kind]);
    const insert = (meeting: string, index: number, status: string) =>
      as(
        db,
        service,
        `insert into public.meeting_commands (meeting_id, turn_id, source, kind, sentence, status, args, error)
         values ($1, $2, 'spoken', $3, 'AFK, something', $4, '{}', $5)`,
        [
          meeting,
          `${meeting}-${combos[index]![0]}`,
          combos[index]![1],
          status,
          status === "skipped" ? "Past the limit of 20 spoken commands for this meeting." : null,
        ],
      );
    for (let i = 0; i < 20; i++) await insert("op1", i, "applied");
    await expect(insert("op1", 20, "applied")).rejects.toThrow(/at most 20 spoken/);
    // The ones past the cap are still listed, with the reason, and can be dismissed.
    for (let i = 20; i < 23; i++) await insert("op1", i, "skipped");
    const skipped = await as<{ id: string; error: string }>(
      db,
      { role: "authenticated", userId: OWNER, isAnonymous: false },
      "select id, error from public.meeting_commands where meeting_id = 'op1' and status = 'skipped'",
    );
    expect(skipped).toHaveLength(3);
    expect(skipped[0]?.error).toMatch(/20 spoken commands/);
    expect(
      (
        await as<{ ok: boolean }>(db, service, "select public.dismiss_command($1) as ok", [
          skipped[0]!.id,
        ])
      )[0]?.ok,
    ).toBe(true);
    // Skipped rows have a ceiling of their own.
    for (let i = 0; i < 20; i++) await insert("op2", i, "skipped");
    await expect(insert("op2", 20, "skipped")).rejects.toThrow(/at most 20 skipped/);
  });
});

describe("the learn job (completion plan, batch 5, requirement M3)", () => {
  const service = { role: "service_role" } as const;
  const kindsOf = async (meetingId: string) =>
    (
      await db.query<{ kind: string; status: string }>(
        "select kind, status from public.processing_jobs where meeting_id = $1 order by kind",
        [meetingId],
      )
    ).rows.map((row) => `${row.kind}:${row.status}`);

  it("follows the summary for an owner's meeting, never for a seed meeting, and writes the lines", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    const detect = await claim(db, ["detect_commands"]);
    expect(
      await complete(db, detect!, "done", { host: null, queueGeneration: true, commands: [] }),
    ).toBe(true);
    const analyze = await claim(db, ["analyze"]);
    expect(await complete(db, analyze!, "done", analysis("op1"))).toBe(true);
    const summarize = await claim(db, ["summarize"]);
    expect(await complete(db, summarize!, "done", { templates: [] })).toBe(true);
    expect(await kindsOf("op1")).toEqual([
      "analyze:done",
      "detect_commands:done",
      "learn:queued",
      "notify_owner:queued",
      "summarize:done",
    ]);

    // The learn job hands its grounded lines to the memory files, under AFK's heading
    // (the summary step already wrote history/meetings.md; only the context files matter here).
    const learn = await claim(db, ["learn"]);
    expect(learn?.meeting_id).toBe("op1");
    expect(
      await complete(db, learn!, "done", {
        files: [
          {
            path: "context/people.md",
            template: "# People\n",
            lines: ["- [2026-10-21] Ana leads QA (Meeting op1, at 0:04)"],
          },
          { path: "profile.md", template: "", lines: ["- never written: not a context file"] },
          { path: "context/glossary.md", template: "# Glossary\n", lines: [] },
        ],
      }),
    ).toBe(true);
    const files = await db.query<{ path: string; content: string; updated_by: string }>(
      "select path, content, updated_by from public.memory_files where owner_id = $1 and path like 'context/%' order by path",
      [OWNER],
    );
    expect(files.rows.map((row) => row.path)).toEqual(["context/people.md"]);
    expect(files.rows[0]?.updated_by).toBe("afk");
    expect(files.rows[0]?.content).toBe(
      "# People\n\n---\n\n## Learned by AFK\n\n- [2026-10-21] Ana leads QA (Meeting op1, at 0:04)\n",
    );

    // A seed meeting's summary queues no learn job: nobody owns its memory.
    await addMeeting(db, "m1");
    await claim(db, ["analyze"]);
    const seedSummary = await claim(db, ["summarize"]);
    expect(seedSummary?.meeting_id).toBe("m1");
    expect(await complete(db, seedSummary!, "done", { templates: [] })).toBe(true);
    expect((await kindsOf("m1")).filter((kind) => kind.startsWith("learn"))).toEqual([]);
    // Only the server may apply learned lines.
    await expect(
      as(db, { role: "authenticated", userId: OWNER }, "select public.apply_learned('op1', '{}')"),
    ).rejects.toThrow(/permission denied/);
  });

  it("a changed transcript retires a waiting learn job with the rest of the chain", async () => {
    await addMeeting(db, "op1", { owner: OWNER });
    await as(
      db,
      service,
      "insert into public.processing_jobs (meeting_id, kind) values ('op1', 'learn')",
    );
    const changed = turnsFor("op1").map((turn) => ({ ...turn, text: `${turn.text} (revised)` }));
    await ingest(db, "op1", changed);
    const jobs = await db.query<{ kind: string; status: string; last_error: string | null }>(
      "select kind, status, last_error from public.processing_jobs where meeting_id = 'op1' and kind = 'learn'",
    );
    expect(jobs.rows).toEqual([
      { kind: "learn", status: "failed", last_error: "superseded by a new transcript" },
    ]);
  });
});

describe("live presence (completion plan, batch 7, requirements L1 and L2)", () => {
  const service = { role: "service_role" } as const;
  const record = (
    key: string,
    text: string,
    { isHost = true, command = null }: { isHost?: boolean; command?: object | null } = {},
  ) =>
    as<{
      meeting_id: string | null;
      seq: string | null;
      duplicate: boolean;
      command_id: string | null;
    }>(
      db,
      service,
      "select * from public.record_live_utterance('bot_live_0001', $1, 'Tess', 'spk-1', $2, 1000, 900, $3, $4)",
      [key, isHost, text, command === null ? null : JSON.stringify(command)],
    );

  it("stores each utterance once, and a host's question becomes a command with an answer job", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('live1', $1, 'Live', 'recording', 'bot_live_0001')",
      [OWNER],
    );
    const [first] = await record("k1", "Let's start with pricing.");
    expect(first).toMatchObject({ meeting_id: "live1", duplicate: false, command_id: null });
    // A redelivery changes nothing.
    const [again] = await record("k1", "Let's start with pricing.");
    expect(again).toMatchObject({ meeting_id: "live1", seq: null, duplicate: true });
    // The host's question: a live command and its job, in the same transaction.
    const [asked] = await record("k2", "AFK, what did we decide about pricing?", {
      command: { kind: "ask", args: { question: "what did we decide about pricing?" } },
    });
    expect(asked?.command_id).not.toBeNull();
    const commands = await db.query<{
      source: string;
      kind: string;
      status: string;
      live_seq: string;
    }>(
      "select source, kind, status, live_seq from public.meeting_commands where meeting_id = 'live1'",
    );
    expect(commands.rows).toEqual([
      { source: "live", kind: "ask", status: "detected", live_seq: asked!.seq },
    ]);
    const jobs = await db.query<{
      kind: string;
      status: string;
      command_id: string;
      max_attempts: number;
    }>(
      "select kind, status, command_id, max_attempts from public.processing_jobs where meeting_id = 'live1'",
    );
    expect(jobs.rows).toEqual([
      {
        kind: "answer_in_meeting",
        status: "queued",
        command_id: asked!.command_id,
        max_attempts: 2,
      },
    ]);
    // A guest's question is stored, not answered; an unknown bot is ignored.
    const [guest] = await record("k3", "AFK, what did we decide?", {
      isHost: false,
      command: { kind: "ask", args: {} },
    });
    expect(guest).toMatchObject({ meeting_id: "live1", duplicate: false, command_id: null });
    const [stranger] = await as<{ meeting_id: string | null }>(
      db,
      service,
      "select * from public.record_live_utterance('bot_unknown_1', 'k', 'X', 'y', true, 1, 1, 'hello')",
    );
    expect(stranger?.meeting_id).toBeNull();
    expect((await db.query("select count(*)::int as n from public.live_utterances")).rows).toEqual([
      { n: 3 },
    ]);
    // No user role can read what was heard.
    await expect(as(db, { role: "anon" }, "select * from public.live_utterances")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as(db, { role: "authenticated", userId: OWNER }, "select * from public.live_utterances"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(
        db,
        { role: "authenticated", userId: OWNER },
        "select public.record_live_utterance('bot_live_0001', 'k9', 'x', 'y', true, 1, 1, 'z')",
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("the worker's answer lands on the command and in a reply row; a final failure tells the host", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('live1', $1, 'Live', 'recording', 'bot_live_0001')",
      [OWNER],
    );
    const [asked] = await record("k2", "AFK, what did we decide about pricing?", {
      command: { kind: "ask", args: { question: "what did we decide about pricing?" } },
    });
    const job = await claim(db, ["answer_in_meeting"]);
    expect(job?.command_id).toBe(asked!.command_id);
    expect(
      await complete(db, job!, "done", {
        kind: "answer",
        text: "Blue, as Sam said. (at 0:00)",
        posted: true,
        spoken: false,
        cited: [1],
      }),
    ).toBe(true);
    const command = (
      await db.query<{ status: string; result: { text: string; posted: boolean } }>(
        "select status, result from public.meeting_commands where id = $1",
        [asked!.command_id],
      )
    ).rows[0];
    expect(command?.status).toBe("done");
    expect(command?.result).toMatchObject({ text: "Blue, as Sam said. (at 0:00)", posted: true });
    const replies = await db.query<{ text: string; posted: boolean; spoken: boolean }>(
      "select text, posted, spoken from public.live_replies where meeting_id = 'live1'",
    );
    expect(replies.rows).toEqual([
      { text: "Blue, as Sam said. (at 0:00)", posted: true, spoken: false },
    ]);

    // A second question whose two attempts fail: the card says so.
    const [second] = await record("k5", "AFK, who owns the deck?", {
      command: { kind: "ask", args: { question: "who owns the deck?" } },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = await claim(db, ["answer_in_meeting"]);
      expect(retry?.command_id).toBe(second!.command_id);
      await complete(db, retry!, "failed", null);
      if (attempt === 0) {
        await db.query(
          "update public.processing_jobs set run_after = now() where command_id = $1",
          [second!.command_id],
        );
      }
    }
    const failed = (
      await db.query<{ status: string }>(
        "select status from public.meeting_commands where id = $1",
        [second!.command_id],
      )
    ).rows[0];
    expect(failed?.status).toBe("failed");
  });

  it("the final transcript replaces what was heard live", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('live1', $1, 'Live', 'recording', 'bot_live_0001')",
      [OWNER],
    );
    await record("k1", "Let's start with pricing.");
    await db.query("update public.meetings set status = 'transcribed' where id = 'live1'");
    await ingest(db, "live1");
    expect((await db.query("select count(*)::int as n from public.live_utterances")).rows).toEqual([
      { n: 0 },
    ]);
  });
});

describe("access requests", () => {
  it("takes one email per visitor, as themselves, and shows the list to nobody", async () => {
    const db = await createTestDatabase();
    await createUser(db, VISITOR);
    await createUser(db, OTHER_VISITOR);
    const visitor: Caller = { role: "authenticated", userId: VISITOR };
    const insert = "insert into public.access_requests (email) values ($1)";
    await as(db, visitor, insert, ["someone@gmail.com"]);
    // The same address again is the unique constraint, which the route answers like a first.
    await expect(as(db, visitor, insert, ["someone@gmail.com"])).rejects.toThrow(/unique/);
    // The address arrives clean from the route: lower case, trimmed, shaped like one.
    await expect(as(db, visitor, insert, ["Someone@gmail.com"])).rejects.toThrow(/check/);
    await expect(as(db, visitor, insert, [" x@y.z"])).rejects.toThrow(/check/);
    await expect(as(db, visitor, insert, ["not an address"])).rejects.toThrow(/check/);
    // Only as yourself, and only with a session.
    await expect(
      as(
        db,
        { role: "authenticated", userId: OTHER_VISITOR },
        "insert into public.access_requests (email, requested_by) values ($1, $2)",
        ["other@gmail.com", VISITOR],
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
    await expect(as(db, { role: "anon" }, insert, ["anon@gmail.com"])).rejects.toThrow(
      /permission denied|row-level security/,
    );
    // Nobody reads the list from the browser, not even the one who wrote to it.
    await expect(as(db, visitor, "select email from public.access_requests")).rejects.toThrow(
      /permission denied/,
    );
    expect(
      await as(db, { role: "service_role" }, "select email from public.access_requests"),
    ).toEqual([{ email: "someone@gmail.com" }]);
  });
});

describe("guest mode and in-app processing", () => {
  const GUEST = "00000000-0000-4000-8000-00000000000a";
  const OLD_GUEST = "00000000-0000-4000-8000-00000000000b";

  const addGuest = (id: string, ageDays: number) =>
    createUser(db, id, { anonymous: true, ageDays });

  it("claim_job serves the meeting it was kicked for first, and live answers before notes", async () => {
    await addMeeting(db, "seed1");
    await addMeeting(db, "seed2");
    const forSeed2 = await as<Job>(
      db,
      { role: "service_role" },
      "select * from public.claim_job('w1', null, 300, 'seed2')",
    );
    expect(forSeed2[0]?.meeting_id).toBe("seed2");
    // A live question for seed1, queued after everything else, is still taken next.
    const command = await db.query<{ id: string }>(
      "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval, live_seq) values ('seed1', 'live', 'ask', 'AFK, what did we decide?', 'detected', false, 1) returning id",
    );
    await db.query(
      "insert into public.processing_jobs (meeting_id, kind, command_id, max_attempts) values ('seed1', 'answer_in_meeting', $1, 2)",
      [command.rows[0]!.id],
    );
    const next = await claim(db);
    expect(next?.kind).toBe("answer_in_meeting");
  });

  it("a guest owns meetings under the bot caps, but has no memory and no learned lines", async () => {
    await addGuest(GUEST, 1);
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, source) values ('g1', $1, 'Guest call', 'requested', '{\"kind\": \"bot\"}')",
      [GUEST],
    );
    const requests = await db.query<{ n: string }>(
      "select count(*) as n from public.bot_requests where owner_id = $1",
      [GUEST],
    );
    expect(Number(requests.rows[0]?.n)).toBe(1);

    // AFK's appends are refused for a guest, and taken for a Google user.
    for (const owner of [GUEST, OWNER]) {
      await as(
        db,
        { role: "service_role" },
        "select public.append_memory_lines($1, 'context/people.md', array['- Sam is the designer'], '')",
        [owner],
      );
    }
    const files = await db.query<{ owner_id: string }>(
      "select owner_id from public.memory_files where path = 'context/people.md'",
    );
    expect(files.rows.map((row) => row.owner_id)).toEqual([OWNER]);

    // The chain queues no learn job for a guest's meeting; it does for a Google user's.
    await addMeeting(db, "g2", { owner: GUEST });
    await addMeeting(db, "o2", { owner: OWNER });
    for (const id of ["g2", "o2"]) {
      await db.query(
        "insert into public.processing_jobs (meeting_id, kind) values ($1, 'summarize')",
        [id],
      );
      const job = (
        await as<Job>(
          db,
          { role: "service_role" },
          "select * from public.claim_job('w1', array['summarize'], 300, $1)",
          [id],
        )
      )[0]!;
      expect(job.meeting_id).toBe(id);
      expect(await complete(db, job, "done", { templates: [] })).toBe(true);
    }
    const learn = await db.query<{ meeting_id: string }>(
      "select meeting_id from public.processing_jobs where kind = 'learn' order by meeting_id",
    );
    expect(learn.rows.map((row) => row.meeting_id)).toEqual(["o2"]);
  });

  it("purges guests older than the retention window with their meetings, and nobody else", async () => {
    const BUSY_GUEST = "00000000-0000-4000-8000-00000000000c";
    await addGuest(GUEST, 1);
    await addGuest(OLD_GUEST, 40);
    await addGuest(BUSY_GUEST, 40);
    await addMeeting(db, "fresh", { owner: GUEST });
    await addMeeting(db, "stale", { owner: OLD_GUEST });
    await db.query("update public.meetings set bot_id = 'bot_stale1234' where id = 'stale'");
    await addMeeting(db, "mine", { owner: OWNER });
    // An old guest whose bot is still in a call is left alone until it ends.
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('busy', $1, 'In progress', 'recording', 'bot_busy')",
      [BUSY_GUEST],
    );
    const [purged] = await as<{
      purge_stale_guests: { users: number; audio_paths: string[]; bot_ids: string[] };
    }>(db, { role: "service_role" }, "select public.purge_stale_guests('30 days')");
    // The audio objects to remove, and the bots Attendee is told to forget.
    expect(purged?.purge_stale_guests).toEqual({
      users: 1,
      audio_paths: ["stale/v1.m4a"],
      bot_ids: ["bot_stale1234"],
    });
    const left = await db.query<{ id: string }>("select id from public.meetings order by id");
    expect(left.rows.map((row) => row.id)).toEqual(["busy", "fresh", "mine"]);
    await expect(
      as(db, { role: "authenticated", userId: VISITOR }, "select public.purge_stale_guests()"),
    ).rejects.toThrow(/permission denied/);
  });

  it("a recording too large to keep still publishes the meeting, without audio", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('big', $1, 'Long call', 'transcribed', 'bot_big')",
      [OWNER],
    );
    await ingest(db, "big");
    const published = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.finish_ingest('big') as ok",
    );
    expect(published[0]?.ok).toBe(true);
    const row = await db.query<{ status: string; audio_path: string | null }>(
      "select status, audio_path from public.meetings where id = 'big'",
    );
    expect(row.rows[0]).toEqual({ status: "ready", audio_path: null });
  });
});

describe("scale hardening", () => {
  const JOB = (n: number) => `00000000-0000-4000-8000-0000000000${n.toString().padStart(2, "0")}`;

  it("queue_status counts due, scheduled, running and recently failed jobs, and the oldest wait", async () => {
    await addMeeting(db, "q1");
    await addMeeting(db, "q2");
    await addMeeting(db, "q3");
    // The ingest queued analyze and summarize for each; the picture below is the whole queue.
    await db.query("delete from public.processing_jobs");
    await db.query(
      `insert into public.processing_jobs (id, meeting_id, kind, status, run_after, claim_token, lease_until, finished_at) values
         ($1, 'q1', 'analyze', 'queued', now() - interval '10 minutes', null, null, null),
         ($2, 'q2', 'analyze', 'queued', now() + interval '1 hour', null, null, null),
         ($3, 'q3', 'analyze', 'running', now(), gen_random_uuid(), now() + interval '5 minutes', null),
         ($4, 'q1', 'summarize', 'failed', now(), null, null, now() - interval '2 hours'),
         ($5, 'q2', 'summarize', 'failed', now(), null, null, now() - interval '3 days'),
         ($6, 'q3', 'summarize', 'done', now(), null, null, now())`,
      [JOB(1), JOB(2), JOB(3), JOB(4), JOB(5), JOB(6)],
    );
    const [status] = await as<{
      runnable: string;
      scheduled: string;
      running: string;
      failed_day: string;
      oldest_runnable_sec: string;
    }>(db, { role: "service_role" }, "select * from public.queue_status()");
    expect(Number(status?.runnable)).toBe(1);
    expect(Number(status?.scheduled)).toBe(1);
    expect(Number(status?.running)).toBe(1);
    expect(Number(status?.failed_day)).toBe(1);
    expect(Number(status?.oldest_runnable_sec)).toBeGreaterThanOrEqual(600);
    await expect(
      as(db, { role: "authenticated", userId: VISITOR }, "select * from public.queue_status()"),
    ).rejects.toThrow(/permission denied/);
  });

  it("prune_finished_jobs removes old finished jobs and nothing else", async () => {
    await addMeeting(db, "p1");
    await db.query("delete from public.processing_jobs");
    await db.query(
      `insert into public.processing_jobs (id, meeting_id, kind, status, finished_at) values
         ($1, 'p1', 'analyze', 'done', now() - interval '40 days'),
         ($2, 'p1', 'summarize', 'failed', now() - interval '40 days'),
         ($3, 'p1', 'learn', 'done', now() - interval '40 days'),
         ($4, 'p1', 'ingest_media', 'failed', now() - interval '40 days'),
         ($5, 'p1', 'detect_commands', 'done', now() - interval '1 day'),
         ($6, 'p1', 'detect_commands', 'queued', null)`,
      [JOB(1), JOB(2), JOB(3), JOB(4), JOB(5), JOB(6)],
    );
    const [pruned] = await as<{ n: number }>(
      db,
      { role: "service_role" },
      "select public.prune_finished_jobs('30 days') as n",
    );
    expect(pruned?.n).toBe(4);
    const left = await db.query<{ kind: string; status: string }>(
      "select kind, status from public.processing_jobs where meeting_id = 'p1' order by status",
    );
    expect(left.rows).toEqual([
      { kind: "detect_commands", status: "done" },
      { kind: "detect_commands", status: "queued" },
    ]);
  });

  it("a skipped job ends as done without applying anything, for its claim only", async () => {
    await addMeeting(db, "s1");
    const job = await claim(db, ["analyze"]);
    expect(job?.kind).toBe("analyze");
    const wrong = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.complete_job($1, gen_random_uuid(), 'skipped') as ok",
      [job!.id],
    );
    expect(wrong[0]?.ok).toBe(false);
    expect(await complete(db, job!, "skipped", null)).toBe(true);
    const row = await db.query<{ status: string }>(
      "select status from public.processing_jobs where id = $1",
      [job!.id],
    );
    expect(row.rows[0]?.status).toBe("done");
    // Nothing was applied: the meeting has no items and no mark of a generation.
    const meeting = await db.query<{ analyzed_at: string | null; n: string | number }>(
      "select m.analyzed_at, (select count(*) from public.meeting_items i where i.meeting_id = m.id) as n from public.meetings m where m.id = 's1'",
    );
    expect(meeting.rows[0]?.analyzed_at).toBeNull();
    expect(Number(meeting.rows[0]?.n)).toBe(0);
  });

  it("a meeting records when its notes were written, and a changed transcript clears the marks", async () => {
    await addMeeting(db, "g1");
    const job = await claim(db, ["analyze"]);
    expect(
      await complete(db, job!, "done", { headline: "", chapters: [], actions: [], decisions: [] }),
    ).toBe(true);
    const marked = await db.query<{ analyzed_at: string | null; summarized_at: string | null }>(
      "select analyzed_at, summarized_at from public.meetings where id = 'g1'",
    );
    expect(marked.rows[0]?.analyzed_at).not.toBeNull();
    expect(marked.rows[0]?.summarized_at).toBeNull();
    const longer = [
      ...turnsFor("g1"),
      { id: "g1-0003", speaker: "a", startSec: 12, endSec: 13, text: "Bye." },
    ];
    expect((await ingest(db, "g1", longer, 13)).changed).toBe(true);
    const cleared = await db.query<{ analyzed_at: string | null }>(
      "select analyzed_at from public.meetings where id = 'g1'",
    );
    expect(cleared.rows[0]?.analyzed_at).toBeNull();
  });

  it("apply_typed_command returns the row it made, not a newer one from another path", async () => {
    await addMeeting(db, "t1", { owner: OWNER });
    // A model-backed typed command the route inserted directly, as if committed a moment later.
    await db.query(
      "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, created_at) values ('t1', 'typed', 'email', '/email Sam', 'detected', now() + interval '1 second')",
    );
    const [applied] = await as<{ id: string }>(
      db,
      { role: "service_role" },
      "select public.apply_typed_command('t1', $1) as id",
      [
        JSON.stringify({
          // No id: the route lets the function insert the row (an id means "update this one").
          turnId: null,
          source: "typed",
          kind: "decision",
          sentence: "/decision we launch on the twentieth",
          status: "applied",
          args: { text: "we launch on the twentieth" },
          item: { text: "we launch on the twentieth" },
        }),
      ],
    );
    const row = await db.query<{ kind: string }>(
      "select kind from public.meeting_commands where id = $1",
      [applied!.id],
    );
    expect(row.rows[0]?.kind).toBe("decision");
  });

  it("the hot paths have their indexes", async () => {
    const rows = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname in
         ('processing_jobs_running_lease_idx', 'processing_jobs_finished_idx', 'item_states_owner_idx',
          'meetings_title_tsv_idx', 'meetings_list_order_idx', 'live_utterances_received_idx')
       order by indexname`,
    );
    expect(rows.rows.map((row) => row.indexname)).toHaveLength(6);
  });
});

describe("review fixes, second round", () => {
  const visitor = { role: "authenticated", userId: VISITOR } as const;
  const service = { role: "service_role" } as const;

  it("caps bot requests per place as well as per identity", async () => {
    const users = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-0000000000b${i}`);
    for (const id of users) await createUser(db, id);
    const key = "a".repeat(32);
    const send = (i: number) =>
      db.query(
        "insert into public.meetings (id, owner_id, title, status, source, sender_key) values ($1, $2, 'Call', 'requested', '{\"kind\": \"bot\"}', $3)",
        [`bot${i}`, users[i], key],
      );
    for (let i = 0; i < 5; i++) await send(i);
    await expect(send(5)).rejects.toThrow(/from one place/);
  });

  it("the expiry sweep queues the notes after a parse that will not finish, and fails a live question", async () => {
    await addMeeting(db, "x1", { owner: OWNER });
    await db.query("delete from public.processing_jobs");
    await db.query(
      "insert into public.processing_jobs (meeting_id, kind, status, attempts, max_attempts, claim_token, lease_until) values ('x1', 'detect_commands', 'running', 3, 3, gen_random_uuid(), now() - interval '1 minute')",
    );
    const command = await db.query<{ id: string }>(
      "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval, live_seq) values ('x1', 'live', 'ask', 'AFK, what did we decide?', 'detected', false, 1) returning id",
    );
    await db.query(
      "insert into public.processing_jobs (meeting_id, kind, command_id, status, attempts, max_attempts, claim_token, lease_until) values ('x1', 'answer_in_meeting', $1, 'running', 2, 2, gen_random_uuid(), now() - interval '1 minute')",
      [command.rows[0]!.id],
    );
    // Any claim runs the sweep first; 'learn' matches no job, so nothing is taken.
    expect(await claim(db, ["learn"])).toBeUndefined();
    const jobs = await db.query<{ kind: string; status: string }>(
      "select kind, status from public.processing_jobs where meeting_id = 'x1' order by kind, status",
    );
    expect(jobs.rows).toEqual([
      { kind: "analyze", status: "queued" },
      { kind: "answer_in_meeting", status: "failed" },
      { kind: "detect_commands", status: "failed" },
      { kind: "summarize", status: "queued" },
    ]);
    const asked = await db.query<{ status: string }>(
      "select status from public.meeting_commands where id = $1",
      [command.rows[0]!.id],
    );
    expect(asked.rows[0]?.status).toBe("failed");
  });

  it("a shared clip names only the speakers heard in it", async () => {
    await addMeeting(db, "seed1");
    // The turns: a at 0-5, b at 4-9, a at 10-12. A clip of the end hears a alone.
    const [highlight] = await as<{ id: string }>(
      db,
      visitor,
      "insert into public.highlights (meeting_id, start_sec, end_sec) values ('seed1', 9.5, 12) returning id",
    );
    const [minted] = await as<{ token: string }>(
      db,
      visitor,
      "insert into public.share_links (token, highlight_id) values ($1, $2) returning token",
      ["1".repeat(64), highlight!.id],
    );
    const [shared] = await as<{ clip: { speakers: { code: string }[] } }>(
      db,
      { role: "anon" },
      "select public.get_shared_clip($1) as clip",
      [minted!.token],
    );
    expect(shared?.clip.speakers.map((speaker) => speaker.code)).toEqual(["a"]);
  });

  it("access requests count against the visitor's write limit", async () => {
    for (let i = 0; i < 60; i++) await as(db, visitor, "select public.note_visitor_write()");
    await expect(
      as(db, visitor, "insert into public.access_requests (email) values ('someone@example.com')"),
    ).rejects.toThrow(/too many changes/);
  });

  it("a command that ran cannot be dismissed", async () => {
    await addMeeting(db, "d1", { owner: OWNER });
    const command = await db.query<{ id: string }>(
      "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval) values ('d1', 'typed', 'email', '/email Sam', 'done', true) returning id",
    );
    const [dismissed] = await as<{ ok: boolean }>(
      db,
      service,
      "select public.dismiss_command($1) as ok",
      [command.rows[0]!.id],
    );
    expect(dismissed?.ok).toBe(false);
  });

  it("a live utterance with a malformed command is a fault, not a swallowed cap", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('live1', $1, 'Live', 'recording', 'bot_live1')",
      [OWNER],
    );
    await expect(
      as(
        db,
        service,
        "select * from public.record_live_utterance('bot_live1', 'k1', 'Haris', 'u1', true, 1000, 500, 'AFK, what did we decide?', '{\"kind\": \"question\"}')",
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("a guest can neither change nor erase a memory file, even one written for them", async () => {
    const GUEST = "00000000-0000-4000-8000-0000000000c1";
    await createUser(db, GUEST, { anonymous: true });
    await db.query(
      "insert into public.memory_files (owner_id, path, content, updated_by) values ($1, 'profile.md', '# Me', 'you')",
      [GUEST],
    );
    const guest = { role: "authenticated", userId: GUEST, isAnonymous: true } as const;
    expect(
      await as(
        db,
        guest,
        "update public.memory_files set content = 'x' where path = 'profile.md' returning path",
      ),
    ).toEqual([]);
    expect(
      await as(
        db,
        guest,
        "delete from public.memory_files where path = 'profile.md' returning path",
      ),
    ).toEqual([]);
  });

  it("search finds a word that appears only in a meeting's title", async () => {
    await db.query(
      `insert into public.meetings (id, title, status, duration_sec, transcript_hash) values ('zz', 'Zanzibar planning', 'ready', 12, '${"0".repeat(64)}')`,
    );
    const hits = await as<{ meeting_id: string; kind: string }>(
      db,
      { role: "anon" },
      "select meeting_id, kind from public.search_meetings('Zanzibar')",
    );
    expect(hits).toEqual([{ meeting_id: "zz", kind: "title" }]);
  });
});

describe("video recordings", () => {
  it("publishes a bot meeting with its video at the provider, or the seed audio, never both", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id) values ('vid', $1, 'A call', 'transcribed', 'bot_vid1234')",
      [OWNER],
    );
    await ingest(db, "vid");
    const published = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.finish_ingest('vid', null, 'bot_vid1234') as ok",
    );
    expect(published[0]?.ok).toBe(true);
    const row = await db.query<{
      status: string;
      audio_path: string | null;
      video_ref: string | null;
    }>("select status, audio_path, video_ref from public.meetings where id = 'vid'");
    expect(row.rows[0]).toEqual({ status: "ready", audio_path: null, video_ref: "bot_vid1234" });
    // One recording per meeting: an audio object cannot be added beside the video.
    await expect(
      db.query("update public.meetings set audio_path = 'vid/v1.m4a' where id = 'vid'"),
    ).rejects.toThrow(/meetings_one_recording/);
    // A second publish changes nothing: the meeting is no longer awaiting its ingest.
    const again = await as<{ ok: boolean }>(
      db,
      { role: "service_role" },
      "select public.finish_ingest('vid', null, 'bot_other123') as ok",
    );
    expect(again[0]?.ok).toBe(false);
    // The owner reads the reference the page mints the link from; a stranger finds nothing.
    const owner = await as<{ video_ref: string }>(
      db,
      { role: "authenticated", userId: OWNER },
      "select video_ref from public.meetings where id = 'vid'",
    );
    expect(owner).toEqual([{ video_ref: "bot_vid1234" }]);
    const stranger = await as(
      db,
      { role: "authenticated", userId: STRANGER },
      "select video_ref from public.meetings where id = 'vid'",
    );
    expect(stranger).toEqual([]);
    // The seed path is unchanged: audio of its own, no video.
    await db.query(
      "insert into public.meetings (id, title, status) values ('aud', 'A sample', 'transcribed')",
    );
    await ingest(db, "aud");
    await as(db, { role: "service_role" }, "select public.finish_ingest('aud', 'aud/v1.m4a')");
    const seed = await db.query<{ audio_path: string | null; video_ref: string | null }>(
      "select audio_path, video_ref from public.meetings where id = 'aud'",
    );
    expect(seed.rows[0]).toEqual({ audio_path: "aud/v1.m4a", video_ref: null });
  });
});

describe("contacts and skills", () => {
  const google = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const stranger = { role: "authenticated", userId: STRANGER, isAnonymous: false } as const;
  const GUEST = "00000000-0000-4000-8000-00000000000a";
  const guest = { role: "authenticated", userId: GUEST, isAnonymous: true } as const;
  const learn = (owner: string, people: unknown[], source: string, used = true) =>
    as<{ learn_contacts: number }>(
      db,
      { role: "service_role" },
      "select public.learn_contacts($1, $2, $3, $4)",
      [owner, JSON.stringify(people), source, used],
    );

  it("learns people: a new address with its source, a known one counts a use and keeps the other name; guests learn nothing", async () => {
    await createUser(db, GUEST, { anonymous: true });
    const first = await learn(
      OWNER,
      [
        { name: "Sam Lee", email: "Sam@Example.com" },
        { email: "lee.chan@acme.io" },
        { name: "Nobody", email: "not an address" },
      ],
      "approval",
    );
    expect(first[0]?.learn_contacts).toBe(2);
    await learn(OWNER, [{ name: "Sam", email: "sam@example.com" }], "approval");
    await learn(OWNER, [{ name: "Samuel", email: "sam@example.com" }], "google_contacts", false);
    await learn(OWNER, [{ name: "Shumail", email: "shumail@example.com" }], "calendar", false);
    const rows = await as<{
      name: string;
      email: string;
      aliases: string[];
      source: string;
      uses: number;
    }>(db, google, "select name, email, aliases, source, uses from public.contacts order by email");
    expect(rows).toEqual([
      { name: "Lee Chan", email: "lee.chan@acme.io", aliases: [], source: "approval", uses: 1 },
      {
        name: "Sam Lee",
        email: "sam@example.com",
        aliases: ["Sam", "Samuel"],
        source: "approval",
        uses: 2,
      },
      { name: "Shumail", email: "shumail@example.com", aliases: [], source: "calendar", uses: 0 },
    ]);
    expect((await learn(GUEST, [{ email: "g@example.com" }], "approval"))[0]?.learn_contacts).toBe(
      0,
    );
    await expect(learn(OWNER, [{ email: "x@example.com" }], "scraped")).rejects.toThrow(/source/);
    // Theirs alone: a stranger and a guest see none; the owner deletes; nobody inserts from the browser.
    expect(await as(db, stranger, "select email from public.contacts")).toEqual([]);
    expect(await as(db, guest, "select email from public.contacts")).toEqual([]);
    await as(db, google, "delete from public.contacts where email = 'lee.chan@acme.io'");
    expect(await as(db, google, "select email from public.contacts order by email")).toEqual([
      { email: "sam@example.com" },
      { email: "shumail@example.com" },
    ]);
    await expect(
      as(
        db,
        google,
        "insert into public.contacts (owner_id, email, name, source) values ($1, 'x@example.com', 'X', 'approval')",
        [OWNER],
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it("finish_command learns the people a confirmed card went to", async () => {
    await addMeeting(db, "cm", { owner: OWNER });
    const inserted = await db.query<{ id: string }>(
      "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval, args, approved_args) values ('cm', 'typed', 'email', '/email Sam', 'approved', true, '{}', '{}') returning id",
    );
    const id = inserted.rows[0]!.id;
    await as(db, { role: "service_role" }, "select public.finish_command($1, $2)", [
      id,
      JSON.stringify({
        result: { kind: "email", to: ["sam@example.com"], subject: "s", messageId: "m" },
        line: '- [2026-10-26 00:00] Sent "s" to sam@example.com',
        provider: "google",
        learned: [{ name: "Sam", email: "sam@example.com" }],
      }),
    ]);
    expect(await as(db, google, "select name, email, uses from public.contacts")).toEqual([
      { name: "Sam", email: "sam@example.com", uses: 1 },
    ]);
    const command = await db.query<{ status: string }>(
      "select status from public.meeting_commands where id = $1",
      [id],
    );
    expect(command.rows[0]?.status).toBe("done");
  });

  it("rewrite_command sends a draft back to the parser with the note, for its owner only, once", async () => {
    await addMeeting(db, "rw", { owner: OWNER });
    const inserted = await db.query<{ id: string }>(
      `insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval, args) values ('rw', 'typed', 'email', '/email Sam', 'proposed', true, '{"toNames": ["Sam"]}') returning id`,
    );
    const id = inserted.rows[0]!.id;
    expect(await as(db, stranger, "select public.rewrite_command($1, 'shorter')", [id])).toEqual([
      { rewrite_command: false },
    ]);
    expect(await as(db, google, "select public.rewrite_command($1, '  shorter ')", [id])).toEqual([
      { rewrite_command: true },
    ]);
    const row = await db.query<{ status: string; args: unknown }>(
      "select status, args from public.meeting_commands where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({
      status: "detected",
      args: { toNames: ["Sam"], rewriteNote: "shorter" },
    });
    const jobs = await db.query<{ status: string }>(
      "select status from public.processing_jobs where meeting_id = 'rw' and kind = 'detect_commands'",
    );
    expect(jobs.rows).toEqual([{ status: "queued" }]);
    // Back in the queue it cannot be sent back again until the parse returns it.
    expect(await as(db, google, "select public.rewrite_command($1, 'again')", [id])).toEqual([
      { rewrite_command: false },
    ]);
  });

  it("the three skills are memory files like the others, and no other path is", async () => {
    await as(
      db,
      google,
      "insert into public.memory_files (owner_id, path, content) values ($1, 'skills/email.md', '- Tone: terse')",
      [OWNER],
    );
    await expect(
      as(
        db,
        google,
        "insert into public.memory_files (owner_id, path, content) values ($1, 'skills/other.md', 'x')",
        [OWNER],
      ),
    ).rejects.toThrow(/check/);
  });
});

describe("the wrap-up", () => {
  const google = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const stranger = { role: "authenticated", userId: STRANGER, isAnonymous: false } as const;

  it("review_meeting records Done and the verdict for the owner's ready meeting only", async () => {
    await addMeeting(db, "wrap", { owner: OWNER });
    await addMeeting(db, "notready", { owner: OWNER, ready: false });
    expect(await as(db, stranger, "select public.review_meeting('wrap', 'good', null)")).toEqual([
      { review_meeting: false },
    ]);
    expect(await as(db, google, "select public.review_meeting('notready', null, null)")).toEqual([
      { review_meeting: false },
    ]);
    expect(await as(db, google, "select public.review_meeting('wrap', null, null)")).toEqual([
      { review_meeting: true },
    ]);
    expect(
      await as(db, google, "select public.review_meeting('wrap', 'bad', '  too long  ')"),
    ).toEqual([{ review_meeting: true }]);
    const row = await db.query<{ reviewed: boolean; rating: string; review_note: string }>(
      "select reviewed_at is not null as reviewed, rating, review_note from public.meetings where id = 'wrap'",
    );
    expect(row.rows[0]).toEqual({ reviewed: true, rating: "bad", review_note: "too long" });
    await expect(
      as(db, google, "select public.review_meeting('wrap', 'meh', null)"),
    ).rejects.toThrow(/good or bad/);
  });
});

describe("the note to the owner, the nudge and scheduled bots", () => {
  const google = { role: "authenticated", userId: OWNER, isAnonymous: false } as const;
  const stranger = { role: "authenticated", userId: STRANGER, isAnonymous: false } as const;

  it("queues notify_owner after the notes of a Google user's meeting, not a guest's", async () => {
    const GUEST = "00000000-0000-4000-8000-00000000000a";
    await createUser(db, GUEST, { anonymous: true });
    await addMeeting(db, "own", { owner: OWNER });
    await addMeeting(db, "gst", { owner: GUEST });
    for (const id of ["own", "gst"]) {
      await db.query(
        "insert into public.processing_jobs (meeting_id, kind) values ($1, 'summarize') on conflict do nothing",
        [id],
      );
      const job = (
        await as<Job>(
          db,
          { role: "service_role" },
          "select * from public.claim_job('w1', array['summarize'], 300, $1)",
          [id],
        )
      )[0]!;
      expect(await complete(db, job, "done", { templates: [] })).toBe(true);
    }
    const notify = await db.query<{ meeting_id: string }>(
      "select meeting_id from public.processing_jobs where kind = 'notify_owner' order by meeting_id",
    );
    expect(notify.rows.map((row) => row.meeting_id)).toEqual(["own"]);
  });

  it("snooze_wrap_up stamps the owner's meeting only", async () => {
    await addMeeting(db, "nudge", { owner: OWNER });
    expect(await as(db, stranger, "select public.snooze_wrap_up('nudge')")).toEqual([
      { snooze_wrap_up: false },
    ]);
    expect(await as(db, google, "select public.snooze_wrap_up('nudge')")).toEqual([
      { snooze_wrap_up: true },
    ]);
    const row = await db.query<{ nudged: boolean }>(
      "select nudged_at is not null as nudged from public.meetings where id = 'nudge'",
    );
    expect(row.rows[0]?.nudged).toBe(true);
  });

  it("a scheduled bot does not block sending another, is one per calendar event, ends like any other, and is swept six hours after its time", async () => {
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, calendar_event_id, source) values ('sch', $1, 'Tomorrow', 'scheduled', 'bot_sched0001', now() + interval '1 day', 'evt_1', '{\"kind\":\"bot\",\"platform\":\"meet\"}')",
      [OWNER],
    );
    // Another bot now, while one is scheduled: allowed (the one-active rule skips scheduled).
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, source) values ('now', $1, 'Now', 'requested', 'bot_now00001', '{\"kind\":\"bot\",\"platform\":\"meet\"}')",
      [OWNER],
    );
    // The same calendar event twice: refused.
    await expect(
      db.query(
        "insert into public.meetings (id, owner_id, title, status, scheduled_for, calendar_event_id, source) values ('dup', $1, 'Again', 'scheduled', now() + interval '1 day', 'evt_1', '{\"kind\":\"bot\",\"platform\":\"meet\"}')",
        [OWNER],
      ),
    ).rejects.toThrow(/meetings_one_bot_per_calendar_event/);
    // The scheduled one's call ends: transcribed, with the ingest queued.
    const finished = await as<{ mark_bot_finished: string }>(
      db,
      { role: "service_role" },
      "select public.mark_bot_finished('bot_sched0001', true)",
    );
    expect(finished[0]?.mark_bot_finished).toBe("sch");
    // A scheduled bot whose time passed six hours ago with no word: swept, the other left.
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, source) values ('old', $1, 'Missed', 'scheduled', 'bot_old000001', now() - interval '7 hours', '{\"kind\":\"bot\",\"platform\":\"meet\"}')",
      [OWNER],
    );
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, source) values ('soon', $1, 'Soon', 'scheduled', 'bot_soon00001', now() + interval '2 hours', '{\"kind\":\"bot\",\"platform\":\"meet\"}')",
      [OWNER],
    );
    const swept = await as<{ sweep_stale_bots: number }>(
      db,
      { role: "service_role" },
      "select public.sweep_stale_bots()",
    );
    expect(swept[0]?.sweep_stale_bots).toBe(1);
    const statuses = await db.query<{ id: string; status: string }>(
      "select id, status from public.meetings where id in ('old', 'soon') order by id",
    );
    expect(statuses.rows).toEqual([
      { id: "old", status: "failed" },
      { id: "soon", status: "scheduled" },
    ]);
  });
});

describe("a meeting's address (2026-10-30)", () => {
  const google: Caller = { role: "authenticated", userId: OWNER, isAnonymous: false };
  const stranger: Caller = { role: "authenticated", userId: STRANGER, isAnonymous: false };
  const service: Caller = { role: "service_role" };
  const KEY = "0123456789abcdef0123456789abcdef";
  const OTHER_KEY = "ffffffffffffffffffffffffffffffff";
  type Opened = { ok: boolean; reason?: string; meetingId?: string; triesLeft?: number };
  const readLink = () =>
    as<{ code: string; pin: string; enabled: boolean }>(
      db,
      google,
      "select code, pin, enabled from public.meeting_links where meeting_id = 'ml'",
      [],
    );
  const open = async (code: string, pin: string, key = KEY) =>
    (
      await as<{ open_meeting_link: Opened }>(
        db,
        service,
        "select public.open_meeting_link($1, $2, $3)",
        [code, pin, key],
      )
    )[0]!.open_meeting_link;

  it("is made with the meeting, read by its owner alone, and changed by the owner alone", async () => {
    await addMeeting(db, "ml", { owner: OWNER });
    const [link] = await readLink();
    expect(link?.code).toMatch(/^[a-z0-9]{12}$/);
    expect(link?.pin).toMatch(/^[0-9]{4}$/);
    expect(link?.enabled).toBe(true);
    expect(await as(db, stranger, "select code from public.meeting_links", [])).toEqual([]);
    // The anonymous role has no grant at all; a visitor's own identity sees only its own.
    await expect(
      as(db, { role: "anon" }, "select code from public.meeting_links", []),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, google, "update public.meeting_links set enabled = false", []),
    ).rejects.toThrow(/permission denied/);
    const rotate = (caller: Caller) =>
      as<{ rotate_meeting_link: boolean }>(
        db,
        caller,
        "select public.rotate_meeting_link('ml')",
        [],
      );
    expect((await rotate(stranger))[0]?.rotate_meeting_link).toBe(false);
    expect((await rotate(google))[0]?.rotate_meeting_link).toBe(true);
    const [rotated] = await readLink();
    expect(rotated?.code).not.toBe(link?.code);
    expect(rotated?.enabled).toBe(true);
    const off = await as<{ set_meeting_link_enabled: boolean }>(
      db,
      google,
      "select public.set_meeting_link_enabled('ml', false)",
      [],
    );
    expect(off[0]?.set_meeting_link_enabled).toBe(true);
    expect((await readLink())[0]?.enabled).toBe(false);
  });

  it("opens with the PIN, counts wrong tries per visitor, locks after five, and answers alike for unknown or switched-off codes", async () => {
    await addMeeting(db, "ml", { owner: OWNER });
    const [link] = await readLink();
    const wrongPin = link!.pin === "0000" ? "0001" : "0000";
    expect(await open(link!.code, wrongPin)).toEqual({ ok: false, reason: "wrong", triesLeft: 4 });
    for (let i = 0; i < 3; i += 1) await open(link!.code, wrongPin);
    expect(await open(link!.code, wrongPin)).toMatchObject({ ok: false, reason: "locked" });
    // Locked: the right PIN is refused for this visitor; another visitor gets in at once.
    expect(await open(link!.code, link!.pin)).toMatchObject({ ok: false, reason: "locked" });
    expect(await open(link!.code, link!.pin, OTHER_KEY)).toEqual({ ok: true, meetingId: "ml" });
    // An unknown code and a switched-off link read as a wrong PIN.
    expect(await open("zzzzzzzzzzzz", "1234", OTHER_KEY)).toMatchObject({
      ok: false,
      reason: "wrong",
    });
    await as(db, google, "select public.set_meeting_link_enabled('ml', false)", []);
    expect(await open(link!.code, link!.pin, OTHER_KEY)).toMatchObject({
      ok: false,
      reason: "wrong",
    });
    // Tries older than a day are forgotten; the browser roles never see them.
    await db.query("update public.meeting_link_tries set updated_at = now() - interval '2 days'");
    const pruned = await as<{ prune_link_tries: number }>(
      db,
      service,
      "select public.prune_link_tries()",
      [],
    );
    expect(pruned[0]?.prune_link_tries).toBeGreaterThanOrEqual(2);
    await expect(as(db, google, "select code from public.meeting_link_tries", [])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("shows a link holder the meeting, the transcript and the summary, and nothing of the owner's", async () => {
    await addMeeting(db, "ml", { owner: OWNER });
    const point = await db.query<{ id: string }>(
      "insert into public.meeting_items (meeting_id, kind, source, template_key, section_idx, section, idx, text) values ('ml', 'point', 'ai', 'catch_up', 0, 'What you missed', 0, 'The date moved') returning id",
    );
    await db.query(
      "insert into public.item_citations (item_id, meeting_id, turn_id) values ($1, 'ml', 'ml-0000')",
      [point.rows[0]!.id],
    );
    await db.query(
      "insert into public.meeting_items (meeting_id, kind, source, idx, text) values ('ml', 'note', 'command', 0, 'Blue option'), ('ml', 'action', 'ai', 0, 'Send the deck')",
    );
    const [link] = await readLink();
    type Shared = {
      meeting: { id: string; title: string };
      turns: unknown[];
      items: Array<{ kind: string; turnIds: string[] }>;
    } | null;
    const read = async (caller: Caller) =>
      (
        await as<{ get_shared_meeting: Shared }>(
          db,
          caller,
          "select public.get_shared_meeting($1)",
          [link!.code],
        )
      )[0]!.get_shared_meeting;
    const shared = await read(service);
    expect(shared?.meeting).toMatchObject({ id: "ml", title: "Meeting ml" });
    expect(shared?.turns).toHaveLength(3);
    expect(shared?.items.map((item) => item.kind).sort()).toEqual(["note", "point"]);
    expect(shared?.items.find((item) => item.kind === "point")?.turnIds).toEqual(["ml-0000"]);
    expect(JSON.stringify(shared)).not.toContain(OWNER);
    expect(JSON.stringify(shared)).not.toContain("Send the deck");
    await as(db, google, "select public.set_meeting_link_enabled('ml', false)", []);
    expect(await read(service)).toBeNull();
    await expect(read(google)).rejects.toThrow(/permission denied/);
    await expect(read({ role: "anon" })).rejects.toThrow(/permission denied/);
  });
});

describe("fixes from the system-design study", () => {
  const service = { role: "service_role" } as const;

  it("a rejected output fails the job for good on its first attempt, with the follow-ups", async () => {
    // An owned meeting queues its command parse first.
    await addMeeting(db, "rj", { owner: OWNER });
    const parse = await claim(db, ["detect_commands"]);
    expect(parse?.attempts).toBe(1);
    expect(await complete(db, parse!, "rejected")).toBe(true);
    const jobs = await db.query<{ kind: string; status: string; finished: boolean }>(
      "select kind, status, finished_at is not null as finished from public.processing_jobs where meeting_id = 'rj' order by kind",
    );
    // Not queued again for a second paid run; the notes are still written.
    expect(jobs.rows).toEqual([
      { kind: "analyze", status: "queued", finished: false },
      { kind: "detect_commands", status: "failed", finished: true },
      { kind: "summarize", status: "queued", finished: false },
    ]);
    // Only a live claim can reject.
    expect(await complete(db, parse!, "rejected")).toBe(false);
  });

  it("a scheduled bot starts recording while another of the owner's bots is in a call", async () => {
    const bot = '{"kind":"bot","platform":"meet"}';
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, source) values ('live', $1, 'Now', 'recording', 'bot_live0001', $2)",
      [OWNER, bot],
    );
    await db.query(
      "insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, calendar_event_id, source) values ('cal', $1, 'Standup', 'scheduled', 'bot_cal00001', now(), 'evt_9', $2)",
      [OWNER, bot],
    );
    // The webhook's compare-and-set when the scheduled bot joins.
    await db.query(
      "update public.meetings set status = 'recording' where bot_id = 'bot_cal00001' and status in ('scheduled', 'requested')",
    );
    const statuses = await db.query<{ id: string; status: string }>(
      "select id, status from public.meetings where id in ('live', 'cal') order by id",
    );
    expect(statuses.rows).toEqual([
      { id: "cal", status: "recording" },
      { id: "live", status: "recording" },
    ]);
    // Its live utterances are heard while it records.
    const heard = await as<{ meeting_id: string | null }>(
      db,
      service,
      "select meeting_id from public.record_live_utterance('bot_cal00001', 'k1', 'Haris', 'u1', true, 1000, 500, 'Hello')",
    );
    expect(heard[0]?.meeting_id).toBe("cal");
    // Two bots sent now still cannot be in calls at once (a double click).
    await expect(
      db.query(
        "insert into public.meetings (id, owner_id, title, status, bot_id, source) values ('again', $1, 'Again', 'requested', 'bot_again001', $2)",
        [OWNER, bot],
      ),
    ).rejects.toThrow(/meetings_one_active_bot_per_owner/);
  });

  it("the cap on typed commands refuses the 21st with the error the routes map to 429", async () => {
    await addMeeting(db, "cap", { owner: OWNER });
    const insert = () =>
      db.query(
        "insert into public.meeting_commands (meeting_id, source, kind, sentence, status, needs_approval) values ('cap', 'typed', 'email', '/email x', 'detected', true)",
      );
    for (let i = 0; i < 20; i++) await insert();
    const refusal = await insert().then(
      () => null,
      (error: unknown) => error as { code?: string; message: string },
    );
    expect(refusal).not.toBeNull();
    expect(isTypedCommandCap(refusal!)).toBe(true);
  });

  it("start_job_effect lets a job's outside effect happen once across attempts, for the live claim only", async () => {
    await addMeeting(db, "fx", { owner: OWNER });
    const gate = async (job: Pick<Job, "id" | "claim_token">) =>
      (
        await as<{ gate: string }>(db, service, "select public.start_job_effect($1, $2) as gate", [
          job.id,
          job.claim_token,
        ])
      )[0]?.gate;
    const first = await claim(db, ["detect_commands"]);
    expect(await gate({ id: first!.id, claim_token: crypto.randomUUID() })).toBe("lost");
    expect(await gate(first!)).toBe("go");
    // The send happened, then the run failed before it could finish: the job is retried.
    await as(
      db,
      service,
      "select public.complete_job($1, $2, 'failed', null, 'connection reset')",
      [first!.id, first!.claim_token],
    );
    await db.query("update public.processing_jobs set run_after = now() where id = $1", [
      first!.id,
    ]);
    const second = await claim(db, ["detect_commands"]);
    expect(second?.id).toBe(first!.id);
    expect(second?.attempts).toBe(2);
    expect(await gate(second!)).toBe("done_before");
    // Nobody but the server asks.
    await expect(
      as(
        db,
        { role: "authenticated", userId: OWNER, isAnonymous: false },
        "select public.start_job_effect($1, $2)",
        [second!.id, second!.claim_token],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("fixes from the audit (2026-10-16)", () => {
  const service = { role: "service_role" } as const;
  const bot = '{"kind":"bot","platform":"meet"}';

  it("the sweep leaves a scheduled bot's call alone while it is recording, timing it from its scheduled time", async () => {
    // Scheduled two days ago for an hour ago: the bot joined on time and is still in the call.
    await db.query(
      `insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, calendar_event_id, source, created_at)
       values ('live-cal', $1, 'Standup', 'recording', 'bot_livecal01', now() - interval '1 hour', 'evt_live', $2, now() - interval '2 days')`,
      [OWNER, bot],
    );
    // Scheduled for seven hours ago and never heard from since: the call is long over.
    await db.query(
      `insert into public.meetings (id, owner_id, title, status, bot_id, scheduled_for, calendar_event_id, source, created_at)
       values ('gone-cal', $1, 'Retro', 'recording', 'bot_gonecal01', now() - interval '7 hours', 'evt_gone', $2, now() - interval '2 days')`,
      [STRANGER, bot],
    );
    const swept = (await as<{ n: number }>(db, service, "select public.sweep_stale_bots() as n"))[0]
      ?.n;
    expect(swept).toBe(1);
    const rows = await db.query<{ id: string; status: string }>(
      "select id, status from public.meetings where id in ('live-cal', 'gone-cal') order by id",
    );
    expect(rows.rows).toEqual([
      { id: "gone-cal", status: "failed" },
      { id: "live-cal", status: "recording" },
    ]);
    // The live call still ends the normal way, and its recording is ingested.
    const finished = await as<{ mark_bot_finished: string | null }>(
      db,
      service,
      "select public.mark_bot_finished('bot_livecal01', true)",
    );
    expect(finished[0]?.mark_bot_finished).toBe("live-cal");
    const ingest = await db.query<{ kind: string }>(
      "select kind from public.processing_jobs where meeting_id = 'live-cal'",
    );
    expect(ingest.rows).toEqual([{ kind: "ingest_media" }]);
  });
});
