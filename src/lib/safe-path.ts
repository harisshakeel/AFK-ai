/**
 * Where to go after sign-in or the welcome flow: a path on this site, never another
 * origin. One leading slash and the characters a path and query use; "//host" (another
 * origin to a browser), a backslash, a scheme or anything else gives the fallback.
 */
export function safeNextPath(value: string | null | undefined, fallback: string): string {
  return value && /^\/(?!\/)[\w\-/?=&%.]*$/.test(value) ? value : fallback;
}
