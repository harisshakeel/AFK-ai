import { z } from "zod";

import { jsonError, readJson, requireVisitor } from "@/server/http";
import { kickJobs } from "@/server/jobs";
import { log } from "@/server/log";

/**
 * Send a draft back with a note ("shorter", "add the date"): the database puts the
 * command back in the parser's queue with the note, as the meeting's owner and only for
 * a proposed or unparsed draft of a kind the model writes (rewrite_command), and the
 * parse runs after this response. One Claude call per rewrite, under the visitor's
 * write limit.
 */
export const maxDuration = 300;

type Context = { params: Promise<{ commandId: string }> };

const bodySchema = z.object({ note: z.string().trim().min(1).max(300) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: Context) {
  const { commandId } = await context.params;
  if (!UUID.test(commandId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  const { data: command } = await visitor.supabase
    .from("meeting_commands")
    .select("meeting_id")
    .eq("id", commandId)
    .maybeSingle();
  if (!command) return jsonError(404, "Not found.");
  const { data: accepted, error } = await visitor.supabase.rpc("rewrite_command", {
    p_command_id: commandId,
    p_note: body.data.note,
  });
  if (error) {
    log.error("command.rewrite_failed", new Error(error.code ?? "db_error"), { commandId });
    return jsonError(500, "That didn't send. Try again.");
  }
  if (accepted !== true) {
    return jsonError(409, "This one can't be rewritten any more. Type it again instead.");
  }
  log.info("command.rewrite", { commandId, meetingId: command.meeting_id });
  kickJobs({ meetingId: command.meeting_id });
  return Response.json({ accepted: true });
}
