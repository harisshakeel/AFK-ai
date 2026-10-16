import "server-only";

import { createAttendeeClient, RECORDING_LINK_SEC } from "@/features/capture/attendee";
import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { log } from "@/server/log";

/**
 * Short-lived links to a meeting's recording. Callers must already have decided the
 * visitor may play it: an RLS read of the meeting returned the row, or a share token
 * resolved to a public seed meeting (get_shared_clip). Two kinds: the seed meetings'
 * audio, an object in the private "audio" bucket, signed here; and a bot meeting's
 * video, which stays at Attendee and is served through the link Attendee mints for the
 * bot id, valid thirty minutes (the page renews it in time). The path or the id always
 * comes from the row, never from the request.
 */
export type MediaUrl = { kind: "audio" | "video"; url: string; expiresAt: string };

const SEED_TTL_SEC = 6 * 60 * 60; // public recordings: long enough for a long listen
const PRIVATE_TTL_SEC = 60 * 60; // owned recordings: at most an hour (requirements)
/** Attendee's link is minted now and lasts RECORDING_LINK_SEC; a minute is kept back. */
const VIDEO_TTL_SEC = RECORDING_LINK_SEC - 60;

export async function signAudioUrl(
  audioPath: string,
  { isPublic }: { isPublic: boolean },
): Promise<MediaUrl | null> {
  const ttl = isPublic ? SEED_TTL_SEC : PRIVATE_TTL_SEC;
  // Access was decided by the caller (see above); the admin client only signs.
  const { data, error } = await createSupabaseAdminClient()
    .storage.from("audio")
    .createSignedUrl(audioPath, ttl);
  if (error || !data) {
    log.error("audio.sign_failed", error ?? new Error("no url"), { isPublic });
    return null;
  }
  return { kind: "audio", url: data.signedUrl, expiresAt: expiry(ttl) };
}

export async function mintVideoUrl(botId: string): Promise<MediaUrl | null> {
  const env = serverEnv();
  if (!env.ATTENDEE_API_KEY) {
    log.warn("video.not_configured", { botId });
    return null;
  }
  try {
    const recording = await createAttendeeClient({
      apiKey: env.ATTENDEE_API_KEY,
      baseUrl: env.ATTENDEE_API_URL,
    }).getRecording(botId);
    return { kind: "video", url: recording.url, expiresAt: expiry(VIDEO_TTL_SEC) };
  } catch (error) {
    log.error("video.mint_failed", error, { botId });
    return null;
  }
}

/** The meeting's recording, whichever kind it has; null for a meeting with none. */
export function mediaUrlFor(meeting: {
  owner_id: string | null;
  audio_path: string | null;
  video_ref: string | null;
}): Promise<MediaUrl | null> {
  if (meeting.audio_path) {
    return signAudioUrl(meeting.audio_path, { isPublic: meeting.owner_id === null });
  }
  if (meeting.video_ref) return mintVideoUrl(meeting.video_ref);
  return Promise.resolve(null);
}

const expiry = (ttlSec: number) => new Date(Date.now() + ttlSec * 1000).toISOString();
