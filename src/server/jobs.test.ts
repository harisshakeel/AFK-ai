import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Next.js reads a route's `maxDuration` statically, so it must be a literal, not the
 * constant the runner budgets by. This keeps the two equal: every function that runs
 * jobs after its response declares the runner's budget, and nothing declares it by name
 * (the production build refuses that with "Invalid segment configuration export").
 */
function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/^(route\.ts|page\.tsx)$/.test(name)) yield path;
  }
}

/** Read from the source: jobs.ts loads the validated environment, which a test has none of. */
function jobFunctionSeconds(): number {
  const source = readFileSync(join(process.cwd(), "src/server/jobs.ts"), "utf8");
  const match = /^export const JOB_FUNCTION_SECONDS = (\d+);$/m.exec(source);
  if (!match) throw new Error("JOB_FUNCTION_SECONDS not found in src/server/jobs.ts");
  return Number(match[1]);
}

describe("maxDuration on the routes that run jobs", () => {
  it("is the literal value of JOB_FUNCTION_SECONDS, never the constant by name", () => {
    const JOB_FUNCTION_SECONDS = jobFunctionSeconds();
    const literal: Array<[string, number]> = [];
    const byName: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src/app"))) {
      const source = readFileSync(file, "utf8");
      const name = relative(process.cwd(), file);
      const match = /^export const maxDuration = (.+);$/m.exec(source);
      if (!match) continue;
      if (/^\d+$/.test(match[1]!)) literal.push([name, Number(match[1])]);
      else byName.push(name);
    }
    expect(byName).toEqual([]);
    // A route that runs the queue after its response declares the runner's budget; one
    // that only talks to a provider (the bot, the contacts import) declares its own.
    let runners = 0;
    for (const [name, seconds] of literal) {
      const source = readFileSync(join(process.cwd(), name), "utf8");
      if (/\b(kickJobs|processAndChain)\(/.test(source)) {
        runners += 1;
        expect(seconds, name).toBe(JOB_FUNCTION_SECONDS);
      } else {
        expect(seconds, name).toBeLessThanOrEqual(JOB_FUNCTION_SECONDS);
      }
    }
    expect(runners).toBeGreaterThanOrEqual(6);
  });
});
