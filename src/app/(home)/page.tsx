import type { Metadata } from "next";

import { Hero } from "@/features/landing/hero";
import { LandingFooter } from "@/features/landing/landing-footer";
import { LandingNav } from "@/features/landing/landing-nav";
import { ShortVersion } from "@/features/landing/short-version";
import { getViewer } from "@/server/auth/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/**
 * The front door, for everyone: the animation full screen as the hero, played by
 * scrolling, with the nav floating over it; then the claim typed out beside the three
 * things to do, the route through the product as a timeline, a closing line and the
 * footer. The page keeps the animation's light palette in every system theme
 * (`theme-light`), so the cream video and the page are one surface; the app behind
 * sign-in is light too, with its own sun/moon button. Signed in, the links lead to /dashboard instead of
 * sign-in, and sign-in itself lands there; the page is never skipped, so the site can
 * always be shown to someone from the top.
 */
export default async function HomePage() {
  const viewer = await getViewer();
  const signedIn = Boolean(viewer.userId && !viewer.isGuest);
  return (
    <div className="theme-light min-h-dvh bg-canvas text-fg">
      <LandingNav />
      <main>
        <Hero />
        <ShortVersion signedIn={signedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}
