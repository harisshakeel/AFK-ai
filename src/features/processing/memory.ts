import {
  type MemoryFileForPrompt,
  type MemoryPath,
  isMemoryPath,
  promptBlock,
} from "../memory/files.ts";
import type { Db } from "./config.ts";
import { TransientError } from "./jobs.ts";

/**
 * The host's memory for a run (requirement M7): read once with the service role (the
 * job names the meeting and the meeting its owner), returned as the files and as the
 * "About the host" block. A guest has no files, so the block is empty for them. Never
 * logged.
 */
export type HostMemory = { files: MemoryFileForPrompt[]; block: string };

export async function loadMemory(db: Db, ownerId: string): Promise<HostMemory> {
  const { data, error } = await db
    .from("memory_files")
    .select("path, content")
    .eq("owner_id", ownerId);
  if (error) throw new TransientError(`memory read failed: ${error.message}`);
  const files: MemoryFileForPrompt[] = (data ?? [])
    .filter((row): row is { path: MemoryPath; content: string } => isMemoryPath(row.path))
    .map((row) => ({ path: row.path, content: row.content }));
  return { files, block: promptBlock(files) };
}

/** The profile's "AFK speaks in calls: yes" line (requirement L3). */
export function speaksInCalls(memory: HostMemory): boolean {
  const profile = memory.files.find((file) => file.path === "profile.md");
  return /^\s*[-*]\s*AFK speaks in calls:\s*yes\b/im.test(profile?.content ?? "");
}
