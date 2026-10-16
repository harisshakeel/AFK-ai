import type { CSSProperties } from "react";

/**
 * How a speaker is shown: a colour from the speaker palette (globals.css) plus a short
 * mark ("A" for "Speaker A", initials for a name), so colour is never the only cue.
 */
export type Speaker = { code: string; label: string };

/** Twelve hues, so the NFR's twelve-speaker meeting never repeats a colour. */
const PALETTE_SIZE = 12;

export function speakerColorVar(index: number): string {
  return `var(--color-speaker-${(Math.max(index, 0) % PALETTE_SIZE) + 1})`;
}

/** Sets --speaker for a subtree; components use it as `bg-(--speaker)` etc. */
export function speakerStyle(index: number): CSSProperties {
  return { ["--speaker" as string]: speakerColorVar(index) };
}

export function speakerMark(label: string): string {
  const anonymous = /^speaker\s+([a-z0-9]+)$/i.exec(label.trim());
  if (anonymous?.[1]) return anonymous[1].toUpperCase().slice(0, 2);
  const words = label.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
  return (initials || "?").toUpperCase();
}

export function indexSpeakers(speakers: ReadonlyArray<Speaker>): Map<string, number> {
  return new Map(speakers.map((speaker, index) => [speaker.code, index]));
}
