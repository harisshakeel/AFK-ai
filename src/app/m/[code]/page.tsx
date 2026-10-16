import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/logo";
import { isLinkCode } from "@/features/meeting-link/link-code";
import { grantCookieName, verifyGrant } from "@/features/meeting-link/link-grant";
import { getSharedMeeting } from "@/features/meeting-link/link-queries";
import { PinForm } from "@/features/meeting-link/pin-form";
import { SharedMeetingView } from "@/features/meeting-link/shared-meeting-view";
import { serverEnv } from "@/lib/env";
import { formatMeetingDate } from "@/lib/format-date";
import { formatDuration } from "@/lib/time-rules";

/**
 * A meeting's address (2026-10-16): /m/<code>. Without a grant for this code the page
 * asks for the PIN, whatever the code is, so nothing tells real codes from others.
 * With one it shows the recording, the transcript and the summary, read-only, and
 * nothing of the owner's. A switched-off or deleted meeting says it is unavailable.
 */
type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = {
  title: "Shared meeting",
  robots: { index: false, follow: false },
};

export default async function MeetingLinkPage({ params }: Props) {
  const { code } = await params;
  if (!isLinkCode(code)) notFound();
  const store = await cookies();
  const granted = verifyGrant(
    code,
    store.get(grantCookieName(code))?.value,
    serverEnv().SUPABASE_SECRET_KEY,
  );
  const shared = granted ? await getSharedMeeting(code) : null;

  if (!granted) {
    return (
      <Frame>
        <PinForm code={code} />
      </Frame>
    );
  }
  if (!shared) {
    return (
      <Frame>
        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-xs">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            This meeting isn&apos;t available
          </h1>
          <p className="mt-3 text-sm text-fg-muted">
            The person who shared it has turned the link off, or the meeting is gone. Ask them for a
            new link.
          </p>
          <Link href="/samples" className={buttonClass("secondary", "sm", "mt-6")}>
            See what AFK does with a sample meeting
          </Link>
        </div>
      </Frame>
    );
  }

  const { meeting } = shared;
  const date = meeting.recordedAt ? formatMeetingDate(meeting.recordedAt) : null;
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          <Link href="/" aria-label="AFK.ai, home" className="mt-0.5 inline-flex shrink-0">
            <Wordmark markClassName="size-7" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {meeting.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[0.72rem] text-fg-muted">
              <span>Shared with you</span>
              {date && (
                <>
                  <span aria-hidden>·</span>
                  <time dateTime={meeting.recordedAt ?? undefined}>{date}</time>
                </>
              )}
              <span aria-hidden>·</span>
              <span>{formatDuration(meeting.durationSec)}</span>
              <span aria-hidden>·</span>
              <span>{shared.speakers.length} speakers</span>
            </div>
            {meeting.headline && (
              <p className="mt-2 max-w-4xl text-sm leading-relaxed text-fg sm:text-[0.95rem]">
                {meeting.headline}
              </p>
            )}
            <p className="mt-2 text-xs text-fg-muted">
              This page is read-only: the recording, the transcript and the summary. Tasks, email
              and calendar actions, notes to AFK and connected apps belong to the host alone.
            </p>
          </div>
        </div>
      </header>
      <SharedMeetingView code={code} data={shared} />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link href="/" aria-label="AFK.ai, home" className="inline-flex">
            <Wordmark markClassName="size-7" />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
