"use client";

import { useSyncExternalStore } from "react";

/**
 * The playhead as an external store. It changes every animation frame while playing, so
 * only the few components that draw it subscribe to the raw time; everything else
 * subscribes to something derived from it (the current turn's index) and re-renders only
 * when that changes. A 1,000-line transcript must not re-render 60 times a second.
 */
export type Playhead = {
  get: () => number;
  set: (sec: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPlayhead(initialSec: number): Playhead {
  let sec = initialSec;
  const listeners = new Set<() => void>();
  return {
    get: () => sec,
    set: (next) => {
      if (next === sec) return;
      sec = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The raw time. Re-renders every frame while playing; use sparingly. */
export function usePlayheadTime(playhead: Playhead): number {
  return useSyncExternalStore(playhead.subscribe, playhead.get, playhead.get);
}

/** A value derived from the time; re-renders only when the derived value changes. */
export function usePlayheadDerived<T extends string | number | boolean | null>(
  playhead: Playhead,
  select: (sec: number) => T,
): T {
  const read = () => select(playhead.get());
  return useSyncExternalStore(playhead.subscribe, read, read);
}
