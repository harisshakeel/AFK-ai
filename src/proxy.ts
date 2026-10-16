import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, newNonce } from "@/lib/csp";
import { publicEnv, serverEnv } from "@/lib/env";
import { fetchWithDeadline } from "@/lib/fetch-deadline";
import { isGoogleUser } from "@/lib/google-user";
import { clientAddress, clientKey, READ_LIMITS, readBucketFor } from "@/lib/read-limit";
import { logLine } from "@/lib/log-line";
import { isCrossSiteWrite } from "@/lib/same-origin";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase-cookies";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase-admin-client";

/**
 * Runs before every page and route (Next 16 proxy, Node runtime). Five jobs, the fourth
 * being the welcome flow's sign-in redirect:
 *
 *   0. Refuse a write another site's page sent (isCrossSiteWrite): a 403 before anything
 *      runs.
 *   1. Throttle the public read paths (search, share links, media links) per client,
 *      counted in the database so every instance sees the same count. Fails closed.
 *   2. Set the Content-Security-Policy with a fresh nonce. The nonce goes on the request
 *      too, where Next.js picks it up for its own inline scripts.
 *   3. Keep the visitor's Supabase session fresh. Server Components can't set cookies, so
 *      a rotated refresh token is written here; without this, Supabase's reuse detection
 *      would end an anonymous visitor's session and orphan their highlights.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseOrigin: new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).origin,
    isDev: process.env.NODE_ENV === "development",
  });

  if (isCrossSiteWrite(request.method, request.headers, request.nextUrl.origin)) {
    return NextResponse.json(
      { error: "That request came from another site." },
      { status: 403, headers: { "Content-Security-Policy": csp, "Cache-Control": "no-store" } },
    );
  }

  const refused = await throttleReads(request, csp);
  if (refused) return refused;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  let response = next();
  let signedIn = false;
  const hasSession = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (hasSession) {
    const supabase = createServerClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        // Every request with a session waits on this: a slow database must not hold it.
        global: { fetch: fetchWithDeadline(8_000) },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
            response = next();
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );
    // Validates the token and refreshes it when it is close to expiry.
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub) && isGoogleUser(data?.claims);
  }

  // The welcome flow is for Google users (guest mode: the dashboard, the
  // tasks list and the connectors page open for guests too, the last one locked).
  // Deciding here gives a real 307; the page keeps its own check as the second line,
  // which alone would stream a 200 behind its loading state. /welcome?preview=1 is the
  // signed-out preview.
  const { pathname, searchParams } = request.nextUrl;
  const signedInOnly = pathname === "/welcome" && searchParams.get("preview") !== "1";
  if (signedInOnly && !signedIn) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(signIn, 307);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * A 429 (or a 503 when the count can't be checked) for a client past the limit of one of
 * the read buckets; null to let the request through. The database function runs with the
 * secret key because nothing a visitor holds may read or reset the counts; the client is
 * made here rather than in src/server because the proxy is not a React server module.
 */
async function throttleReads(request: NextRequest, csp: string): Promise<NextResponse | null> {
  const bucket = readBucketFor(request.nextUrl.pathname);
  if (!bucket) return null;
  const secret = serverEnv().SUPABASE_SECRET_KEY;
  // A count that cannot be read in time fails closed below, like a database error.
  const admin = createAdminClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, secret, {
    fetch: fetchWithDeadline(5_000),
  });
  const { data: allowed, error } = await admin.rpc("note_read_hit", {
    p_bucket: bucket,
    p_key: clientKey(clientAddress(request.headers), secret),
    p_limit: READ_LIMITS[bucket],
  });
  if (error) {
    logLine("error", "read_limit.check_failed", { bucket, code: error.code });
    return refuse(request, csp, 503, "AFK can't take that request right now. Try again shortly.");
  }
  if (allowed !== true) {
    return refuse(
      request,
      csp,
      429,
      "That's a lot of requests at once. Wait a minute, then retry.",
    );
  }
  return null;
}

function refuse(request: NextRequest, csp: string, status: 429 | 503, message: string) {
  const headers = {
    "Retry-After": "60",
    "Cache-Control": "no-store",
    "Content-Security-Policy": csp,
  };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status, headers });
  }
  const title = status === 429 ? "Slow down a moment" : "Try again shortly";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · AFK.ai</title></head><body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fbf9f7;color:#1e1711"><main style="max-width:28rem;margin:6rem auto;padding:0 1.5rem;text-align:center"><p style="font-size:.85rem;color:#6b625b">${status}</p><h1 style="font-size:1.6rem;margin:.5rem 0 1rem">${title}</h1><p style="line-height:1.6;color:#4a423c">${message}</p><p style="margin-top:2rem"><a href="/" style="color:#243bb2">Back to AFK.ai</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

export const config = {
  matcher: [
    // Everything except Next's static files, the public folders (brand/, landing/),
    // the generated icons, the metadata routes and the bot webhook (which has no session
    // and no HTML). Not "anything ending in an image extension": a page URL can end that
    // way too, and every HTML response must carry the policy.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|twitter-image|manifest.webmanifest|robots.txt|sitemap.xml|api/webhooks|brand/|landing/).*)",
  ],
};
