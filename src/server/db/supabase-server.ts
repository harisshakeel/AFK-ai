import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { fetchWithDeadline } from "@/lib/fetch-deadline";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase-cookies";

/**
 * A Supabase client for Server Components, Route Handlers and Server Actions that acts
 * as the current visitor. Row Level Security applies, so this client can only read
 * public seed meetings and the visitor's own rows. Use it for everything that happens
 * on a visitor's behalf.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      global: { fetch: fetchWithDeadline(10_000) },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; the proxy refreshes sessions instead.
          }
        },
      },
    },
  );
}
