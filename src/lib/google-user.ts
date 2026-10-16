/**
 * The name Google gave the account (full_name, else name), trimmed; null when there is
 * none. user_metadata is the user's own to change, so it names them and decides nothing.
 */
export function nameFromMetadata(metadata: unknown): string | null {
  const meta =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const name = [meta.full_name, meta.name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return name?.trim() ?? null;
}

/** The claims this reads: Supabase sets both on the server, and a user cannot change them. */
type Claims = { is_anonymous?: unknown; app_metadata?: { providers?: unknown } } | null | undefined;

/**
 * Whether a session belongs to a Google user: Google is among the identity's sign-in
 * providers. Memory, contacts and connectors are theirs alone, and everyone else is a
 * guest. "Not anonymous" is not the same test: an email-and-password account is not
 * anonymous either. The database asks the same question in `is_google_user()`.
 */
export function isGoogleUser(claims: Claims): boolean {
  if (!claims || claims.is_anonymous === true) return false;
  const providers = claims.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes("google");
}
