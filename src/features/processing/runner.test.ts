import { describe, expect, it, vi } from "vitest";

import type { Db, ProcessingDeps } from "./config";
import { runJobs, shouldChain } from "./runner";

/**
 * The runner's loop and its stop reasons, with a database stub that answers claim_job
 * and complete_job. Handlers are never reached: a job of an unknown kind fails inside
 * the loop, which is the path that exercises completion.
 */
function stubDeps(
  claims: Array<Record<string, unknown> | null>,
  options: {
    completeResults?: Array<{ data: boolean | null; error: { code: string } | null }>;
  } = {},
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
  const completeResults = [...(options.completeResults ?? [])];
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "claim_job") {
      const next = claims.shift() ?? null;
      return { data: next ? [next] : [], error: null };
    }
    if (fn === "complete_job") {
      return completeResults.shift() ?? { data: true, error: null };
    }
    return { data: null, error: { code: "42883" } };
  });
  // Every read answers "no row": a handler that looks a meeting up finds none.
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) query[method] = () => query;
  query.maybeSingle = async () => ({ data: null, error: null });
  const deps: ProcessingDeps = {
    // The stub answers the loop's calls and an empty read; nothing else is reached.
    db: { rpc, from: () => query } as unknown as Db,
    config: {
      workerId: "test",
      attendee: null,
      connectorTokenKey: null,
      google: null,
      siteUrl: "https://afk.example",
    },
    claude: {
      runStructured: async () => {
        throw new Error("not reached");
      },
    } as unknown as ProcessingDeps["claude"],
    log: () => {},
  };
  return { deps, calls };
}

const job = (kind: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind,
  meeting_id: "m1",
  attempts: 1,
  claim_token: "22222222-2222-4222-8222-222222222222",
  command_id: null,
});

describe("runJobs", () => {
  it("stops as idle when the queue has nothing, without completing anything", async () => {
    const { deps, calls } = stubDeps([null]);
    const summary = await runJobs(deps, { budgetMs: 120_000 });
    expect(summary).toEqual({ ran: 0, done: 0, failed: 0, released: 0, stop: "idle" });
    expect(calls.map((call) => call.fn)).toEqual(["claim_job"]);
  });

  it("stops on budget before claiming when there is no room for a run", async () => {
    const { deps, calls } = stubDeps([job("analyze")]);
    const summary = await runJobs(deps, { budgetMs: 30_000 });
    expect(summary.stop).toBe("budget");
    expect(calls).toEqual([]);
  });

  it("leases each job for no longer than the budget left plus the margin", async () => {
    const { deps, calls } = stubDeps([null]);
    await runJobs(deps, { budgetMs: 270_000, meetingId: "m9", kinds: ["run_command"] });
    const claim = calls[0]?.args;
    expect(claim?.p_meeting_id).toBe("m9");
    expect(claim?.p_kinds).toEqual(["run_command"]);
    // 270 s minus the 20 s headroom, plus the 60 s margin: at most 310 s, never 1800.
    expect(claim?.p_lease_seconds).toBeLessThanOrEqual(310);
    expect(claim?.p_lease_seconds).toBeGreaterThan(240);
  });

  it("stops without claiming once the signal is aborted", async () => {
    const { deps, calls } = stubDeps([job("analyze")]);
    const controller = new AbortController();
    controller.abort();
    const summary = await runJobs(deps, { budgetMs: 120_000, signal: controller.signal });
    expect(summary.stop).toBe("stopped");
    expect(calls).toEqual([]);
  });

  it("skips a job whose handler has nothing to publish, without failing it", async () => {
    // analyze on a meeting that is gone: the handler returns null.
    const { deps, calls } = stubDeps([job("analyze"), null]);
    const summary = await runJobs(deps, { budgetMs: 120_000 });
    expect(summary).toEqual({ ran: 1, done: 0, failed: 0, released: 0, stop: "idle" });
    expect(calls.map((call) => call.fn)).toEqual(["claim_job", "complete_job", "claim_job"]);
    expect(calls[1]?.args).toMatchObject({
      p_outcome: "skipped",
      p_claim_token: job("x").claim_token,
    });
  });

  it("rejects a job whose output the database refuses, so it is not run and paid for again", async () => {
    // ingest on a meeting not awaiting it answers with a report; the store of it fails.
    for (const code of ["23514", "22023", "P0001"]) {
      const { deps, calls } = stubDeps([job("ingest_media"), null], {
        completeResults: [
          { data: null, error: { code } },
          { data: true, error: null },
        ],
      });
      const summary = await runJobs(deps, { budgetMs: 120_000 });
      expect(summary).toEqual({ ran: 1, done: 0, failed: 1, released: 0, stop: "idle" });
      const outcomes = calls
        .filter((call) => call.fn === "complete_job")
        .map((call) => call.args?.p_outcome);
      expect(outcomes, code).toEqual(["done", "rejected"]);
    }
  });

  it("fails a job whose store broke for a reason a retry can mend, using an attempt", async () => {
    // A statement timeout or a dropped connection is not the output's fault.
    for (const code of ["57014", "40001", ""]) {
      const { deps, calls } = stubDeps([job("ingest_media"), null], {
        completeResults: [
          { data: null, error: { code } },
          { data: true, error: null },
        ],
      });
      await runJobs(deps, { budgetMs: 120_000 });
      const outcomes = calls
        .filter((call) => call.fn === "complete_job")
        .map((call) => call.args?.p_outcome);
      expect(outcomes, code).toEqual(["done", "failed"]);
    }
  });

  it("counts a job that throws as failed and completes it with the error, then carries on", async () => {
    const { deps, calls } = stubDeps([job("not_a_kind"), null]);
    const summary = await runJobs(deps, { budgetMs: 120_000 });
    expect(summary).toEqual({ ran: 1, done: 0, failed: 1, released: 0, stop: "idle" });
    const completion = calls.find((call) => call.fn === "complete_job")?.args;
    expect(completion?.p_outcome).toBe("failed");
    expect(completion?.p_claim_token).toBe(job("x").claim_token);
    expect(String(completion?.p_error)).toContain("unknown job kind");
  });
});

describe("shouldChain", () => {
  it("continues only after a budget stop with work due", () => {
    expect(shouldChain({ stop: "budget" }, 3)).toBe(true);
    expect(shouldChain({ stop: "budget" }, 0)).toBe(false);
    for (const stop of ["idle", "misconfigured", "provider", "claim_failed", "stopped"] as const) {
      expect(shouldChain({ stop }, 5), stop).toBe(false);
    }
  });
});
