import { buildRawEmail, EMAIL_ADDRESS, GmailError, sendGmail } from "../connectors/gmail.ts";
import { GOOGLE_GMAIL_SCOPE } from "../connectors/registry.ts";
import { profileSays } from "../memory/files.ts";
import type { ProcessingDeps } from "./config.ts";
import { type Job, type JobResult, TransientError, startJobEffect } from "./jobs.ts";
import { googleAccessToken, loadConnector } from "./token-source.ts";

/**
 * notify_owner: once the notes are written, one short email to the owner
 * through their own Gmail, so a meeting is never written up unseen: the headline, the
 * numbers, what waits for approval, and the link. Off with "- Email me after each
 * meeting: no" in the profile; skipped without a Gmail connection. No Claude.
 */
export function ownerNoteEmail(input: {
  title: string;
  headline: string | null;
  actions: number;
  decisions: number;
  waiting: number;
  meetingUrl: string;
}): { subject: string; body: string } {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    `${input.title} is written up.`,
    "",
    ...(input.headline ? [input.headline, ""] : []),
    `${plural(input.actions, "action item", "action items")}, ${plural(input.decisions, "decision", "decisions")}.`,
    input.waiting > 0
      ? `${plural(input.waiting, "card is", "cards are")} waiting for your approval before anything leaves the meeting.`
      : "Nothing is waiting for your approval.",
    "",
    `Open it: ${input.meetingUrl}`,
    "",
    'AFK.ai wrote this note to you from your own account. Say so in your profile ("Email me after each meeting: no") to stop them.',
  ];
  return {
    subject: `${input.waiting > 0 ? `${input.waiting} waiting: ` : ""}${input.title} is written up`,
    body: lines.join("\n"),
  };
}

export async function runNotifyOwner(deps: ProcessingDeps, job: Job): Promise<JobResult | null> {
  const { db, config } = deps;
  const { data: meeting, error } = await db
    .from("meetings")
    .select("id, owner_id, title, ai_headline, status")
    .eq("id", job.meeting_id)
    .maybeSingle();
  if (error) throw new TransientError(`database read failed: ${error.message}`);
  if (!meeting || meeting.status !== "ready" || !meeting.owner_id) return null;

  const [profile, connector, actions, decisions, waiting] = await Promise.all([
    db
      .from("memory_files")
      .select("content")
      .eq("owner_id", meeting.owner_id)
      .eq("path", "profile.md")
      .maybeSingle(),
    loadConnector(db, config, meeting.owner_id, "google"),
    db
      .from("meeting_items")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", meeting.id)
      .eq("kind", "action"),
    db
      .from("meeting_items")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", meeting.id)
      .eq("kind", "decision"),
    db
      .from("meeting_commands")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", meeting.id)
      .eq("status", "proposed"),
  ]);
  if (profileSays(profile.data?.content, "Email me after each meeting") === false) {
    return { payload: null, report: { skipped: "the profile says no" } };
  }
  if (
    !connector ||
    connector.status !== "connected" ||
    !connector.scopes.includes(GOOGLE_GMAIL_SCOPE) ||
    !EMAIL_ADDRESS.test(connector.account)
  ) {
    return { payload: null, report: { skipped: "no Gmail connection" } };
  }

  const note = ownerNoteEmail({
    title: meeting.title,
    headline: meeting.ai_headline,
    actions: actions.count ?? 0,
    decisions: decisions.count ?? 0,
    waiting: waiting.count ?? 0,
    meetingUrl: `${config.siteUrl}/meetings/${meeting.id}`,
  });
  const accessToken = await googleAccessToken(db, config, connector);
  // Once: an attempt after one that reached Gmail (and then failed or was cut off)
  // does not send the note again. At most once, not at least: the meeting is on the
  // owner's list either way.
  const gate = await startJobEffect(db, job);
  if (gate === "lost") return null;
  if (gate === "done_before") {
    return { payload: null, report: { skipped: "an earlier attempt reached Gmail" } };
  }
  try {
    const sent = await sendGmail({
      accessToken,
      raw: buildRawEmail({ to: [connector.account], subject: note.subject, body: note.body }),
    });
    return {
      payload: null,
      report: { sent: true, waiting: waiting.count ?? 0, messageId: sent.messageId },
    };
  } catch (sendError) {
    if (
      sendError instanceof GmailError &&
      sendError.code === "http" &&
      sendError.status === undefined
    ) {
      throw new TransientError(sendError.message);
    }
    throw sendError;
  }
}
