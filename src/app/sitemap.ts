import type { MetadataRoute } from "next";

import { publicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/server/db/supabase-admin";

/**
 * The public pages and the sample meetings. The sample meetings are the rows with no
 * owner: the admin client reads only those, the same set anyone can open signed out.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;
  const at = (path: string) => new URL(path, site).toString();
  const pages: MetadataRoute.Sitemap = [
    { url: at("/"), changeFrequency: "weekly", priority: 1 },
    { url: at("/samples"), changeFrequency: "weekly", priority: 0.8 },
    { url: at("/send"), changeFrequency: "monthly", priority: 0.6 },
    { url: at("/sign-in"), changeFrequency: "yearly", priority: 0.3 },
  ];
  const { data } = await createSupabaseAdminClient()
    .from("meetings")
    .select("id, updated_at")
    .is("owner_id", null)
    .eq("status", "ready")
    .order("recorded_at", { ascending: false })
    .limit(500);
  for (const meeting of data ?? []) {
    pages.push({
      url: at(`/meetings/${meeting.id}`),
      lastModified: meeting.updated_at,
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }
  return pages;
}
