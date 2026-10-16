import "server-only";

import { publicEnv, serverEnv } from "@/lib/env";
import { fetchWithDeadline } from "@/lib/fetch-deadline";
import { createAdminClient } from "@/lib/supabase-admin-client";

/**
 * A Supabase client with the secret key. It bypasses Row Level Security, so it is for
 * trusted server work only: the import pipeline and operations where the server has
 * already decided what the caller may do. Never hand its results straight to a visitor
 * without applying the same access check RLS would have applied.
 *
 * Each call has a deadline, so a hung database cannot hold a function to its limit:
 * 30 s by default, which a route's reads and writes never need; the job runner and the
 * keep-alive pass a longer one, since an ingest writes a whole transcript in one call.
 */
export function createSupabaseAdminClient({ deadlineMs = 30_000 }: { deadlineMs?: number } = {}) {
  return createAdminClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    fetch: fetchWithDeadline(deadlineMs),
  });
}
