import { createHash } from "node:crypto";

type HashInput = {
  durationSec: number;
  speakers: ReadonlyArray<{ code: string; label: string }>;
  turns: ReadonlyArray<{
    id: string;
    speaker: string;
    startSec: number;
    endSec: number;
    text: string;
  }>;
};

/**
 * sha256 over exactly what ingest_transcript() stores. An equal hash means re-importing
 * would change nothing, so the import skips it and existing AI output stays valid
 * (docs/design-review.md fix 10). Key order is fixed here, not taken from the input.
 */
export function transcriptHash({ durationSec, speakers, turns }: HashInput): string {
  const canonical = JSON.stringify({
    durationSec,
    speakers: speakers.map(({ code, label }) => [code, label]),
    turns: turns.map(({ id, speaker, startSec, endSec, text }) => [
      id,
      speaker,
      startSec,
      endSec,
      text,
    ]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
