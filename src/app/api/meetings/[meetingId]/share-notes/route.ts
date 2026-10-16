import { DEFAULT_TEMPLATE_KEY } from "@/features/summaries/templates";
import { fillSignOff, notesEmail } from "@/features/summaries/share-notes";
import { profileNames } from "@/features/commands/sender";
import { isTypedCommandCap, TYPED_CAP_MESSAGE } from "@/features/commands/typed-cap";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";
import { linkUrl } from "@/features/meeting-link/link-code";
import { productionOrigin } from "@/lib/env";
import { googleIdentity, loadSkillSettings } from "@/features/memory/memory-queries";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";
import { jsonError, requireVisitor } from "@/server/http";
import { log } from "@/server/log";

/**
 * "Share the notes": one email card to the people on the call, built from the stored
 * notes (no Claude), proposed on the Tasks tab like any spoken email, so the host sees
 * the addresses AFK found for each name and approves once. The meeting's owner only.
 */
type Context = { params: Promise<{ meetingId: string }> };

export async function POST(_request: Request, context: Context) {
  const { meetingId } = await context.params;
  if (!MEETING_ID.test(meetingId)) return jsonError(404, "Not found.");
  const visitor = await requireVisitor();
  if (!visitor.ok) return visitor.response;
  const { data: meeting } = await visitor.supabase
    .from("meetings")
    .select("id, owner_id, title, ai_headline, status, host_speaker_code")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting || meeting.owner_id !== visitor.userId) return jsonError(404, "Not found.");
  if (meeting.status !== "ready") return jsonError(409, "The notes aren't written yet.");

  const [items, speakers, skills, profile, link] = await Promise.all([
    visitor.supabase
      .from("meeting_items")
      .select(
        "kind, template_key, section_idx, section, idx, text, owner_name, owner_speaker_code, due_text",
      )
      .eq("meeting_id", meetingId)
      .order("kind")
      .order("section_idx")
      .order("idx"),
    visitor.supabase
      .from("meeting_speakers")
      .select("code, label")
      .eq("meeting_id", meetingId)
      .order("idx"),
    visitor.isAnonymous ? Promise.resolve(null) : loadSkillSettings(),
    visitor.isAnonymous
      ? Promise.resolve({ data: null })
      : visitor.supabase
          .from("memory_files")
          .select("content")
          .eq("path", "profile.md")
          .maybeSingle(),
    visitor.supabase
      .from("meeting_links")
      .select("code, pin, enabled")
      .eq("meeting_id", meetingId)
      .maybeSingle(),
  ]);
  // The sign-off's "{my name}": the profile's Name line, else the name Google gave us.
  const myName =
    profileNames(profile.data?.content)[0] ??
    (visitor.isAnonymous ? null : (await googleIdentity()).name);
  const labelOf = new Map((speakers.data ?? []).map((speaker) => [speaker.code, speaker.label]));
  const rows = items.data ?? [];
  const email = notesEmail({
    title: meeting.title,
    headline: meeting.ai_headline,
    decisions: rows.filter((row) => row.kind === "decision").map((row) => row.text),
    actions: rows
      .filter((row) => row.kind === "action")
      .map((row) => ({
        text: row.text,
        owner:
          row.owner_name ??
          (row.owner_speaker_code ? (labelOf.get(row.owner_speaker_code) ?? null) : null),
        due: row.due_text,
      })),
    points: rows
      .filter(
        (row) => row.kind === "point" && row.template_key === DEFAULT_TEMPLATE_KEY && row.section,
      )
      .map((row) => ({ section: row.section as string, text: row.text })),
    signOff: fillSignOff(skills?.email["sign-off"] ?? null, myName),
    // The meeting's address and PIN go in the email when the link is on.
    link: link.data?.enabled
      ? { url: linkUrl(productionOrigin(), link.data.code), pin: link.data.pin }
      : null,
  });
  // Everyone on the call but the host; the card resolves each name to an address.
  const toNames = (speakers.data ?? [])
    .filter((speaker) => speaker.code !== meeting.host_speaker_code)
    .map((speaker) => speaker.label.replace(/\s\(\d+\)$/, ""))
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 10);

  // Ownership was checked above; the admin client writes the card the trigger caps.
  const admin = createSupabaseAdminClient();
  const { data: command, error } = await admin
    .from("meeting_commands")
    .insert({
      meeting_id: meetingId,
      source: "typed",
      kind: "email",
      sentence: "/email the notes to everyone on the call",
      status: "proposed",
      needs_approval: true,
      args: { toNames, subject: email.subject, body: email.body, sharedNotes: true },
    })
    .select("id")
    .single();
  if (error) {
    if (isTypedCommandCap(error)) return jsonError(429, TYPED_CAP_MESSAGE);
    log.error("meeting.share_notes_failed", new Error(error.code ?? "db_error"), { meetingId });
    return jsonError(500, "That didn't save. Try again.");
  }
  log.info("meeting.share_notes", { meetingId, count: toNames.length });
  return Response.json({ commandId: command.id }, { status: 201 });
}
