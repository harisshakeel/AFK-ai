/**
 * Which of a meeting's hits to show (requirement F8: "snippet, speaker and time").
 *
 * The RPC ranks what the AI wrote a little above a passing mention, so the top hits of a
 * meeting are often all summary points and no spoken line. Each meeting therefore shows
 * its best transcript lines and its best notes side by side: up to `notes` note hits,
 * the rest spoken lines, and either kind fills in when the other runs short. `hits` is in
 * rank order and the result keeps that order.
 */
export function pickHits<T extends { kind: string }>(
  hits: ReadonlyArray<T>,
  limit: number,
  notes = 2,
): T[] {
  const spoken = hits.filter((hit) => hit.kind === "turn");
  const written = hits.filter((hit) => hit.kind !== "turn");
  const writtenCount = Math.min(written.length, Math.max(notes, limit - spoken.length));
  const spokenCount = Math.min(spoken.length, limit - writtenCount);
  const chosen = new Set<T>([...written.slice(0, writtenCount), ...spoken.slice(0, spokenCount)]);
  return hits.filter((hit) => chosen.has(hit));
}
