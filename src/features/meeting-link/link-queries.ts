import "server-only";

import { z } from "zod";

import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";
import { mediaUrlFor, type MediaUrl } from "@/server/media/media-url";

import { isLinkCode, type OwnerLink } from "./link-code";
import type { SharedMeetingData } from "./shared-data";

/**
 * The two reads behind a meeting's address: the owner's own link (code, PIN, on or
 * off), under Row Level Security, and what a link holder sees once the server has
 * checked their grant, through get_shared_meeting(), which returns the meeting, its
 * transcript and its summary and nothing of the owner's.
 */
export async function getOwnerLink(meetingId: string): Promise<OwnerLink | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("meeting_links")
    .select("code, pin, enabled")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (error) throw new Error(`could not load the meeting's link: ${error.message}`);
  return data ? { code: data.code, pin: data.pin, enabled: data.enabled } : null;
}

const sharedMeetingSchema = z.object({
  meeting: z.object({
    id: z.string(),
    title: z.string(),
    recordedAt: z.string().nullable(),
    durationSec: z.coerce.number(),
    headline: z.string().nullable(),
    audioPath: z.string().nullable(),
    videoRef: z.string().nullable(),
  }),
  speakers: z.array(z.object({ code: z.string(), label: z.string() })),
  turns: z.array(
    z.object({
      id: z.string(),
      speaker: z.string(),
      startSec: z.coerce.number(),
      endSec: z.coerce.number(),
      text: z.string(),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["point", "note"]),
      templateKey: z.string().nullable(),
      sectionIdx: z.number().nullable(),
      section: z.string().nullable(),
      idx: z.number(),
      text: z.string(),
      turnIds: z.array(z.string()),
    }),
  ),
});

/** The meeting behind a code, for a visitor whose grant the caller has already checked. */
export async function getSharedMeeting(code: string): Promise<SharedMeetingData | null> {
  if (!isLinkCode(code)) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_shared_meeting", { p_code: code });
  if (error) {
    log.error("link.resolve_failed", new Error(error.code ?? "db_error"));
    throw new Error("could not load the shared meeting");
  }
  if (!data) return null;
  const parsed = sharedMeetingSchema.safeParse(data);
  if (!parsed.success) {
    log.error("link.unexpected_shape", parsed.error);
    return null;
  }
  const { meeting, speakers, turns, items } = parsed.data;
  const media = await mediaUrlFor({
    owner_id: "shared",
    audio_path: meeting.audioPath,
    video_ref: meeting.videoRef,
  });
  return {
    meeting: {
      title: meeting.title,
      recordedAt: meeting.recordedAt,
      durationSec: meeting.durationSec,
      headline: meeting.headline,
    },
    speakers,
    turns,
    items,
    media,
  };
}

/** The recording's media for a code, for the renewal route; null when the link is off. */
export async function getSharedMedia(code: string): Promise<MediaUrl | null> {
  if (!isLinkCode(code)) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("meeting_links")
    .select("enabled, meetings!inner(status, audio_path, video_ref)")
    .eq("code", code)
    .maybeSingle();
  const meeting = data?.meetings;
  if (!data?.enabled || !meeting || meeting.status !== "ready") return null;
  return mediaUrlFor({
    owner_id: "shared",
    audio_path: meeting.audio_path,
    video_ref: meeting.video_ref,
  });
}
