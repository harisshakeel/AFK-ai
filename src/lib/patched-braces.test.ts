import { createRequire } from "node:module";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * braces 3.0.3 (GHSA-vfj7-8cjw-p6xm): its AST walkers recurse once per nesting level, so
 * a pattern nested thousands deep, still under the length limit, exhausted the call
 * stack. No fixed release exists, so patches/braces@3.0.3.patch caps the nesting at 100
 * levels, beyond which a brace is literal text. This test reaches the package the way
 * the lint plugin does (eslint-config-next → fast-glob → micromatch → braces), so it
 * fails if the patch stops being applied.
 */
const require = createRequire(import.meta.url);
// Each package's main entry, resolved from the previous one's folder: exports maps hide
// package.json, but the entry is always reachable.
const resolveFrom = (name: string, from: string) =>
  require.resolve(name, { paths: [dirname(from)] });

const chain = ["eslint-config-next", "@next/eslint-plugin-next", "fast-glob", "micromatch"];
let at = require.resolve("./patched-braces.test.ts");
for (const name of chain) at = resolveFrom(name, at);
const bracesPath = require.resolve("braces", { paths: [dirname(at)] });
const braces = require(bracesPath) as {
  (pattern: string, options?: object): string[];
  expand(pattern: string, options?: object): string[];
};

describe("the patched braces", () => {
  it("survives a pattern nested thousands deep, which exhausted the stack before", () => {
    const deep = "{".repeat(4_999) + "}".repeat(4_999);
    let out: string[] = [];
    expect(() => {
      out = braces.expand(deep);
    }).not.toThrow();
    expect(out.length).toBeGreaterThan(0);
  });

  it("still expands ordinary patterns, including nesting up to the cap", () => {
    expect(braces.expand("src/{a,b}/{c,d}.ts")).toEqual([
      "src/a/c.ts",
      "src/a/d.ts",
      "src/b/c.ts",
      "src/b/d.ts",
    ]);
    expect(braces.expand("x{1..3}")).toEqual(["x1", "x2", "x3"]);
    expect(braces.expand("{a,{b,{c,{d,e}}}}")).toEqual(["a", "b", "c", "d", "e"]);
    expect(braces("a/{b,c}")).toEqual(["a/(b|c)"]);
  });
});
