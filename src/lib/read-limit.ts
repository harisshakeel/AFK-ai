import { createHmac } from "node:crypto";

/**
 * Per-client limits on the public read paths, checked in the proxy before the page or
 * route runs. The client is identified by a keyed hash of its address, so the database
 * holds no addresses; the key is derived from the server secret for this one purpose.
 */
export type ReadBucket = "search" | "share" | "media" | "health";

/** Hits a minute per client. A person never reaches these; a scraper does at once. */
export const READ_LIMITS: Record<ReadBucket, number> = {
  search: 60,
  share: 120,
  media: 60,
  // Public and unauthenticated, but it runs an aggregate on every hit.
  health: 60,
};

export function readBucketFor(pathname: string): ReadBucket | null {
  if (pathname === "/search") return "search";
  if (pathname === "/api/health") return "health";
  if (pathname.startsWith("/share/")) return "share";
  // A meeting's address and its PIN route (the database counts PIN tries as well).
  if (/^\/m\/[^/]+$/.test(pathname) || /^\/api\/m\/[^/]+\/pin$/.test(pathname)) return "share";
  if (/^\/api\/(?:meetings|m)\/[^/]+\/media$/.test(pathname)) return "media";
  return null;
}

/**
 * The client's address as the platform reports it: the first hop in x-forwarded-for
 * (Vercel sets it and strips any value the client sent). Without one (local dev, tests)
 * every caller shares one key, which still exercises the limit.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "local";
}

/** 32 hex characters: HMAC-SHA256 of the address under a key derived from the secret. */
export function clientKey(address: string, serverSecret: string): string {
  const key = createHmac("sha256", serverSecret).update("afk read-limit v1").digest();
  return createHmac("sha256", key).update(address).digest("hex").slice(0, 32);
}
