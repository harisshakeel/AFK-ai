import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "./log";

/**
 * NFR Observability: log lines carry identifiers and counts, never content. The first
 * tests check the line the logger writes. The last reads every log call in the app and
 * the job runner and allows only field names that cannot hold what someone said or wrote:
 * no text, body, subject, address, argument or token ever reaches a log line.
 */
const ALLOWED_FIELDS = new Set([
  // identifiers
  "meetingId",
  "commandId",
  "jobId",
  "botId",
  "userId",
  "provider",
  "platform",
  "kind",
  "kinds",
  "model",
  "signal",
  // counts, durations and flags
  "files",
  "answered",
  "scopes",
  "meetings",
  "pruned",
  "swept",
  "purged",
  "queued",
  // the job runner's summary: how many jobs a kick ran and how they ended
  "ran",
  "done",
  "failed",
  "released",
  "attempt",
  "ms",
  "cap",
  "matched",
  "revoked",
  "isPublic",
  "gone",
  "until",
  "count",
  "hop",
  "runnable",
  "scheduled",
  "running",
  "jobsPruned",
  "utterancesPruned",
  "chained",
  "rated",
  // codes and enumerations (an outcome, an HTTP status, an error's name or class)
  "code",
  "status",
  "action",
  "outcome",
  "reason",
  "error",
  "report",
  "stop",
]);

const KEY = /[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && name !== "database.types.ts")
      yield path;
  }
}

/** The argument text of every log.info(…), log.warn(…), log.error(…) and the job runner's log(…). */
function logCalls(source: string): string[] {
  const calls: string[] = [];
  const opener = /(?<![\w.]|function )\blog(?:\.(?:info|warn|error))?\(/g;
  for (const match of source.matchAll(opener)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      index++;
    }
    calls.push(source.slice(start, index - 1));
  }
  return calls;
}

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with the level, the event, the time and the fields given", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("meeting.deleted", { meetingId: "bmr007", matched: true });
    expect(stdout).toHaveBeenCalledTimes(1);
    const line = JSON.parse(stdout.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "info", event: "meeting.deleted", meetingId: "bmr007" });
    expect(Object.keys(line).sort()).toEqual(["at", "event", "level", "matched", "meetingId"]);
    expect(new Date(line.at as string).getTime()).not.toBeNaN();
  });

  it("records an error's name and message only, not the error or its stack", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("webhook.update_failed", new RangeError("23505"), { botId: "bot_1" });
    const line = JSON.parse(stderr.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toEqual({
      level: "error",
      event: "webhook.update_failed",
      at: line.at,
      botId: "bot_1",
      errorName: "RangeError",
      errorMessage: "23505",
    });
    expect(JSON.stringify(line)).not.toContain("at ");
  });

  it("every log call in the app and the job runner names only identifiers, counts and codes", () => {
    const offending: string[] = [];
    let calls = 0;
    for (const root of ["src"]) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        const source = readFileSync(file, "utf8");
        for (const call of logCalls(source)) {
          calls++;
          for (const match of call.matchAll(KEY)) {
            const key = match[1]!;
            if (!ALLOWED_FIELDS.has(key)) {
              offending.push(`${relative(process.cwd(), file)}: "${key}" in log(${call.trim()})`);
            }
          }
        }
      }
    }
    // A field that could carry content (text, body, subject, address, args, a token)
    // must not be logged; name the id or the count instead, and add it to the list above.
    expect(offending).toEqual([]);
    expect(calls).toBeGreaterThan(40);
  });
});
