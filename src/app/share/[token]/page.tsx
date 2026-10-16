import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/ui/logo";
import { SharedClip } from "@/features/clips/shared-clip";
import { getSharedClip } from "@/features/clips/share-queries";

/**
 * A shared clip (requirement F7), opened by someone who wasn't there and isn't signed in.
 * It shows only the clip: its audio range (public recordings only), the turns it covers,
 * the meeting's title and speakers. Unknown and revoked links get the same clear page.
 */
type Props = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Shared clip",
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const clip = await getSharedClip(token);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link href="/" aria-label="AFK.ai, home" className="inline-flex">
            <Wordmark markClassName="size-7" />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {clip ? (
          <SharedClip clip={clip} />
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-xs">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              This clip isn&apos;t available
            </h1>
            <p className="mt-3 text-sm text-fg-muted">
              The link may be mistyped, or the person who shared it has turned it off. Ask them for
              a new link.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
