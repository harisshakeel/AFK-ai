import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase-server";

import {
  contextTemplate,
  isMemoryPath,
  MEMORY_PATHS,
  parseSkill,
  SKILL_PATHS,
  type GoogleIdentity,
  type MemoryPath,
  type SkillSettings,
} from "./files";

/**
 * Reads of a signed-in user's memory files, as the user: Row Level Security returns their
 * own rows and nothing for anyone else. Content is never logged.
 */
export type MemoryFileRow = {
  path: MemoryPath;
  content: string;
  updatedBy: "you" | "afk";
  updatedAt: string;
};

export async function listMemoryFiles(): Promise<MemoryFileRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memory_files")
    .select("path, content, updated_by, updated_at");
  if (error) throw new Error(`could not load memory: ${error.message}`);
  const order = new Map(MEMORY_PATHS.map((path, index) => [path, index]));
  return (data ?? [])
    .filter((row): row is typeof row & { path: MemoryPath } => isMemoryPath(row.path))
    .sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0))
    .map((row) => ({
      path: row.path,
      content: row.content,
      updatedBy: row.updated_by === "afk" ? "afk" : "you",
      updatedAt: row.updated_at,
    }));
}

/** The three skills as settings, the template's defaults under the host's own lines. */
export async function loadSkillSettings(): Promise<SkillSettings> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memory_files")
    .select("path, content")
    .in("path", [...SKILL_PATHS]);
  const settings = {} as SkillSettings;
  for (const path of SKILL_PATHS) {
    const key = path.slice("skills/".length, -".md".length) as keyof SkillSettings;
    const own = data?.find((row) => row.path === path)?.content;
    settings[key] = { ...parseSkill(contextTemplate(path)), ...(own ? parseSkill(own) : {}) };
  }
  return settings;
}

/** Whether the welcome flow has run: profile.md exists once it has (or once it was skipped). */
export async function hasProfile(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memory_files")
    .select("path")
    .eq("path", "profile.md")
    .maybeSingle();
  if (error) throw new Error(`could not check the profile: ${error.message}`);
  return data !== null;
}

/** The name and email Google gave us, for seeding the profile. */
export async function googleIdentity(): Promise<GoogleIdentity> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof meta.full_name === "string" && meta.full_name.trim()
      ? meta.full_name.trim()
      : typeof meta.name === "string" && meta.name.trim()
        ? meta.name.trim()
        : null;
  return { name, email: data.user?.email ?? null };
}
