import { isProductionBuild } from "./env";

/**
 * The options every Supabase client sets its session cookies with, over the library's
 * own (path "/", SameSite=Lax, 400 days): Secure in every production build, so a session
 * never travels over plain http. A local production build on http://localhost still
 * works, because browsers treat localhost as a secure origin.
 */
export const SESSION_COOKIE_OPTIONS = { secure: isProductionBuild };
