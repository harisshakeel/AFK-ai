import { NextResponse, type NextRequest } from "next/server";

import { isGoogleUser } from "@/lib/google-user";
import { safeNextPath } from "@/lib/safe-path";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";
import { hasProfile } from "@/features/memory/memory-queries";

/**
 * Google sign-in returns here with a one-time code; exchanging it sets the session
 * cookies. `next` must be a path on this site, never another origin.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // First sign-in: no profile yet, so the welcome flow comes first (requirement M10).
      const { data } = await supabase.auth.getClaims();
      if (data?.claims?.sub && isGoogleUser(data.claims)) {
        if (!(await hasProfile())) {
          return NextResponse.redirect(
            new URL(`/welcome?next=${encodeURIComponent(next)}`, url.origin),
          );
        }
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
    log.warn("auth.callback_failed", { code: error.code ?? "unknown" });
  }

  // Linking Google to an anonymous visitor fails when that Google account already has an
  // AFK identity (the owner signing in from a second browser). The sign-in page says so
  // and signs straight in to the existing one when the visitor clicks. Nothing is done
  // here: this is a GET anyone can link to, and signing out from it would let another
  // site end a visitor's session (for a guest, the whole workspace) with one link.
  if (url.searchParams.get("error_code") === "identity_already_exists") {
    log.info("auth.link_conflict");
    return NextResponse.redirect(new URL("/sign-in?error=linked", url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
}
