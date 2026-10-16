"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Root error boundary. Next.js renders this when a route throws; `retry` fetches the
// segment again (`reset` only re-renders the stale result, so it isn't used).
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Only the digest is logged client-side; the server already recorded the error.
    console.error("route error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
      <p className="font-mono text-xs text-fg-subtle">Something went wrong</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
        The page couldn&apos;t load
      </h1>
      <p className="mt-3 max-w-prose text-fg-muted">
        Try again; if it keeps failing, the meeting data may be temporarily unavailable.
      </p>
      <Button variant="primary" onClick={() => retry()} className="mt-8">
        Try again
      </Button>
    </main>
  );
}
