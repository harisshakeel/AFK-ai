import { afterEach, describe, expect, it, vi } from "vitest";

import { GMAIL_SEND_URL } from "../connectors/gmail";
import { GOOGLE_TOKEN_URL } from "../connectors/google";
import { GOOGLE_GMAIL_SCOPE } from "../connectors/registry";
import { newTokenKey, sealSecret, tokenBinding } from "../connectors/token-crypto";
import { runAnswerInMeeting } from "./answer-in-meeting";
import type { Db, ProcessingDeps } from "./config";
import { TransientError, startJobEffect, type Job } from "./jobs";
import { runNotifyOwner } from "./notify-owner";

/**
 * Jobs whose work leaves the system (a chat line in the call, an email to the owner)
 * pass start_job_effect() first, so a retry after the line or the email went out does
 * not send it twice. The gate itself is tested against the schema; these check that
 * each handler asks it right before the send and obeys it.
 */
type Row = Record<string, unknown>;
type Gate = "go" | "done_before" | "lost";

function memoryDb(tables: Record<string, Row[]>, gate: Gate) {
  const rpcCalls: string[] = [];
  const query = (rows: Row[]) => {
    const builder = {
      select: () => builder,
      order: () => builder,
      update: () => builder,
      eq: (field: string, value: unknown) => query(rows.filter((row) => row[field] === value)),
      in: (field: string, values: unknown[]) =>
        query(rows.filter((row) => values.includes(row[field]))),
      limit: (count: number) => query(rows.slice(0, count)),
      range: (from: number, to: number) => query(rows.slice(from, to + 1)),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; count: number; error: null }) => unknown) =>
        Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve),
    };
    return builder;
  };
  const db = {
    from: (table: string) => query(tables[table] ?? []),
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return fn === "start_job_effect"
        ? { data: gate, error: null }
        : { data: null, error: { message: `no ${fn}` } };
    },
  } as unknown as Db;
  return { db, rpcCalls };
}

const OWNER = "00000000-0000-4000-8000-000000000003";
const COMMAND_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const job = (kind: string, commandId: string | null = null) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    meeting_id: "m1",
    attempts: 2,
    claim_token: "22222222-2222-4222-8222-222222222222",
    command_id: commandId,
  }) as unknown as Job;

const run = {
  model: "test",
  durationMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  costUsd: null,
};

function deps(db: Db, config: Partial<ProcessingDeps["config"]> = {}): ProcessingDeps {
  return {
    db,
    config: {
      workerId: "test",
      attendee: { apiKey: "test-key", baseUrl: "https://attendee.example" },
      connectorTokenKey: null,
      google: null,
      siteUrl: "https://afk.example",
      ...config,
    },
    claude: {
      runStructured: async () => ({
        data: { answer: "The launch is on the 20th.", cited: [0] },
        run,
      }),
    } as unknown as ProcessingDeps["claude"],
    log: () => {},
  };
}

/** Every request the handler makes, answered as the services would. */
function stubNetwork() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      if (url === GOOGLE_TOKEN_URL) {
        return Response.json({
          access_token: "access",
          expires_in: 3600,
          scope: GOOGLE_GMAIL_SCOPE,
        });
      }
      if (url === GMAIL_SEND_URL) return Response.json({ id: "msg1", threadId: "thr1" });
      return Response.json({});
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("answer_in_meeting", () => {
  const tables = () => ({
    meeting_commands: [
      {
        id: COMMAND_ID,
        meeting_id: "m1",
        kind: "ask",
        status: "detected",
        sentence: "AFK, when do we launch?",
        args: { question: "When do we launch?" },
        meetings: { title: "Launch", owner_id: OWNER, bot_id: "bot_1", status: "recording" },
      },
    ],
    live_utterances: [
      {
        meeting_id: "m1",
        seq: 0,
        speaker_name: "Sam",
        is_host: false,
        timestamp_ms: 1000,
        text: "We launch on the 20th.",
      },
    ],
    memory_files: [],
  });
  const chatPosts = (urls: string[]) => urls.filter((url) => url.includes("send_chat_message"));

  it("posts the answer in the chat once the gate says go", async () => {
    const urls = stubNetwork();
    const { db, rpcCalls } = memoryDb(tables(), "go");
    const result = await runAnswerInMeeting(deps(db), job("answer_in_meeting", COMMAND_ID));
    expect(rpcCalls).toEqual(["start_job_effect"]);
    expect(chatPosts(urls)).toHaveLength(1);
    expect(result?.payload).toMatchObject({ posted: true });
  });

  it("does not post a second time when an earlier attempt reached the chat, and still answers on the card", async () => {
    const urls = stubNetwork();
    const { db } = memoryDb(tables(), "done_before");
    const result = await runAnswerInMeeting(deps(db), job("answer_in_meeting", COMMAND_ID));
    expect(chatPosts(urls)).toEqual([]);
    expect(result?.payload).toMatchObject({ posted: false, text: expect.stringContaining("20th") });
  });

  it("does nothing once the claim has gone to another run", async () => {
    const urls = stubNetwork();
    const { db } = memoryDb(tables(), "lost");
    expect(await runAnswerInMeeting(deps(db), job("answer_in_meeting", COMMAND_ID))).toBeNull();
    expect(chatPosts(urls)).toEqual([]);
  });
});

describe("notify_owner", () => {
  const key = newTokenKey();
  const tables = () => ({
    meetings: [
      { id: "m1", owner_id: OWNER, title: "Launch planning", ai_headline: null, status: "ready" },
    ],
    memory_files: [],
    connectors: [
      {
        id: "c1",
        owner_id: OWNER,
        provider: "google",
        account: "owner@example.com",
        scopes: [GOOGLE_GMAIL_SCOPE],
        status: "connected",
        connector_secrets: {
          ciphertext: sealSecret("refresh", key, tokenBinding(OWNER, "google")),
        },
      },
    ],
    meeting_items: [],
    meeting_commands: [],
  });
  const config = { connectorTokenKey: key, google: { clientId: "id", clientSecret: "secret" } };
  const sends = (urls: string[]) => urls.filter((url) => url === GMAIL_SEND_URL);

  it("sends the note once the gate says go", async () => {
    const urls = stubNetwork();
    const { db, rpcCalls } = memoryDb(tables(), "go");
    const result = await runNotifyOwner(deps(db, config), job("notify_owner"));
    expect(rpcCalls).toEqual(["start_job_effect"]);
    expect(sends(urls)).toHaveLength(1);
    expect(result?.report).toMatchObject({ sent: true });
  });

  it("does not send again when an earlier attempt reached Gmail", async () => {
    const urls = stubNetwork();
    const { db } = memoryDb(tables(), "done_before");
    const result = await runNotifyOwner(deps(db, config), job("notify_owner"));
    expect(sends(urls)).toEqual([]);
    expect(result?.report).toMatchObject({ skipped: expect.any(String) });
  });

  it("does nothing once the claim has gone to another run", async () => {
    const urls = stubNetwork();
    const { db } = memoryDb(tables(), "lost");
    expect(await runNotifyOwner(deps(db, config), job("notify_owner"))).toBeNull();
    expect(sends(urls)).toEqual([]);
  });
});

describe("startJobEffect", () => {
  const withRpc = (answer: { data: unknown; error: { message: string } | null }) =>
    ({ rpc: async () => answer }) as unknown as Db;

  it("passes the gate's answer through, and treats anything else as a lost claim", async () => {
    for (const gate of ["go", "done_before", "lost"] as const) {
      expect(await startJobEffect(withRpc({ data: gate, error: null }), job("notify_owner"))).toBe(
        gate,
      );
    }
    expect(await startJobEffect(withRpc({ data: "maybe", error: null }), job("notify_owner"))).toBe(
      "lost",
    );
  });

  it("fails transiently when the gate cannot be asked: nothing was sent yet", async () => {
    await expect(
      startJobEffect(withRpc({ data: null, error: { message: "timeout" } }), job("notify_owner")),
    ).rejects.toBeInstanceOf(TransientError);
  });
});
