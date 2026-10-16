import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/ui/logo";
import { GoogleSignInButton } from "@/features/capture/google-sign-in-button";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { getViewer } from "@/server/auth/viewer";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Continue with Google to keep your AFK workspace on every device.",
  alternates: { canonical: "/sign-in" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Nothing needs an account (guest mode): sign-in links the guest workspace this browser
 * already has to a Google account, so it follows the person to other devices, and
 * unlocks the memory files and the connectors, which belong to accounts.
 */
export default async function SignInPage({ searchParams }: Props) {
  const [viewer, signInEnabled] = await Promise.all([getViewer(), isGoogleSignInEnabled()]);
  if (viewer.userId && !viewer.isGuest) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-dots [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
        aria-hidden
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-float sm:p-8">
        <Link href="/" className="inline-flex" aria-label="AFK.ai, home">
          <Wordmark />
        </Link>
        <h1 className="mt-7 font-display text-3xl font-bold tracking-tight">Keep your workspace</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          You don&apos;t need an account: send AFK, read the notes, highlight and share as a guest.
          Continue with Google to keep that workspace on every device, and to unlock AFK&apos;s
          memory and the Gmail, Calendar and Slack connectors.
        </p>
        {error === "linked" ? (
          <p role="status" className="mt-5 rounded-lg bg-accent-soft px-3 py-2 text-sm">
            That Google account already has an AFK workspace. Continue to open it; what you made
            here as a guest stays behind and won&apos;t come with you.
          </p>
        ) : (
          error && (
            <p role="alert" className="mt-5 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              Sign-in didn&apos;t finish. Try again.
            </p>
          )
        )}
        {signInEnabled ? (
          <>
            <div className="mt-6">
              <GoogleSignInButton linkAnonymous={error !== "linked"} />
            </div>
            {error !== "linked" && (
              <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                Everything you made as a guest comes with you.
              </p>
            )}
          </>
        ) : (
          <p
            role="status"
            className="mt-6 rounded-lg border border-border bg-surface-raised p-4 text-sm"
          >
            Sign-in isn&apos;t set up on this deployment yet. Everything else works without it:{" "}
            <Link href="/samples" className="font-medium text-accent-strong underline">
              open the meetings
            </Link>
            .
          </p>
        )}
      </div>
      <p className="relative mt-6 text-xs text-fg-subtle">
        <Link href="/samples" className="underline hover:text-fg">
          Browse the sample meetings
        </Link>{" "}
        without signing in.
      </p>
    </main>
  );
}
