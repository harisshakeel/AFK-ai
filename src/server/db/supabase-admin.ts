import "server-only";

import { publicEnv, serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase-admin-client";

/**
 * A Supabase client with the secret key. It bypasses Row Level Security, so it is for
 * trusted server work only: the import pipeline and operations where the server has
 * already decided what the caller may do. Never hand its results straight to a visitor
 * without applying the same access check RLS would have applied.
 */
export function createSupabaseAdminClient() {
  return createAdminClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY);
}
