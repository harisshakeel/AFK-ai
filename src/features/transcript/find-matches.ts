import type { TranscriptTurn } from "./transcript-panel.tsx";

/** Find in meeting: the indexes of the visible turns (the speaker filter applies) containing the text. */ export function findMatches(
  turns: ReadonlyArray<Pick<TranscriptTurn, "text" | "speaker">>,
  query: string,
  speakerFilter: ReadonlySet<string>,
): number[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const found: number[] = [];
  turns.forEach((turn, index) => {
    if (speakerFilter.size > 0 && !speakerFilter.has(turn.speaker)) return;
    if (turn.text.toLowerCase().includes(needle)) found.push(index);
  });
  return found;
}
