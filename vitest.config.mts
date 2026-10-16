import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests cover logic (schemas, time maths, grounding checks). They run in Node;
// browser behaviour is covered by Playwright in e2e/.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts"],
    // PGlite boots a real Postgres per test; give it room on a cold start, in the
    // beforeEach hook that creates it as much as in the test itself.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The marker package throws outside React's server runtime; its own empty build
      // lets a server module (the logger) be unit-tested in Node.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
