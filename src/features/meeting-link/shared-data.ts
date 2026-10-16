import type { MediaUrl } from "../../server/media/media-url.ts";

/**
 * What a link holder sees of a meeting (2026-10-16): the meeting itself, its speakers
 * and turns, the summary's points and the notes said on the call, and the recording's
 * link. No owner, no action items, no commands, no highlights. Types only.
 */
export type SharedItem = {
  id: string;
  kind: "point" | "note";
  templateKey: string | null;
  sectionIdx: number | null;
  section: string | null;
  idx: number;
  text: string;
  turnIds: string[];
};

export type SharedMeetingData = {
  meeting: {
    title: string;
    recordedAt: string | null;
    durationSec: number;
    headline: string | null;
  };
  speakers: Array<{ code: string; label: string }>;
  turns: Array<{ id: string; speaker: string; startSec: number; endSec: number; text: string }>;
  items: SharedItem[];
  media: MediaUrl | null;
};
