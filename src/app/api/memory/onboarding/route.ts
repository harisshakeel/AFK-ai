import { z } from "zod";

import {
  contextTemplate,
  MEMORY_PATHS,
  profileFromAnswers,
  profileTemplate,
} from "@/features/memory/files";
import { googleIdentity } from "@/features/memory/memory-queries";
import { dbFailure, jsonError, readJson, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * The welcome flow's one write (requirement M10): the answers become profile.md in plain
 * sentences; skipping everything leaves the template with the Google name and email.
 * Runs once: a profile that already exists is left alone (409), so the welcome never
 * overwrites what the user edited later.
 */
const answer = z.string().max(200).optional();
const bodySchema = z.object({
  skipped: z.boolean().optional(),
  answers: z
    .object({
      callMe: answer,
      roleAndCompany: answer,
      meetingsAre: answer,
      notesStyle: answer,
      wantMost: answer,
      timezone: answer,
      language: answer,
    })
    .optional(),
});

export async function POST(request: Request) {
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const visitor = await requireUser("Sign in to keep memory.");
  if (!visitor.ok) return visitor.response;
  const { supabase, userId } = visitor;

  const { data: existing, error: readError } = await supabase
    .from("memory_files")
    .select("path")
    .eq("path", "profile.md")
    .maybeSingle();
  if (readError) return dbFailure("memory.read_failed", readError);
  if (existing) return jsonError(409, "Your profile already exists. Edit it on the Memory page.");

  const identity = await googleIdentity();
  const answers = body.data.answers ?? {};
  const answered = Object.values(answers).some((value) => value && value.trim());
  const content =
    body.data.skipped || !answered
      ? profileTemplate(identity)
      : profileFromAnswers(identity, answers);
  // The profile, the three context files and the three skills exist from the start
  // (requirement M2); the history files are AFK's and appear with its first line.
  const { error } = await supabase.from("memory_files").insert([
    { owner_id: userId, path: "profile.md", content },
    ...MEMORY_PATHS.filter((path) => path.startsWith("context/") || path.startsWith("skills/")).map(
      (path) => ({
        owner_id: userId,
        path,
        content: contextTemplate(path),
      }),
    ),
  ]);
  if (error) {
    // Two tabs finishing at once: the first wrote it; that is fine.
    if (error.code === "23505") return Response.json({ ok: true });
    return dbFailure("memory.profile_failed", error);
  }
  log.info("memory.profile_created", { userId, answered });
  return Response.json({ ok: true });
}
