import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

/**
 * A recording's short-lived link, renewed before it expires so a long watch never
 * stalls, and on demand when playback fails. Shared by the meeting page and a meeting's
 * address, each with its own media route. The route's answer is checked, never assumed.
 */
export const mediaLinkSchema = z.object({
  kind: z.enum(["audio", "video"]),
  url: z.url(),
  expiresAt: z.string(),
});
export type MediaLink = z.infer<typeof mediaLinkSchema>;

/** Renewed this long before it expires (a video's link lasts thirty minutes). */
const RENEW_BEFORE_MS = 2 * 60_000;
/** Never sooner than this: a link already expired is renewed shortly, not in a loop. */
const MIN_WAIT_MS = 5_000;
/** An expiry that cannot be read waits this long, rather than firing at once for ever. */
const UNREADABLE_WAIT_MS = 60_000;

/** A timed renewal that fails is tried again this many times, a minute apart and doubling. */
const RETRIES = 4;

/** The wait before trying again after `failures` timed renewals failed in a row; null to stop. */
export function retryDelay(failures: number): number | null {
  return failures > RETRIES ? null : 60_000 * 2 ** (failures - 1);
}

export function renewDelay(expiresAt: string, nowMs: number): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return UNREADABLE_WAIT_MS;
  return Math.max(at - RENEW_BEFORE_MS - nowMs, MIN_WAIT_MS);
}

export function useRenewingMedia(initial: MediaLink | null, endpoint: string) {
  const [media, setMedia] = useState(initial);
  // Timed renewals that failed in a row: a short outage must not leave the link to lapse
  // with nothing asking again (audit F44); the player's own Retry stays for the rest.
  const [failures, setFailures] = useState(0);
  /** A fresh link, swapped under the player, which keeps its place; false when none came. */
  const renew = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return false;
      const link = mediaLinkSchema.safeParse(await response.json());
      if (!link.success) return false;
      setMedia(link.data);
      // A fresh link, however it came (on time or by the player's Retry): renewals start over.
      setFailures(0);
      return true;
    } catch {
      return false;
    }
  }, [endpoint]);
  useEffect(() => {
    if (!media) return;
    const wait = failures === 0 ? renewDelay(media.expiresAt, Date.now()) : retryDelay(failures);
    if (wait === null) return;
    const timer = setTimeout(() => {
      void renew().then((ok) => setFailures((count) => (ok ? 0 : count + 1)));
    }, wait);
    return () => clearTimeout(timer);
  }, [media, renew, failures]);
  return { media, renew };
}
