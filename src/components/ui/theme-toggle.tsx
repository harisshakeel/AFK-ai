"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { buttonClass } from "@/components/ui/button";

/**
 * The sun/moon button in the app shell: dark mode is the visitor's choice, kept in the
 * browser, never the system's (owner's decision). The choice lives as
 * `data-theme="dark"` on <html>, which the root layout's inline script restores before
 * the first paint, so this component only reads and flips it. The landing page stays
 * light either way (`theme-light`).
 */
export const THEME_KEY = "afk-theme";

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};
const isDarkNow = () => document.documentElement.dataset.theme === "dark";
const isDarkOnServer = () => false;

function setDark(dark: boolean) {
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    // Storage can be off (private windows); the choice then lasts for the page.
  }
  for (const listener of listeners) listener();
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDarkNow, isDarkOnServer);
  return (
    <button
      type="button"
      onClick={() => setDark(!dark)}
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={buttonClass("ghost", "icon-sm", className)}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </button>
  );
}
