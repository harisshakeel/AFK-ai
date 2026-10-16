import { NextResponse, type NextRequest } from "next/server";

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
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = /^\/(?!\/)[\w\-/?=&%.]*$/.test(nextParam) ? nextParam : "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // First sign-in: no profile yet, so the welcome flow comes first (requirement M10).
      const { data } = await supabase.auth.getClaims();
      if (data?.claims?.sub && data.claims.is_anonymous !== true) {
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
  // AFK identity (the owner signing in from a second browser). Drop the anonymous
  // session and let them sign straight in to the existing one.
  // Only after a real OAuth round trip: the PKCE verifier cookie proves this browser
  // started the sign-in, so a link from another site cannot sign a visitor out.
  const errorCode = url.searchParams.get("error_code");
  const startedHere = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.endsWith("-code-verifier"));
  if (errorCode === "identity_already_exists" && startedHere) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    log.info("auth.link_conflict");
    return NextResponse.redirect(new URL("/sign-in?error=linked", url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
}
