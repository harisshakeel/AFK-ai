import type { MetadataRoute } from "next";

import { publicEnv } from "@/lib/env";

/** Crawlers may index the public pages; nothing personal or per-visitor is listed. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/connectors", "/search", "/share/", "/api/", "/auth/"],
    },
    sitemap: new URL("/sitemap.xml", publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
