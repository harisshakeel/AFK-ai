import "server-only";

import { cache } from "react";

import { isGoogleUser, nameFromMetadata } from "@/lib/google-user";
import { createSupabaseServerClient } from "@/server/db/supabase-server";

/**
 * Who is looking at the page. A visitor has no session until their first write gives
 * them an anonymous identity (a guest, who owns meetings like a Google user); a Google
 * user also has memory files and connectors.
 */
export type Viewer = {
  userId: string | null;
  email: string | null;
  /** The name Google gave us, when it did; pages show it instead of the address. */
  name: string | null;
  /** A guest: no Google identity (an anonymous one, or any other kind of sign-in). */
  isGuest: boolean;
};

/** What the pages call the viewer: "Guest" for an anonymous identity, else the Google name, else the address. */
export function viewerDisplayName(viewer: Viewer): string {
  return viewer.isGuest ? "Guest" : (viewer.name ?? viewer.email ?? "You");
}

/** The first word of that, for a greeting ("Player one: Haris"). */
export function viewerFirstName(viewer: Viewer): string {
  const name = viewerDisplayName(viewer);
  return viewer.isGuest ? name : name.split(/[\s@]/)[0] || "You";
}

export const getViewer = cache(async function getViewer(): Promise<Viewer> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { userId: null, email: null, name: null, isGuest: true };
  const isGuest = !isGoogleUser(claims);
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    name: nameFromMetadata(claims.user_metadata),
    isGuest,
  };
});
