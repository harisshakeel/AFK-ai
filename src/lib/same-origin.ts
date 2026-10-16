/**
 * Whether a request that changes something was sent by another site's page. Browsers
 * say where a request comes from in Sec-Fetch-Site, or at least in Origin; a page on
 * another site can still send a POST without cookies (the session cookies are
 * SameSite=Lax), and the PIN route needs none, so another site could lock a visitor out
 * of a meeting's address with five wrong PINs. Callers that are not browsers (the cron,
 * the kick chain, a pinger) send neither header and are let through to their own checks.
 */
export function isCrossSiteWrite(method: string, headers: Headers, origin: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const from = headers.get("origin");
  return from !== null && from !== origin;
}
