import { LogOut, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Wordmark } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { getViewer } from "@/server/auth/viewer";

/** The header on list-style pages: brand, search across meetings (F8), actions, and the sun/moon for dark mode. */
export function SiteHeader({ query = "", actions }: { query?: string; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Link href="/" aria-label="AFK.ai, home" className="flex shrink-0 items-center">
          <Wordmark className="[&>span]:hidden sm:[&>span]:inline" />
        </Link>
        <form action="/search" role="search" className="relative min-w-0 flex-1">
          <label htmlFor="site-search" className="sr-only">
            Search all meetings
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            id="site-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search what was said in any quest"
            className={inputClass("pl-9")}
          />
        </form>
        {actions}
        <ThemeToggle />
        <AccountArea />
      </div>
    </header>
  );
}

export function SendBotLink() {
  return (
    <Link href="/send" className={buttonClass("primary", "md", "shrink-0")}>
      <span className="sm:hidden">Send AFK</span>
      <span className="hidden sm:inline">Send AFK to a meeting</span>
    </Link>
  );
}

/**
 * Signed-in people see who they are; everyone else gets a quiet sign-in link, and only
 * once Google sign-in is switched on, so the link never leads to an error.
 */
async function AccountArea() {
  const [viewer, signInEnabled] = await Promise.all([getViewer(), isGoogleSignInEnabled()]);
  if (!viewer.userId || viewer.isGuest) {
    if (!signInEnabled) return null;
    return (
      <Link href="/sign-in" className={buttonClass("secondary", "sm", "shrink-0")}>
        Sign in
      </Link>
    );
  }
  const initial = (viewer.email?.[0] ?? "?").toUpperCase();
  const navLink =
    "rounded-md px-2 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";
  return (
    <nav aria-label="Account" className="flex shrink-0 items-center gap-1">
      <Link href="/tasks" className={`${navLink} hidden md:inline-block`}>
        Tasks
      </Link>
      <Link href="/memory" className={`${navLink} hidden md:inline-block`}>
        Memory
      </Link>
      <form action="/auth/sign-out" method="post" className="flex shrink-0 items-center gap-2">
        <span
          className="hidden items-center gap-2 text-sm text-fg-muted lg:inline-flex"
          title={viewer.email ?? undefined}
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong"
          >
            {initial}
          </span>
          <span className="max-w-40 truncate">{viewer.email}</span>
        </span>
        <button type="submit" className={buttonClass("danger", "sm")}>
          <LogOut aria-hidden />
          Sign out
        </button>
      </form>
    </nav>
  );
}
