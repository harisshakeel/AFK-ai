import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";
import { signAudioUrl } from "@/server/media/media-url";

/**
 * Resolves a share token through get_shared_clip(), which returns only the clip and
 * nothing else of the meeting, and nothing at all for an unknown or revoked token. Audio
 * is signed only when the RPC returned a path, i.e. for a public seed meeting.
 */
const TOKEN = /^[0-9a-f]{64}$/;

const sharedClipSchema = z.object({
  highlightId: z.string(),
  startSec: z.coerce.number(),
  endSec: z.coerce.number(),
  note: z.string().nullable(),
  meeting: z.object({
    id: z.string(),
    title: z.string(),
    recordedAt: z.string().nullable(),
    durationSec: z.coerce.number(),
    isPublic: z.boolean(),
    source: z.record(z.string(), z.unknown()).nullable(),
  }),
  audioPath: z.string().nullable(),
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
});

/** What the share page renders, and all the browser receives: no ids, no provenance. */
export type SharedClipData = {
  startSec: number;
  endSec: number;
  note: string | null;
  meeting: { title: string; recordedAt: string | null; isPublic: boolean };
  speakers: Array<{ code: string; label: string }>;
  turns: Array<{ id: string; speaker: string; startSec: number; endSec: number; text: string }>;
  audioUrl: string | null;
};

export async function getSharedClip(token: string): Promise<SharedClipData | null> {
  if (!TOKEN.test(token)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_shared_clip", { p_token: token });
  if (error) {
    log.error("share.resolve_failed", new Error(error.code ?? "db_error"));
    throw new Error("could not load the shared clip");
  }
  if (!data) return null;
  const parsed = sharedClipSchema.safeParse(data);
  if (!parsed.success) {
    log.error("share.unexpected_shape", parsed.error);
    return null;
  }
  const { audioPath, startSec, endSec, note, meeting, speakers, turns } = parsed.data;
  // get_shared_clip returned a path only for a public recording: the token was the access decision.
  const audio = audioPath ? await signAudioUrl(audioPath, { isPublic: true }) : null;
  return {
    startSec,
    endSec,
    note,
    meeting: { title: meeting.title, recordedAt: meeting.recordedAt, isPublic: meeting.isPublic },
    speakers,
    turns,
    audioUrl: audio?.url ?? null,
  };
}
