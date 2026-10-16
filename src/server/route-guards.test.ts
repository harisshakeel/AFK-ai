import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route handler decides who may call it before it does anything: a session
 * (requireVisitor, requireUser, or the claims read directly), the cron secret, the
 * webhook signature, a meeting address's grant, or the OAuth state. The few that need
 * none say so here, with the reason, so a new route that forgets its check fails this
 * test instead of shipping open.
 */
const GUARDS = [
  "requireVisitor(",
  "requireUser(",
  "requireCronSecret(",
  "verifyWebhookSignature(",
  "verifyGrant(",
  "openConnectState(",
  "auth.getClaims(",
];

const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "counts only, throttled by the proxy",
  "src/app/auth/sign-out/route.ts": "ends the caller's own session; POST only",
  "src/app/api/m/[code]/pin/route.ts": "the PIN is the check (open_meeting_link)",
  "src/app/api/meetings/[meetingId]/media/route.ts": "reads the meeting under RLS as the caller",
};

/** The code without its comments: a guard named in a comment guards nothing. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function* routeFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* routeFiles(path);
    else if (name === "route.ts") yield path;
  }
}

describe("route handlers", () => {
  const routes = [...routeFiles(join(process.cwd(), "src/app"))].map((path) => ({
    path: relative(process.cwd(), path),
    source: readFileSync(path, "utf8"),
  }));

  it("each handler checks its caller, or its route is public and named here with its reason", () => {
    // Every exported method on its own: a second, unguarded handler in a guarded file fails.
    const unguarded = routes
      .filter(({ path }) => !(path in PUBLIC_ROUTES))
      .flatMap(({ path, source }) =>
        source
          .split(/(?=^export async function )/m)
          .filter((part) => part.startsWith("export async function "))
          .filter((handler) => !GUARDS.some((guard) => code(handler).includes(guard)))
          .map((handler) => `${path} ${/^export async function (\w+)/.exec(handler)?.[1]}`),
      );
    expect(unguarded).toEqual([]);
  });

  it("declares every handler as an exported async function, the form the check reads", () => {
    const other = routes
      .filter(({ source }) =>
        /^export (const|function) (GET|POST|PUT|PATCH|DELETE)\b/m.test(source),
      )
      .map(({ path }) => path);
    expect(other).toEqual([]);
  });

  it("names no public route that no longer exists", () => {
    const paths = new Set(routes.map(({ path }) => path));
    expect(Object.keys(PUBLIC_ROUTES).filter((path) => !paths.has(path))).toEqual([]);
  });

  it("reads a guard named only in a comment as no guard", () => {
    const handler =
      "export async function GET() {\n  // requireVisitor() is not needed here\n  return 1;\n}";
    expect(GUARDS.some((guard) => code(handler).includes(guard))).toBe(false);
  });

  it("finds the routes at all", () => {
    expect(routes.length).toBeGreaterThan(30);
  });
});
