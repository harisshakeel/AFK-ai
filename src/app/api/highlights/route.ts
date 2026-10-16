import { z } from "zod";

import { normaliseClip } from "@/lib/time-rules";
import { dbFailure, jsonError, readJson, requireVisitor } from "@/server/http";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/** Create a highlight (requirement F6). RLS checks the visitor can read the meeting. */
const bodySchema = z.object({
  meetingId: z.string().regex(MEETING_ID),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const visitor = await requireVisitor({ countWrite: false });
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  const { data: meeting, error: meetingError } = await visitor.supabase
    .from("meetings")
    .select("id, duration_sec")
    .eq("id", body.data.meetingId)
    .maybeSingle();
  if (meetingError) return dbFailure("highlight.read_failed", meetingError);
  if (!meeting?.duration_sec) return jsonError(404, "That meeting isn't available.");

  const clip = normaliseClip(body.data, Number(meeting.duration_sec));
  const { data, error } = await visitor.supabase
    .from("highlights")
    .insert({
      meeting_id: meeting.id,
      start_sec: clip.startSec,
      end_sec: clip.endSec,
      note: body.data.note ?? null,
    })
    .select("id, start_sec, end_sec, note")
    .single();
  if (error) return dbFailure("highlight.create_failed", error);

  return Response.json(
    {
      highlight: {
        id: data.id,
        startSec: Number(data.start_sec),
        endSec: Number(data.end_sec),
        note: data.note,
        shareToken: null,
      },
    },
    { status: 201 },
  );
}
