"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useToast } from "@/components/ui/toast";

/**
 * The wait before the next refresh: the first `everyMs`, each later one half again as
 * long, up to `maxMs`; null once `stopAfterMs` has passed since the start.
 */
export function nextRefreshDelay(
  previousMs: number | null,
  elapsedMs: number,
  { everyMs, maxMs, stopAfterMs }: { everyMs: number; maxMs: number; stopAfterMs?: number },
): number | null {
  if (stopAfterMs !== undefined && elapsedMs >= stopAfterMs) return null;
  return previousMs === null ? everyMs : Math.min(maxMs, Math.round(previousMs * 1.5));
}

/**
 * Re-fetches the page's server data while the tab is visible, so a meeting that is being
 * recorded or processed shows its next step without a reload (requirement F9). Every
 * `everyMs` at first, then less often, up to `maxMs`; a page whose work never finishes
 * (a job stuck or released for a while, audit F20) stops after `stopAfterMs`, rather
 * than re-reading the meeting and re-kicking the queue for as long as the tab is open,
 * and says so with `stopMessage`. Renders nothing; a refresh keeps it mounted, so the
 * backoff carries on.
 */
export function AutoRefresh({
  everyMs,
  maxMs = everyMs * 3,
  stopAfterMs,
  stopMessage,
}: {
  everyMs: number;
  maxMs?: number;
  stopAfterMs?: number;
  /** Shown once when it stops, so the page does not look finished. */
  stopMessage?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    const started = Date.now();
    let delay = nextRefreshDelay(null, 0, { everyMs, maxMs, stopAfterMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      delay = nextRefreshDelay(delay, Date.now() - started, { everyMs, maxMs, stopAfterMs });
      if (delay !== null) timer = setTimeout(tick, delay);
      else if (stopMessage) toast(stopMessage);
    };
    if (delay !== null) timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [router, toast, everyMs, maxMs, stopAfterMs, stopMessage]);
  return null;
}
