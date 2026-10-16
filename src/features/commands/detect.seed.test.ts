import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectCommands, hasWakeWord } from "./detect";

/**
 * NFR Detection: no false detection in the seed meetings. Every speaker is treated as the
 * host, so any turn that merely sounds like the wake word would show up here.
 */
const DIR = join(process.cwd(), "data", "meetings");

type SeedFile = {
  id: string;
  speakers: Array<{ code: string }>;
  turns: Array<{ id: string; speaker: string; text: string }>;
};

describe("the wake word over the seed transcripts", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));

  it("has five real meetings to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`finds no command and no wake word in ${file}`, () => {
      const seed = JSON.parse(readFileSync(join(DIR, file), "utf8")) as SeedFile;
      const everyone = new Set(seed.speakers.map((speaker) => speaker.code));
      const found = detectCommands(seed.turns, everyone);
      expect(found.map((hit) => hit.turnId)).toEqual([]);
      expect(seed.turns.filter((turn) => hasWakeWord(turn.text)).map((turn) => turn.text)).toEqual(
        [],
      );
    });
  }
});
