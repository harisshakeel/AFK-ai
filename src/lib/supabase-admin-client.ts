import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types.ts";

/**
 * The service-role client, as every trusted caller builds it: the server modules
 * (behind their own access decisions), the proxy, the job runner and the seed
 * import. It bypasses Row Level Security; nothing a visitor sends may reach it directly.
 */
export function createAdminClient(url: string, secretKey: string) {
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
