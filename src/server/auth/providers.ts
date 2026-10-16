import "server-only";

import { cache } from "react";

import { publicEnv } from "@/lib/env";

/**
 * Whether Google sign-in is switched on for this Supabase project. Supabase publishes
 * its auth settings at a public endpoint; while the provider is off (a fresh deployment,
 * or one without an OAuth client yet), the app hides its sign-in entry points instead of
 * sending people to a bare "provider is not enabled" error. Cached for five minutes.
 */
export const isGoogleSignInEnabled = cache(async function isGoogleSignInEnabled() {
  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 300 },
    });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: { google?: unknown } };
    return settings.external?.google === true;
  } catch {
    return false;
  }
});
