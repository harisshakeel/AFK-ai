import { Sparkles } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { GoogleSignInButton } from "@/features/capture/google-sign-in-button";

/**
 * Guest mode: anyone gets a private workspace without an account. Their
 * identity is an anonymous one, created in this browser on their first write, so the
 * notice says where the workspace lives and how to keep it: continuing with Google links
 * the same identity, and everything comes along. Guests who never do are purged after
 * thirty days (the keep-alive).
 */
/** Where "Continue with Google" returns the guest to: their meetings. */
const NEXT = "/dashboard";

export function GuestNotice({
  signInEnabled,
  compact = false,
}: {
  signInEnabled: boolean;
  /** One line, for the sidebar's foot. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <p className="sidebar-label text-xs leading-relaxed text-fg-muted">
          Guest. This workspace lives in this browser.
        </p>
        {signInEnabled && (
          <Link
            href={`/sign-in?next=${encodeURIComponent(NEXT)}`}
            className={buttonClass("secondary", "sm", "sidebar-label justify-center")}
          >
            Continue with Google
          </Link>
        )}
      </div>
    );
  }
  return (
    <aside
      aria-label="Guest workspace"
      className="flex flex-col gap-3 rounded-2xl border border-accent/20 bg-accent-soft/60 p-4 sm:flex-row sm:items-center sm:gap-5"
    >
      <Sparkles className="size-5 shrink-0 text-accent-strong" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">You&apos;re a guest. No account needed.</p>
        <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
          Your meetings, highlights and tasks live in this browser and are cleared after thirty
          days.{" "}
          {signInEnabled
            ? "Continue with Google to keep them on every device; everything comes with you."
            : "Google sign-in isn't switched on for this deployment yet."}
        </p>
      </div>
      {signInEnabled && (
        <div className="shrink-0 sm:w-56">
          <GoogleSignInButton next={NEXT} />
        </div>
      )}
    </aside>
  );
}
