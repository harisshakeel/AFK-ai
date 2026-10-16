import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/logo";
import { LandingNavBar } from "./landing-nav-bar";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { getViewer } from "@/server/auth/viewer";

const linkClass =
  "rounded-md px-2.5 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";

/** The landing page's header: the name, two real links and the way in, floating over the hero. */
export async function LandingNav() {
  const [viewer, signInEnabled] = await Promise.all([getViewer(), isGoogleSignInEnabled()]);
  const signedIn = Boolean(viewer.userId && !viewer.isAnonymous);
  return (
    <LandingNavBar>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center" aria-label="AFK.ai, home">
          <Wordmark markClassName="size-7" />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <Link href="/samples" className={linkClass}>
            Samples
          </Link>
          <Link href="/send" className={`${linkClass} hidden sm:inline-block`}>
            Send AFK
          </Link>
          {signedIn ? (
            <Link href="/dashboard" className={buttonClass("primary", "sm", "ml-1")}>
              Dashboard
            </Link>
          ) : signInEnabled ? (
            <Link href="/sign-in" className={buttonClass("primary", "sm", "ml-1")}>
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </LandingNavBar>
  );
}
