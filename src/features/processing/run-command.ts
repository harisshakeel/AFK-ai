import { AdapterError } from "../connectors/adapters/adapter.ts";
import { runCalendarCreate } from "../connectors/adapters/calendar-create.ts";
import { runGmailSend } from "../connectors/adapters/gmail-send.ts";
import { runSlackPost } from "../connectors/adapters/slack-post.ts";
import {
  APPROVED_SCHEMAS,
  isApprovableKind,
  type ApprovableKind,
  type EmailApproved,
  type FollowupApproved,
  type RemindApproved,
  type SlackApproved,
} from "../connectors/approve-args.ts";
import { pairNamesWithAddresses } from "../connectors/address-book.ts";
import { actionLine } from "../connectors/history.ts";
import { appForKind, type Provider } from "../connectors/registry.ts";
import type { Json } from "../../lib/database.types.ts";
import type { ProcessingDeps } from "./config.ts";
import { type Job, type JobResult, TransientError } from "./jobs.ts";
import { googleAccessToken, loadConnector } from "./token-source.ts";

/**
 * run_command (requirements-v2 C7, X4, X5, X7): one approved command, one adapter call,
 * with the arguments the owner confirmed and nothing else. No Claude. The order matters:
 * everything that can fail harmlessly (reads, the parse, the token refresh) happens
 * before start_command() marks the command executed; after that mark, a failure is
 * final for the kinds that cannot be retried safely, and the owner is told what to check.
 * Null means there is nothing to do: the command was dismissed or is gone.
 */
export async function runCommand(deps: ProcessingDeps, job: Job): Promise<JobResult | null> {
  const { db, config } = deps;
  if (!job.command_id || !job.claim_token) throw new Error("run_command job has no command");

  const { data: command, error } = await db
    .from("meeting_commands")
    .select(
      "id, meeting_id, kind, status, args, approved_args, executed_at, meetings!inner(title, owner_id)",
    )
    .eq("id", job.command_id)
    .maybeSingle();
  if (error) throw new TransientError(`database read failed: ${error.message}`);
  if (!command || (command.status !== "approved" && command.status !== "running")) return null;
  const ownerId = command.meetings.owner_id;
  if (!ownerId) throw new Error("the meeting has no owner");
  if (!isApprovableKind(command.kind)) throw new Error(`kind ${command.kind} has no adapter`);

  const approved = parseApproved(command.kind, command.approved_args ?? {});
  if (!approved) {
    throw new AdapterError(
      "The approved details were incomplete. Dismiss this and approve it again.",
    );
  }
  const app = appForKind(approved.kind);
  if (!app) throw new Error(`kind ${approved.kind} has no app`);
  const provider: Provider = app.provider;

  const connector = await loadConnector(db, config, ownerId, provider);
  if (!connector || connector.status !== "connected") {
    throw new AdapterError(
      `${app.name} isn't connected any more. Connect it on the Connectors page and approve again.`,
    );
  }
  if (provider === "google" && !connector.scopes.includes(app.scope)) {
    throw new AdapterError(
      `Google is connected without ${app.name} access. Reconnect Google and allow it.`,
    );
  }
  const accessToken =
    provider === "google" ? await googleAccessToken(db, config, connector) : connector.secret;

  // The at-most-once gate: from here on, a failure is the owner's to look into.
  const { data: gate, error: gateError } = await db.rpc("start_command", {
    p_command_id: command.id,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  if (gateError) throw new TransientError(`start_command failed: ${gateError.message}`);
  if (gate === "skip") return null;
  if (gate === "lost") throw new TransientError("the job claim was lost");
  if (gate === "ambiguous") {
    throw new AdapterError(
      "An earlier attempt may already have done this, so AFK did not try again. Check the connected app, then approve again if it did not happen.",
    );
  }

  const now = new Date().toISOString();
  const result = await runAdapter(approved, {
    accessToken,
    commandId: command.id,
    teamName: connector.account,
  });

  const payload = {
    result: { ...result, at: now },
    line: actionLine(now, result, command.meetings.title),
    provider,
    // The people the host confirmed, paired with the names AFK heard: learned as contacts.
    learned: learnedPeople(approved, command.args),
  };
  return {
    payload: payload as unknown as Json,
    report: { outcome: "done", kind: approved.kind, provider },
  };
}

/** The addresses a card sent to, with the heard name each stands for when that is clear. */
function learnedPeople(
  approved: Approved,
  args: unknown,
): Array<{ name: string | null; email: string }> {
  const heard = (key: string): string[] => {
    const value = (args as Record<string, unknown> | null)?.[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  };
  switch (approved.kind) {
    case "email":
      return pairNamesWithAddresses(heard("toNames"), [...approved.args.to, ...approved.args.cc]);
    case "followup":
      return pairNamesWithAddresses(heard("attendeeNames"), approved.args.attendees);
    default:
      return [];
  }
}

/** The confirmed details, typed by kind, so each adapter gets exactly its arguments. */
type Approved =
  | { kind: "email"; args: EmailApproved }
  | { kind: "followup"; args: FollowupApproved }
  | { kind: "remind"; args: RemindApproved }
  | { kind: "slack"; args: SlackApproved };

function parseApproved(kind: ApprovableKind, raw: unknown): Approved | null {
  const parsed = APPROVED_SCHEMAS[kind].safeParse(raw);
  // The table and the union share their keys, so the pair is the member for this kind.
  return parsed.success ? ({ kind, args: parsed.data } as Approved) : null;
}

function runAdapter(
  approved: Approved,
  context: { accessToken: string; commandId: string; teamName: string },
) {
  switch (approved.kind) {
    case "email":
      return runGmailSend({ args: approved.args, accessToken: context.accessToken });
    case "slack":
      return runSlackPost({
        args: approved.args,
        botToken: context.accessToken,
        teamName: context.teamName,
      });
    case "followup":
    case "remind":
      return runCalendarCreate({
        ...approved,
        commandId: context.commandId,
        accessToken: context.accessToken,
      });
  }
}
