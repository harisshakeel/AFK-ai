import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/cn";
import { getViewer } from "@/server/auth/viewer";

import { AppShell, type CONTENT_WIDTH } from "./app-shell";

/** Without a sidebar the public pages keep a centred, readable column. */
const PUBLIC_WIDTH: Record<keyof typeof CONTENT_WIDTH, string> = {
  wide: "max-w-5xl",
  narrow: "max-w-3xl",
  form: "max-w-xl",
};

/**
 * The frame around a page: the app shell (sidebar, top bar) for anyone who has a
 * workspace, which a guest gets on their first write (guest mode) and a Google user on
 * sign-in; the public header for a visitor who has neither. Pages that both kinds of
 * people open (samples, search, send, memory) use this so nobody falls out of the app
 * when they follow a sidebar link.
 */
export async function Chrome({
  query,
  actions,
  width = "wide",
  children,
}: {
  query?: string;
  actions?: ReactNode;
  width?: keyof typeof CONTENT_WIDTH;
  children: ReactNode;
}) {
  const viewer = await getViewer();
  if (viewer.userId) {
    return (
      <AppShell viewer={viewer} query={query} actions={actions} width={width}>
        {children}
      </AppShell>
    );
  }
  return (
    <>
      <SiteHeader query={query} actions={actions} />
      <main className={cn("mx-auto w-full px-4 pt-8 pb-16 sm:px-6", PUBLIC_WIDTH[width])}>
        {children}
      </main>
    </>
  );
}
