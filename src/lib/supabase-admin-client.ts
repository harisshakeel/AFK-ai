import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types.ts";

/**
 * The service-role client, as every trusted caller builds it: the server modules
 * (behind their own access decisions), the proxy, the job runner and the seed
 * import. It bypasses Row Level Security; nothing a visitor sends may reach it directly.
 * Callers pass a fetch with a deadline (`createSupabaseAdminClient()` in src/server, the
 * proxy); the seed import passes none, since it loads whole meetings at a time.
 */
export function createAdminClient(
  url: string,
  secretKey: string,
  options: { fetch?: typeof fetch } = {},
) {
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}
