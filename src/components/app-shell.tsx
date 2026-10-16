import { LogIn, LogOut, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { GuestNotice } from "@/components/guest-notice";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Wordmark } from "@/components/ui/logo";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";
import { countAwaitingApproval } from "@/features/commands/tasks-queries";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { viewerDisplayName, type Viewer } from "@/server/auth/viewer";

import { WrapUpPrompt } from "@/features/meetings/wrap-up";

import { AppNav } from "./app-nav";

/**
 * The app's frame for anyone with a workspace, a guest or a Google user: a floating
 * sidebar panel with the sections and the account on wide screens (a top bar and a
 * navigation strip on narrow ones), search across meetings in the top bar, a sun/moon
 * button for dark mode, and a content column on one spacing grid on a plain surface
 * (the landing's violet drifts stop here, owner's call). A guest sees
 * who they are and the one way to keep the workspace
 * (GuestNotice); a Google user sees their name and a sign-out. Public pages keep SiteHeader.
 */
/** Inside the shell the content fills the column; only a form keeps a readable width. */
export const CONTENT_WIDTH = {
  wide: "",
  narrow: "",
  form: "max-w-2xl",
} as const;

export async function AppShell({
  viewer,
  query = "",
  actions,
  width = "wide",
  fill = false,
  children,
}: {
  viewer: Viewer;
  query?: string;
  actions?: ReactNode;
  width?: keyof typeof CONTENT_WIDTH;
  /** The page is framed to the viewport on a wide screen: its own panels scroll, never the page. */
  fill?: boolean;
  children: ReactNode;
}) {
  const guest = viewer.isGuest;
  const [signInEnabled, awaiting] = await Promise.all([
    guest ? isGoogleSignInEnabled() : Promise.resolve(false),
    viewer.userId ? countAwaitingApproval() : Promise.resolve({ count: 0, oldestAt: null }),
  ]);
  const badges = { "/tasks": awaiting };
  const shown = viewerDisplayName(viewer);
  const initial = shown[0]?.toUpperCase() ?? "?";
  const avatar = (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong"
    >
      {initial}
    </span>
  );
  return (
    <div className="app-grid min-h-dvh lg:grid lg:grid-cols-[var(--sidebar)_minmax(0,1fr)]">
      {/* The sidebar floats: a rounded panel with the same gap above, below and to its left. */}
      <aside className="sticky top-0 hidden h-dvh p-4 pr-0 lg:block">
        <div className="flex h-full flex-col rounded-3xl border border-accent/15 bg-accent-soft shadow-raised">
          <div className="sidebar-head flex h-16 items-center justify-between px-4">
            <Link href="/" aria-label="AFK.ai, home" className="inline-flex">
              <Wordmark className="sidebar-wordmark" />
            </Link>
            <SidebarToggle />
          </div>
          <AppNav layout="sidebar" badges={badges} />
          <div className="mt-auto flex flex-col gap-3 border-t border-accent/15 p-4">
            {guest ? (
              <div className="sidebar-foot flex items-start gap-2.5">
                {avatar}
                <div className="min-w-0 flex-1">
                  <GuestNotice signInEnabled={signInEnabled} compact />
                </div>
              </div>
            ) : (
              <form
                action="/auth/sign-out"
                method="post"
                className="sidebar-foot flex items-center gap-2.5"
              >
                {avatar}
                <span
                  className="sidebar-label min-w-0 flex-1 truncate text-xs font-medium text-fg"
                  title={viewer.email ?? undefined}
                >
                  {shown}
                </span>
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className={buttonClass("danger", "icon-sm", "-mr-1")}
                >
                  <LogOut aria-hidden />
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      <div className={cn("flex min-w-0 flex-col", fill && "lg:h-dvh")}>
        <header className="sticky top-0 z-30 border-b border-border/80 bg-canvas/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Link href="/" aria-label="AFK.ai, home" className="inline-flex lg:hidden">
              <Wordmark markClassName="size-7" className="[&>span]:hidden sm:[&>span]:inline" />
            </Link>
            <form action="/search" role="search" className="relative min-w-0 flex-1 lg:max-w-xl">
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
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actions}
              <ThemeToggle />
              {guest ? (
                // On a phone the bar has no room for words: the icon, with its name for
                // assistive tech; the dashboard's notice carries the full button.
                signInEnabled && (
                  <Link
                    href="/sign-in?next=%2Fdashboard"
                    aria-label="Continue with Google"
                    title="Continue with Google"
                    className={buttonClass("secondary", "icon-sm", "lg:hidden")}
                  >
                    <LogIn aria-hidden />
                  </Link>
                )
              ) : (
                <form action="/auth/sign-out" method="post" className="lg:hidden">
                  <button
                    type="submit"
                    aria-label="Sign out"
                    title="Sign out"
                    className={buttonClass("danger", "icon-sm")}
                  >
                    <LogOut aria-hidden />
                  </button>
                </form>
              )}
            </div>
          </div>
          <div className="lg:hidden">
            <AppNav layout="strip" badges={badges} />
          </div>
        </header>
        <main
          className={cn(
            "w-full px-4 pt-8 pb-16 sm:px-6 lg:px-8",
            CONTENT_WIDTH[width],
            fill && "flex min-h-0 flex-1 flex-col lg:pb-6",
          )}
        >
          {children}
        </main>
        {viewer.userId && <WrapUpPrompt />}
      </div>
    </div>
  );
}
