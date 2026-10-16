import { z } from "zod";

import { APPROVED_SCHEMAS, isApprovableKind } from "@/features/connectors/approve-args";
import { appForKind, appReady } from "@/features/connectors/registry";
import type { Json } from "@/lib/database.types";
import { listConnectors } from "@/server/connectors/store";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { jsonError, readJson, requireVisitor } from "@/server/http";
import { kickJobs } from "@/server/jobs";
import { log } from "@/server/log";

/**
 * Approve or dismiss one of your commands (requirements C4, C7). The command is read as
 * the visitor first: Row Level Security finds it only for the meeting's owner. Approve
 * takes the details the owner confirmed on the card (addresses, the time, the message),
 * validated by the kind's schema, needs the app connected, and queues the one run job.
 * A failed command may be approved again without new details where the database allows
 * it. Dismiss removes whatever the command created.
 */
type Context = { params: Promise<{ commandId: string }> };

// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

const bodySchema = z.object({
  action: z.enum(["approve", "dismiss"]),
  args: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: Context) {
  const { commandId } = await context.params;
  if (!z.uuid().safeParse(commandId).success) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;

  const { data: command } = await visitor.supabase
    .from("meeting_commands")
    .select("id, meeting_id, kind, status, needs_approval, approved_args")
    .eq("id", commandId)
    .maybeSingle();
  if (!command) return jsonError(404, "Not found.");

  let approvedArgs: Json | undefined;
  if (body.data.action === "approve") {
    if (command.status !== "proposed" && command.status !== "failed") {
      return jsonError(409, "Only a proposed or failed command can be approved.");
    }
    if (command.needs_approval && isApprovableKind(command.kind)) {
      // Connectors belong to Google accounts (guest mode): a guest cannot have one.
      if (visitor.isAnonymous) {
        return Response.json(
          { error: "Continue with Google to connect apps and approve this.", connect: "/sign-in" },
          { status: 403 },
        );
      }
      const kind = command.kind as keyof typeof APPROVED_SCHEMAS;
      if (body.data.args) {
        const parsed = APPROVED_SCHEMAS[kind].safeParse(body.data.args);
        if (!parsed.success) {
          return jsonError(400, parsed.error.issues[0]?.message ?? "Some details aren't valid.");
        }
        approvedArgs = parsed.data as Json;
      } else if (command.status !== "failed" || !command.approved_args) {
        return jsonError(400, "Confirm the details before approving.");
      }
      const app = appForKind(kind);
      if (app && !appReady(app, await listConnectors())) {
        return Response.json(
          { error: `Connect ${app.name} first.`, connect: "/connectors" },
          { status: 409 },
        );
      }
    }
  }

  // Ownership was checked by the read above; the admin client runs the state change.
  const admin = createSupabaseAdminClient();
  const { data: changed, error } =
    body.data.action === "approve"
      ? await admin.rpc("approve_command", { p_command_id: command.id, p_args: approvedArgs })
      : await admin.rpc("dismiss_command", { p_command_id: command.id });
  if (error) {
    log.error("command.change_failed", new Error(error.code ?? "db_error"), { commandId });
    return jsonError(500, "That didn't save. Try again.");
  }
  if (changed !== true) {
    // The function refused: say why from the row's state (done stands, dismissed is final).
    const { data: now } = await admin
      .from("meeting_commands")
      .select("status")
      .eq("id", command.id)
      .maybeSingle();
    if (now?.status === "dismissed") return jsonError(409, "That command was already dismissed.");
    if (now?.status === "done")
      return jsonError(409, "That command already ran; what it did stands.");
    return jsonError(409, "That command changed meanwhile. Reload the page.");
  }
  log.info("command.changed", { commandId, action: body.data.action });
  // An approved external command runs now, after this response.
  if (body.data.action === "approve") {
    kickJobs({ meetingId: command.meeting_id });
  }
  return Response.json({ status: body.data.action === "approve" ? "approved" : "dismissed" });
}
