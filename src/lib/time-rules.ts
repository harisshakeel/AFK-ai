/**
 * The time rules every view shares (requirements F2, F3, F6, F7 and NFR Sync). One
 * timeline: seconds from the start of the recording, clamped to the meeting's
 * durationSec. Turns are ordered by (startSec, endSec) and may overlap: about half of
 * consecutive turns in the seed meetings do, because people talk over each other.
 */
export type TimedTurn = { startSec: number; endSec: number };

export function clampTime(sec: number, durationSec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.min(Math.max(sec, 0), durationSec);
}

/** Index of the last turn that started at or before `sec`, or -1. Binary search. */
export function lastStartedIndex(
  turns: ReadonlyArray<Pick<TimedTurn, "startSec">>,
  sec: number,
): number {
  let lo = 0;
  let hi = turns.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((turns[mid]?.startSec ?? Infinity) <= sec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Long enough to step back over any run of overlapping turns in real meetings.
const OVERLAP_LOOKBACK = 64;

/**
 * The turn under the playhead: the latest-starting turn with startSec <= sec < endSec
 * (on equal starts, the later one); if none contains `sec` (a pause), the last turn that
 * started; before the first turn, -1.
 */
export function currentTurnIndex(turns: ReadonlyArray<TimedTurn>, sec: number): number {
  const last = lastStartedIndex(turns, sec);
  if (last < 0) return -1;
  for (let i = last; i >= 0 && i > last - OVERLAP_LOOKBACK; i--) {
    const turn = turns[i];
    if (turn && turn.startSec <= sec && sec < turn.endSec) return i;
  }
  return last;
}

/**
 * Which find-in-meeting match to ring first: the first match (turn indexes, ascending)
 * at or after the current line, wrapping to the first match when none follows. -1 when
 * there are no matches.
 */
export function firstMatchAtOrAfter(matches: ReadonlyArray<number>, currentIndex: number) {
  if (matches.length === 0) return -1;
  const position = matches.findIndex((index) => index >= currentIndex);
  return position < 0 ? 0 : position;
}

/** A clip is the half-open range [startSec, endSec). */
export type Clip = { startSec: number; endSec: number };

/** Turns that overlap a clip, shown whole: one still speaking at the clip's start counts. */
export function turnsInClip<T extends TimedTurn>(turns: ReadonlyArray<T>, clip: Clip): T[] {
  return turns.filter((turn) => turn.startSec < clip.endSec && turn.endSec > clip.startSec);
}

export const MAX_CLIP_SEC = 600;
export const MIN_CLIP_SEC = 1;

/** A valid clip inside the meeting: ordered, at least 1 s, at most 10 minutes. */
export function normaliseClip(clip: Clip, durationSec: number): Clip {
  const start = round3(clampTime(Math.min(clip.startSec, clip.endSec), durationSec));
  let end = round3(clampTime(Math.max(clip.startSec, clip.endSec), durationSec));
  if (end - start < MIN_CLIP_SEC) end = round3(Math.min(durationSec, start + MIN_CLIP_SEC));
  if (end - start > MAX_CLIP_SEC) end = round3(start + MAX_CLIP_SEC);
  const fixedStart = end - start < MIN_CLIP_SEC ? round3(Math.max(0, end - MIN_CLIP_SEC)) : start;
  return { startSec: fixedStart, endSec: end };
}

/**
 * Reads a `?t=` value: seconds ("754", "754.5"), clock time ("12:34", "1:02:03") or
 * "12m34s" / "1h2m3s". Returns null for anything else; the caller clamps the result.
 */
export function parseTimeParam(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Number.parseFloat(text);
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    return text.split(":").reduce((total, part) => total * 60 + Number.parseFloat(part), 0);
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
  if (match && (match[1] || match[2] || match[3])) {
    return (
      Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number.parseFloat(match[3] ?? "0")
    );
  }
  return null;
}

/** "12:34", or "1:02:03" past an hour. */
export function formatTime(totalSec: number): string {
  const whole = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** "1 hour", "38 min": for meeting lengths. */
export function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Seconds to the millisecond, as the database stores them. */
export const round3 = (value: number) => Math.round(value * 1000) / 1000;
