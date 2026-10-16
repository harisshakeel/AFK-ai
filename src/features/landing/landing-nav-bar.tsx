"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
};
const scrolledNow = () => window.scrollY > 8;
const scrolledOnServer = () => false;

/**
 * The landing header floats over the top of the hero animation with no background of
 * its own; once the page has scrolled, it takes the canvas and a hairline so it stays
 * readable over whatever is beneath it.
 */
export function LandingNavBar({ children }: { children: ReactNode }) {
  const scrolled = useSyncExternalStore(subscribe, scrolledNow, scrolledOnServer);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-20 border-b transition-colors duration-200 ${
        scrolled ? "border-border/60 bg-canvas/80 backdrop-blur-md" : "border-transparent"
      }`}
    >
      {children}
    </header>
  );
}
