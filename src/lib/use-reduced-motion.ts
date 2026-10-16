"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const onClient = () => window.matchMedia(QUERY).matches;
const onServer = () => false;

/**
 * Whether the visitor asked for less motion. During hydration this is the server's
 * answer (false), so the first client render matches the HTML; the real answer follows
 * in the same tick, so components may branch their markup on it without a mismatch.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
