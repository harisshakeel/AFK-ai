"use client";

import { BookOpen, Library, ListChecks, Plug, Send, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * The signed-in app's navigation: a vertical list in the lavender sidebar on wide screens (the
 * current section a white pill) and a
 * scrolling strip under the top bar on narrow ones. The current section is marked for
 * the eye and for assistive tech (aria-current).
 */
export const APP_NAV = [
  { href: "/dashboard", label: "Quests", icon: Video },
  { href: "/tasks", label: "Spells", icon: ListChecks },
  { href: "/memory", label: "Lore", icon: BookOpen },
  { href: "/connectors", label: "Loadout", icon: Plug },
  { href: "/samples", label: "Tutorial", icon: Library },
  { href: "/send", label: "Summon AFK", icon: Send },
] as const;

export function AppNav({
  layout,
  badges = {},
}: {
  layout: "sidebar" | "strip";
  /** A count shown after an entry, by href: the cards awaiting approval on Spells, and since when. */
  badges?: Partial<Record<string, { count: number; oldestAt: string | null }>>;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="App"
      className={cn(
        layout === "sidebar"
          ? "flex flex-col gap-0.5 px-3"
          : "flex gap-1 overflow-x-auto border-b border-border px-3 py-2",
      )}
    >
      {APP_NAV.map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        const waiting = badges[href];
        const badge = waiting?.count ?? 0;
        const since = waiting?.oldestAt ? sinceWording(waiting.oldestAt) : null;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            title={label}
            className={cn(
              "inline-flex shrink-0 items-center gap-2.5 rounded-full text-sm font-medium transition-colors",
              layout === "sidebar" ? "sidebar-link h-9 px-3.5" : "h-8 px-3.5",
              current
                ? layout === "sidebar"
                  ? "bg-surface text-accent-strong shadow-xs"
                  : "bg-accent-soft text-accent-strong"
                : layout === "sidebar"
                  ? "text-fg-muted hover:bg-surface/70 hover:text-fg"
                  : "text-fg-muted hover:bg-surface-raised hover:text-fg",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className={layout === "sidebar" ? "sidebar-label" : undefined}>{label}</span>
            {badge > 0 && (
              <span
                className="ml-auto rounded-full bg-warning/20 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none text-fg"
                aria-label={`${badge} awaiting your approval${since ? `, the oldest ${since}` : ""}`}
                title={since ? `${badge} waiting, the oldest ${since}` : `${badge} waiting`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** "since Tuesday" for this week, "since" and the day and month ("since 2 Nov") before that, nothing for today. */
function sinceWording(iso: string): string | null {
  const at = new Date(iso);
  const ageMs = Date.now() - at.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 86_400_000) return null;
  const format =
    ageMs < 6 * 86_400_000
      ? new Intl.DateTimeFormat("en-GB", { weekday: "long" })
      : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `since ${format.format(at)}`;
}
