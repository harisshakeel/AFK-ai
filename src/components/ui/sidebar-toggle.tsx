"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSyncExternalStore } from "react";

import { buttonClass } from "@/components/ui/button";

/**
 * Collapses the app shell's sidebar to a rail of icons and back. The choice lives as
 * `data-sidebar="rail"` on <html>, restored by the root layout's inline script before
 * the first paint and kept in the browser as `afk-sidebar`; the rules in globals.css do
 * the rest, so this only reads and flips it.
 */
export const SIDEBAR_KEY = "afk-sidebar";

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};
const isRailNow = () => document.documentElement.dataset.sidebar === "rail";
const isRailOnServer = () => false;

function setRail(rail: boolean) {
  if (rail) document.documentElement.dataset.sidebar = "rail";
  else delete document.documentElement.dataset.sidebar;
  try {
    localStorage.setItem(SIDEBAR_KEY, rail ? "rail" : "open");
  } catch {
    // Storage can be off (private windows); the choice then lasts for the page.
  }
  for (const listener of listeners) listener();
}

export function SidebarToggle({ className }: { className?: string }) {
  const rail = useSyncExternalStore(subscribe, isRailNow, isRailOnServer);
  return (
    <button
      type="button"
      onClick={() => setRail(!rail)}
      aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar"}
      title={rail ? "Expand the sidebar" : "Collapse the sidebar"}
      className={buttonClass("ghost", "icon-sm", className)}
    >
      {rail ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
    </button>
  );
}
