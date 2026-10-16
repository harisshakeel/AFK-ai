import { z } from "zod";

import { MEETING_ID } from "@/features/meetings/meeting-file-schema";
import { JOB_KINDS } from "@/features/processing/runner";
import { readJson, requireCronSecret } from "@/server/http";
import { kickJobs, type KickOptions } from "@/server/jobs";

/**
 * Run the waiting jobs, now. Two callers: the chain (a run that used its budget with
 * jobs still waiting posts here for the next link) and any external pinger the owner
 * points at it, for pickup within minutes rather than at the daily keep-alive. Both
 * carry the cron secret; nobody else can start a function this long. The response goes
 * out at once; the work runs after it, within this function's own limit.
 */
// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

const bodySchema = z.object({
  meetingId: z.string().regex(MEETING_ID).optional(),
  kinds: z.array(z.enum(JOB_KINDS)).min(1).max(JOB_KINDS.length).optional(),
  hop: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const refused = requireCronSecret(request);
  if (refused) return refused;
  let options: KickOptions = {};
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await readJson(request, bodySchema);
    if (!body.ok) return body.response;
    options = body.data;
  }
  kickJobs(options);
  return Response.json({ accepted: true, hop: options.hop ?? 0 }, { status: 202 });
}

/** A pinger that can only GET sends no body: the same bare kick. */
export { POST as GET };
