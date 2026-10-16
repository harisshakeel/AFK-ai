import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <Wordmark markClassName="size-7" />
      <p className="mt-10 font-mono text-xs text-fg-subtle">404</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
        This page doesn&apos;t exist
      </h1>
      <p className="mt-3 max-w-prose text-fg-muted">
        The link may be wrong, or the meeting it pointed to is no longer available.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonClass("primary", "md")}>
          Back to AFK.ai
        </Link>
        <Link href="/samples" className={buttonClass("secondary", "md")}>
          Sample meetings
        </Link>
      </div>
    </main>
  );
}
