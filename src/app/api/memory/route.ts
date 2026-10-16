import { renderToolsMd } from "@/features/connectors/tools-md";
import { listMemoryFiles } from "@/features/memory/memory-queries";
import { buildZip } from "@/features/memory/zip";
import { listConnectors } from "@/server/connectors/store";
import { dbFailure, requireUser } from "@/server/http";
import { log } from "@/server/log";

/**
 * The whole of a user's memory (requirement M6): GET downloads it as a zip of markdown
 * files; DELETE forgets everything. With no profile left, the welcome shows again at the
 * next visit and writes a fresh one (M10). Both as the user, under RLS. Content is never
 * logged.
 */
export async function GET() {
  const visitor = await requireUser("Sign in to keep memory.", { countWrite: false });
  if (!visitor.ok) return visitor.response;
  const [files, connectors] = await Promise.all([listMemoryFiles(), listConnectors()]);
  const zip = buildZip([
    ...files.map((file) => ({
      name: file.path,
      content: file.content,
      modifiedAt: new Date(file.updatedAt),
    })),
    // tools.md is rendered, not stored (requirement M8).
    { name: "tools.md", content: renderToolsMd(connectors), modifiedAt: new Date() },
  ]);
  log.info("memory.exported", { userId: visitor.userId, files: files.length });
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="afk-memory.zip"',
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE() {
  const visitor = await requireUser("Sign in to keep memory.");
  if (!visitor.ok) return visitor.response;
  const { supabase, userId } = visitor;
  const { error } = await supabase.from("memory_files").delete().eq("owner_id", userId);
  if (error) return dbFailure("memory.erase_failed", error);
  log.info("memory.erased", { userId });
  return Response.json({ ok: true, next: "/welcome?next=%2Fmemory" });
}
