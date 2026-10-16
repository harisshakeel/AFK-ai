import { beforeEach, describe, expect, it, vi } from "vitest";

import { claimsFor, fakeClient, type FakeClient } from "@/test/fake-supabase";

// The validated environment is read when the route's modules load.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_000000";
});

// Only the edges are replaced: the two Supabase clients, the connector list, the job
// kick and the logger. The route's own checks, requireVisitor and the schemas run as
// written.
const state = vi.hoisted(() => ({
  visitor: null as unknown,
  admin: null as unknown,
  connectors: [] as unknown[],
}));
vi.mock("@/server/db/supabase-server", () => ({
  createSupabaseServerClient: async () => state.visitor,
}));
vi.mock("@/server/db/supabase-admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/server/connectors/store", () => ({ listConnectors: async () => state.connectors }));
vi.mock("@/server/jobs", () => ({ kickJobs: vi.fn() }));
vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { POST } = await import("./route");
const { kickJobs } = await import("@/server/jobs");

const OWNER = "00000000-0000-4000-8000-000000000001";
const COMMAND = "11111111-1111-4111-8111-111111111111";
const GMAIL = {
  id: "c1",
  provider: "google",
  account: "me@example.com",
  scopes: ["https://www.googleapis.com/auth/gmail.send"],
  config: {},
  status: "connected",
  connectedAt: "2026-10-16T00:00:00Z",
  lastUsedAt: null,
  expiresHintAt: null,
};
const emailArgs = {
  to: ["sam@example.com"],
  cc: [],
  subject: "Notes",
  body: "Hi Sam, the notes: https://afk.example/m/abcdefghjkmn (PIN 0420)",
};

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMAND,
    meeting_id: "m1",
    kind: "email",
    status: "proposed",
    needs_approval: true,
    approved_args: null,
    ...overrides,
  };
}

function setUp({
  kind = "google",
  rows = [command()],
  links = [{ code: "abcdefghjkmn", enabled: true }],
}: {
  kind?: "google" | "guest" | "none";
  rows?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
} = {}) {
  const visitor = fakeClient({
    claims: kind === "none" ? null : claimsFor(OWNER, kind),
    tables: { meeting_commands: rows, meeting_links: links },
  });
  const admin = fakeClient({
    tables: { meeting_commands: rows },
    rpc: {
      approve_command: { data: true, error: null },
      dismiss_command: { data: true, error: null },
    },
  });
  state.visitor = visitor;
  state.admin = admin;
  state.connectors = [GMAIL];
  return { visitor, admin };
}

const post = (body: unknown, id = COMMAND) =>
  POST(
    new Request(`https://afk.example/api/commands/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ commandId: id }) },
  );

const adminCalls = (admin: FakeClient) => admin.calls.map((call) => call.fn);

beforeEach(() => {
  vi.mocked(kickJobs).mockClear();
});

describe("POST /api/commands/[commandId]", () => {
  it("approves the owner's proposed card with the confirmed details, then kicks the runner", async () => {
    const { admin } = setUp();
    const response = await post({ action: "approve", args: emailArgs });
    expect(response.status).toBe(200);
    expect(admin.calls).toEqual([
      { fn: "approve_command", args: { p_command_id: COMMAND, p_args: emailArgs } },
    ]);
    expect(kickJobs).toHaveBeenCalledWith({ meetingId: "m1" });
  });

  it("answers 401 without a session and 404 for a card the visitor cannot read", async () => {
    const signedOut = setUp({ kind: "none" });
    expect((await post({ action: "approve", args: emailArgs })).status).toBe(401);
    // Another user's card: Row Level Security returns nothing, and nothing runs.
    const stranger = setUp({ rows: [] });
    expect((await post({ action: "approve", args: emailArgs })).status).toBe(404);
    expect([...adminCalls(signedOut.admin), ...adminCalls(stranger.admin)]).toEqual([]);
  });

  it("refuses a card that runs nothing, one already done, and a guest's approval", async () => {
    const ask = setUp({
      rows: [command({ kind: "ask", status: "failed", needs_approval: false })],
    });
    expect((await post({ action: "approve" })).status).toBe(409);
    const done = setUp({ rows: [command({ status: "done" })] });
    expect((await post({ action: "approve", args: emailArgs })).status).toBe(409);
    const guest = setUp({ kind: "guest" });
    expect((await post({ action: "approve", args: emailArgs })).status).toBe(403);
    expect([
      ...adminCalls(ask.admin),
      ...adminCalls(done.admin),
      ...adminCalls(guest.admin),
    ]).toEqual([]);
  });

  it("refuses details the kind's schema rejects, and a message whose meeting link is off", async () => {
    const bad = setUp();
    const invalid = await post({
      action: "approve",
      args: { ...emailArgs, to: ["not an address"] },
    });
    expect(invalid.status).toBe(400);
    const off = setUp({ links: [{ code: "abcdefghjkmn", enabled: false }] });
    const stale = await post({ action: "approve", args: emailArgs });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: expect.stringContaining("link") });
    expect([...adminCalls(bad.admin), ...adminCalls(off.admin)]).toEqual([]);
  });

  it("sends the owner to connect the app first when it is not connected", async () => {
    const { admin } = setUp();
    state.connectors = [];
    const response = await post({ action: "approve", args: emailArgs });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ connect: "/connectors" });
    expect(adminCalls(admin)).toEqual([]);
  });

  it("approves a Slack card with the channel picked on it, with no default channel saved", async () => {
    const { admin } = setUp({ rows: [command({ kind: "slack" })] });
    state.connectors = [{ ...GMAIL, id: "c2", provider: "slack", scopes: [], config: {} }];
    const args = { channelId: "C0123ABCD", channelName: "launch", message: "The deck is out" };
    expect((await post({ action: "approve", args })).status).toBe(200);
    expect(admin.calls.map((call) => call.fn)).toEqual(["approve_command"]);
  });

  it("answers a failed read as a failure, never as a card that is not there", async () => {
    const { admin } = setUp();
    state.visitor = fakeClient({
      claims: claimsFor(OWNER),
      errors: { meeting_commands: { code: "57014", message: "statement timeout" } },
    });
    expect((await post({ action: "approve", args: emailArgs })).status).toBe(500);
    expect(adminCalls(admin)).toEqual([]);
  });

  it("says why when the database refuses the approval: the card was dismissed meanwhile", async () => {
    setUp();
    state.admin = fakeClient({
      tables: { meeting_commands: [command({ status: "dismissed" })] },
      rpc: { approve_command: { data: false, error: null } },
    });
    const response = await post({ action: "approve", args: emailArgs });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("dismissed") });
  });

  it("dismisses through the database, which removes what the card created", async () => {
    const { admin } = setUp();
    expect((await post({ action: "dismiss" })).status).toBe(200);
    expect(adminCalls(admin)).toEqual(["dismiss_command"]);
    expect(kickJobs).not.toHaveBeenCalled();
  });
});
