import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { fetchAll } from "./fetch-all";

describe("fetchAll", () => {
  it("reads every page until a short one, past PostgREST's 1,000-row cap", async () => {
    const rows = Array.from({ length: 2_067 }, (_, index) => ({ index }));
    const asked: Array<[number, number]> = [];
    const all = await fetchAll(async (from, to) => {
      asked.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(all).toHaveLength(2_067);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("wraps a failed page in the caller's error", async () => {
    class Custom extends Error {}
    await expect(
      fetchAll(
        async () => ({ data: null, error: { message: "timeout" } }),
        (message) => new Custom(message),
      ),
    ).rejects.toBeInstanceOf(Custom);
  });
});

/**
 * A meeting can have more turns than PostgREST returns at once (the long seed meeting
 * has 1,067), so a read of a table that grows with the meeting must page: a plain
 * select sees the first 1,000 rows and nothing says so.
 */
describe("reads of the tables that grow with a meeting", () => {
  const PAGED_TABLES = ["transcript_turns", "live_utterances"];

  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* sourceFiles(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
    }
  }

  it("page through fetchAll with .range()", () => {
    const unpaged: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      if (file.endsWith("database.types.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const table of PAGED_TABLES) {
        const needle = `.from("${table}")`;
        for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
          // The query runs from the table to the next query or the end of the statement.
          const rest = source.slice(at + needle.length);
          const end = [rest.indexOf(".from("), rest.indexOf(";")]
            .filter((index) => index !== -1)
            .reduce((a, b) => Math.min(a, b), rest.length);
          if (!rest.slice(0, end).includes(".range(")) {
            const line = source.slice(0, at).split("\n").length;
            unpaged.push(`${relative(process.cwd(), file)}:${line} (${table})`);
          }
        }
      }
    }
    expect(unpaged).toEqual([]);
  });
});
