import { z } from "zod";

import { profileSays, profileTemplate } from "@/features/memory/files";
import { googleIdentity } from "@/features/memory/memory-queries";
import { dbFailure, jsonError, readJson, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * The switch for joining every calendar meeting: one line in profile.md, "- AFK joins
 * my calendar meetings: yes|no", written through the same conflict-checked save as the
 * Memory page. The daily keep-alive reads it; the dashboard shows it.
 */
const LINE = "AFK joins my calendar meetings";
const bodySchema = z.object({ enabled: z.boolean() });

export async function POST(request: Request) {
  const visitor = await requireUser("Sign in with Google to let AFK join from your calendar.");
  if (!visitor.ok) return visitor.response;
  const body = await readJson(request, bodySchema);
  if (!body.ok) return body.response;
  const { data: row, error: rowError } = await visitor.supabase
    .from("memory_files")
    .select("content, updated_at")
    .eq("path", "profile.md")
    .maybeSingle();
  if (rowError) return dbFailure("autojoin.read_failed", rowError);
  const current = row?.content ?? profileTemplate(await googleIdentity());
  const value = body.data.enabled ? "yes" : "no";
  const line = new RegExp(`^(\\s*-\\s*${LINE}\\s*:).*$`, "im");
  const next = line.test(current)
    ? current.replace(line, `$1 ${value}`)
    : `${current.replace(/\n*$/, "\n")}- ${LINE}: ${value}\n`;
  const { error } = await visitor.supabase.rpc("save_memory_file", {
    p_path: "profile.md",
    p_content: next,
    p_expected_updated_at: row?.updated_at ?? undefined,
  });
  if (error) {
    if (error.code === "P0006") {
      return jsonError(409, "Your profile changed meanwhile. Reload and try again.");
    }
    log.error("calendar.autojoin_failed", new Error(error.code ?? "db_error"));
    return jsonError(500, "That didn't save. Try again.");
  }
  log.info("calendar.autojoin", { userId: visitor.userId, outcome: value });
  return Response.json({ enabled: profileSays(next, LINE) === true });
}
