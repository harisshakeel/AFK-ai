import "server-only";

import { cache } from "react";
import { z } from "zod";

import { publicEnv } from "@/lib/env";

/**
 * Whether Google sign-in is switched on for this Supabase project. Supabase publishes
 * its auth settings at a public endpoint; while the provider is off (a fresh deployment,
 * or one without an OAuth client yet), the app hides its sign-in entry points instead of
 * sending people to a bare "provider is not enabled" error.
 *
 * Kept for five minutes in the function's memory: the layout is force-dynamic, which
 * turns off fetch's own cache, so without this every public page would ask Supabase.
 * The question gets two seconds; a slow or failed answer keeps the last known one (no
 * sign-in links on a cold start), so a page never waits on it.
 */
const TTL_MS = 5 * 60_000;
const settingsSchema = z.object({
  external: z.object({ google: z.boolean().optional() }).optional(),
});
let known: { enabled: boolean; at: number } | null = null;

export const isGoogleSignInEnabled = cache(async function isGoogleSignInEnabled() {
  if (known && Date.now() - known.at < TTL_MS) return known.enabled;
  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const settings = response.ok ? settingsSchema.safeParse(await response.json()) : null;
    if (!settings?.success) return keepLastAnswer();
    known = { enabled: settings.data.external?.google === true, at: Date.now() };
    return known.enabled;
  } catch {
    return keepLastAnswer();
  }
});

/** After a failed check, the last answer (or none) stands for a minute before asking again. */
function keepLastAnswer(): boolean {
  const enabled = known?.enabled ?? false;
  known = { enabled, at: Date.now() - TTL_MS + 60_000 };
  return enabled;
}
