import "server-only";

import { cache } from "react";
import { z } from "zod";

import {
  COMMAND_SELECT,
  toCommandView,
  type CommandView,
  type HostNote,
} from "@/features/commands/command-view";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { mediaUrlFor, type MediaUrl } from "@/server/media/media-url";
import type { OwnerLink } from "@/features/meeting-link/link-code";

import { generationStates } from "./generation-state";
import { decodeCursor, encodeCursor } from "./list-cursor";
import { fetchAll } from "@/lib/fetch-all";
import type { GenerationState } from "@/features/summaries/notes-panel";

/**
 * Reads for the meetings list and the meeting page. Everything goes through the
 * visitor's own client, so Row Level Security decides what exists: a private meeting
 * someone else owns simply isn't found.
 */
export type MeetingStatus =
  "scheduled" | "requested" | "recording" | "transcribed" | "ready" | "failed";

export type MeetingSummaryRow = {
  id: string;
  title: string;
  recordedAt: string | null;
  durationSec: number | null;
  headline: string | null;
  status: MeetingStatus;
  statusDetail: string | null;
  isOwn: boolean;
  /** When a scheduled bot joins; null once it has, or for a meeting sent now. */
  scheduledFor: string | null;
  speakers: Array<{ code: string; label: string }>;
};

/**
 * Which meetings a list shows. "seed": the public sample meetings (signed-out visitors
 * and /samples). "own": only the caller's meetings (signed in; the database reads the
 * caller from the session). RLS still applies on top, so "own" can never return someone
 * else's row.
 */
export type ListScope = "seed" | "own";

/** Meetings per page. The next page's link carries the last row's sort key (list-cursor.ts). */
export const LIST_PAGE_SIZE = 20;

export type MeetingPage = { meetings: MeetingSummaryRow[]; nextCursor: string | null };

const speakersSchema = z.array(z.object({ code: z.string(), label: z.string() }));

export async function listMeetings(
  scope: ListScope,
  { after }: { after?: string | string[] | undefined } = {},
): Promise<MeetingPage> {
  const supabase = await createSupabaseServerClient();
  const cursor = decodeCursor(after);
  const { data, error } = await supabase.rpc("list_meetings", {
    p_own: scope === "own",
    // One extra row tells us whether there is a next page, without a count query.
    p_limit: LIST_PAGE_SIZE + 1,
    p_before_recorded: cursor?.recordedAt ?? undefined,
    p_before_created: cursor?.createdAt,
    p_before_id: cursor?.id,
  });
  if (error) throw new Error(`could not load meetings: ${error.message}`);
  const rows = data.slice(0, LIST_PAGE_SIZE);
  const last = data.length > LIST_PAGE_SIZE ? rows[rows.length - 1] : undefined;
  return {
    meetings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      recordedAt: row.recorded_at,
      durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
      headline: row.ai_headline,
      status: row.status as MeetingStatus,
      statusDetail: row.status_detail,
      isOwn: row.owner_id !== null,
      scheduledFor: null,
      speakers: speakersSchema.catch([]).parse(row.speakers),
    })),
    nextCursor: last
      ? encodeCursor({ recordedAt: last.recorded_at, createdAt: last.created_at, id: last.id })
      : null,
  };
}

export type Turn = { id: string; speaker: string; startSec: number; endSec: number; text: string };

export type MeetingItem = {
  id: string;
  kind: "point" | "action" | "decision" | "note";
  /** "command": the host said it explicitly ("AFK, decision: …"); shown as said on the call. */
  source: "ai" | "command";
  templateKey: string | null;
  sectionIdx: number | null;
  section: string | null;
  idx: number;
  text: string;
  ownerSpeaker: string | null;
  ownerName: string | null;
  dueText: string | null;
  /** Cited turns in meeting order; the first one is where the item's timestamp points. */
  turnIds: string[];
};

export type Chapter = { id: string; idx: number; title: string; firstTurnId: string };

export type { GenerationState };

export type MeetingDetail = {
  meeting: Omit<MeetingSummaryRow, "speakers"> & {
    source: Record<string, unknown> | null;
    /** Whose words were commands, and how AFK knew (Attendee's flag or the owner's name). */
    host: HostNote;
  };
  speakers: Array<{ code: string; label: string }>;
  turns: Turn[];
  chapters: Chapter[];
  items: MeetingItem[];
  generation: GenerationState[];
  /** A command parse waiting to run (a typed draft), so the page can kick the runner. */
  commandsQueued: boolean;
  /** The recording's link: the seed audio signed, or a bot meeting's video minted at Attendee. */
  media: MediaUrl | null;
  /** The meeting's address and PIN: the owner's alone (RLS), null for everyone else. */
  link: OwnerLink | null;
  /** The visitor's own rows (none until they first highlight or tick). */
  highlights: Highlight[];
  doneItemIds: string[];
  /** The owner's commands (RLS: nobody else's); empty for seed meetings and visitors. */
  commands: CommandView[];
};

export type Highlight = {
  id: string;
  startSec: number;
  endSec: number;
  note: string | null;
  createdAt: string;
  shareToken: string | null;
};

/** Deduplicated per request, so the page and its metadata share one read. */
export const getMeeting = cache(async function getMeeting(
  meetingId: string,
): Promise<MeetingDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("meetings")
    .select(
      "id, owner_id, title, recorded_at, duration_sec, ai_headline, status, status_detail, source, audio_path, video_ref, host_speaker_code, host_detected_by, scheduled_for",
    )
    .eq("id", meetingId)
    .maybeSingle();
  if (error) throw new Error(`could not load the meeting: ${error.message}`);
  if (!row) return null;
  const meeting: MeetingDetail["meeting"] = {
    id: row.id,
    title: row.title,
    recordedAt: row.recorded_at,
    durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
    headline: row.ai_headline,
    status: row.status as MeetingStatus,
    statusDetail: row.status_detail,
    isOwn: row.owner_id !== null,
    scheduledFor: row.scheduled_for,
    source: row.owner_id === null ? (row.source as Record<string, unknown>) : null,
    host: { label: null, detectedBy: row.host_detected_by as HostNote["detectedBy"] },
  };
  // Still being recorded or processed: the page shows the steps, nothing else exists yet.
  if (meeting.status !== "ready" || meeting.durationSec === null) {
    return {
      meeting,
      speakers: [],
      turns: [],
      chapters: [],
      items: [],
      generation: [],
      commandsQueued: false,
      media: null,
      link: null,
      highlights: [],
      doneItemIds: [],
      commands: [],
    };
  }

  // A visitor's own rows exist only once they have a session (their first highlight or
  // tick creates one); without one there is nothing to read.
  const { data: claims } = await supabase.auth.getClaims();
  const hasVisitor = Boolean(claims?.claims?.sub);
  const none = Promise.resolve({ data: [], error: null });

  const [
    speakers,
    turns,
    chapters,
    items,
    citations,
    jobs,
    highlights,
    states,
    media,
    commands,
    link,
  ] = await Promise.all([
    supabase
      .from("meeting_speakers")
      .select("code, label")
      .eq("meeting_id", meetingId)
      .order("idx"),
    fetchAll((from, to) =>
      supabase
        .from("transcript_turns")
        .select("id, speaker_code, start_sec, end_sec, text")
        .eq("meeting_id", meetingId)
        .order("idx")
        .range(from, to),
    ),
    supabase
      .from("chapters")
      .select("id, idx, title, first_turn_id")
      .eq("meeting_id", meetingId)
      .order("idx"),
    fetchAll((from, to) =>
      supabase
        .from("meeting_items")
        .select(
          "id, kind, source, template_key, section_idx, section, idx, text, owner_speaker_code, owner_name, due_text",
        )
        .eq("meeting_id", meetingId)
        .order("kind")
        .order("template_key")
        .order("section_idx")
        .order("idx")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("item_citations")
        .select("item_id, turn_id")
        .eq("meeting_id", meetingId)
        .range(from, to),
    ),
    supabase
      .from("processing_jobs")
      .select("kind, status, updated_at")
      .eq("meeting_id", meetingId)
      .in("kind", ["detect_commands", "analyze", "summarize"])
      .order("created_at", { ascending: false }),
    hasVisitor
      ? supabase
          .from("highlights")
          .select("id, start_sec, end_sec, note, created_at, share_links(token, revoked_at)")
          .eq("meeting_id", meetingId)
          .order("start_sec")
      : none,
    hasVisitor
      ? supabase
          .from("item_states")
          .select("item_id, done, meeting_items!inner(meeting_id)")
          .eq("meeting_items.meeting_id", meetingId)
          .eq("done", true)
      : none,
    mediaUrlFor(row),
    // Commands exist only on the owner's own meetings; RLS returns nothing otherwise.
    hasVisitor && row.owner_id !== null
      ? supabase
          .from("meeting_commands")
          .select(COMMAND_SELECT)
          .eq("meeting_id", meetingId)
          .order("created_at")
      : none,
    // The meeting's address: the owner's alone; RLS answers nothing for anyone else.
    hasVisitor && row.owner_id !== null
      ? supabase
          .from("meeting_links")
          .select("code, pin, enabled")
          .eq("meeting_id", meetingId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const result of [speakers, chapters, jobs, highlights, states, commands]) {
    if (result.error) throw new Error(`could not load the meeting: ${result.error.message}`);
  }

  const turnOrder = new Map(turns.map((turn, index) => [turn.id, index]));
  const citationsByItem = new Map<string, string[]>();
  for (const citation of citations) {
    const list = citationsByItem.get(citation.item_id) ?? [];
    list.push(citation.turn_id);
    citationsByItem.set(citation.item_id, list);
  }

  return {
    meeting: {
      ...meeting,
      host: {
        ...meeting.host,
        label:
          (speakers.data ?? []).find((speaker) => speaker.code === row.host_speaker_code)?.label ??
          null,
      },
    },
    speakers: speakers.data ?? [],
    turns: turns.map((turn) => ({
      id: turn.id,
      speaker: turn.speaker_code,
      startSec: Number(turn.start_sec),
      endSec: Number(turn.end_sec),
      text: turn.text,
    })),
    chapters: (chapters.data ?? []).map((chapter) => ({
      id: chapter.id,
      idx: chapter.idx,
      title: chapter.title,
      firstTurnId: chapter.first_turn_id,
    })),
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind as MeetingItem["kind"],
      source: item.source as MeetingItem["source"],
      templateKey: item.template_key,
      sectionIdx: item.section_idx,
      section: item.section,
      idx: item.idx,
      text: item.text,
      ownerSpeaker: item.owner_speaker_code,
      ownerName: item.owner_name,
      dueText: item.due_text,
      turnIds: (citationsByItem.get(item.id) ?? []).sort(
        (a, b) => (turnOrder.get(a) ?? 0) - (turnOrder.get(b) ?? 0),
      ),
    })),
    generation: generationStates(jobs.data ?? [], Date.now()),
    commandsQueued: (jobs.data ?? []).some(
      (job) => job.kind === "detect_commands" && job.status === "queued",
    ),
    media,
    link: link.data
      ? { code: link.data.code, pin: link.data.pin, enabled: link.data.enabled }
      : null,
    highlights: (highlights.data ?? []).map((highlight) => ({
      id: highlight.id,
      startSec: Number(highlight.start_sec),
      endSec: Number(highlight.end_sec),
      note: highlight.note,
      createdAt: highlight.created_at,
      shareToken: highlight.share_links.find((link) => link.revoked_at === null)?.token ?? null,
    })),
    doneItemIds: (states.data ?? []).map((state) => state.item_id),
    commands: (commands.data ?? []).map(toCommandView),
  };
});
