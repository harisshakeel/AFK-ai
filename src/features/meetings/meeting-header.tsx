import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { SpeakerMark } from "@/components/ui/speaker-mark";
import { DeleteMeetingButton } from "@/features/meetings/delete-meeting-button";
import { LinkPanel } from "@/features/meeting-link/link-panel";
import type { OwnerLink } from "@/features/meeting-link/link-code";
import { ShareNotesButton } from "@/features/meetings/share-notes-button";
import { speakerStyle } from "@/lib/speakers";
import { formatDuration } from "@/lib/time-rules";
import { formatMeetingDate } from "@/lib/format-date";

/**
 * The meeting page's header: where you are, what this meeting was, who spoke, and where
 * the recording came from (CC BY 4.0 attribution for seed meetings).
 */
export function MeetingHeader({
  meetingId,
  isOwn,
  title,
  recordedAt,
  durationSec,
  headline,
  speakers,
  source,
  link = null,
}: {
  meetingId: string;
  isOwn: boolean;
  /** The meeting's address and PIN, for the owner. */
  link?: OwnerLink | null;
  title: string;
  recordedAt: string | null;
  durationSec: number;
  headline: string | null;
  speakers: Array<{ code: string; label: string }>;
  source: Record<string, unknown> | null;
}) {
  const date = recordedAt ? formatMeetingDate(recordedAt) : null;
  const session = typeof source?.session === "string" ? source.session : null;
  return (
    <header className="border-b border-border bg-surface px-4 pt-3 pb-3 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href={isOwn ? "/dashboard" : "/samples"}
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
          aria-label="Back to meetings"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[0.72rem] text-fg-muted">
            {date && <time dateTime={recordedAt ?? undefined}>{date}</time>}
            {date && <span aria-hidden>·</span>}
            <span>{formatDuration(durationSec)}</span>
            <span aria-hidden>·</span>
            <span>{speakers.length} speakers</span>
            {session && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  ICSI {session}
                  <SourceNote />
                </span>
              </>
            )}
          </div>
          {headline && (
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-fg sm:text-[0.95rem]">
              {headline}
            </p>
          )}
        </div>
        {isOwn && (
          // A row of its own under the title on a phone, where three buttons beside it
          // would leave the title no room; beside it from the small breakpoint up.
          <div className="flex w-full items-center gap-2 pl-11 sm:w-auto sm:pl-0">
            {link && <LinkPanel meetingId={meetingId} link={link} />}
            <ShareNotesButton meetingId={meetingId} />
            <DeleteMeetingButton meetingId={meetingId} title={title} />
          </div>
        )}
        {!isOwn && (
          // A sample is where the landing sends people; this is the journey's next step.
          // Its own row under the title on a phone, as the owner's actions are.
          <div className="w-full pl-11 sm:w-auto sm:pl-0">
            <Link href="/send" className={buttonClass("primary", "sm")}>
              Send AFK to your call
            </Link>
          </div>
        )}
        <ul className="hidden shrink-0 -space-x-1.5 md:flex" aria-label="Speakers">
          {speakers.map((speaker, index) => (
            <li key={speaker.code} style={speakerStyle(index)} title={speaker.label}>
              <SpeakerMark label={speaker.label} className="size-7 text-xs ring-2 ring-surface" />
              <span className="sr-only">{speaker.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function SourceNote() {
  return (
    <details className="relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center rounded text-fg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
        <Info className="size-3.5" aria-hidden />
        <span className="sr-only">About this recording</span>
      </summary>
      <div className="absolute top-6 left-1/2 z-20 w-72 -translate-x-1/2 rounded-md border border-border bg-surface p-3 text-xs leading-relaxed text-fg-muted shadow-raised">
        A real research meeting from the{" "}
        <a
          className="text-accent-strong underline"
          href="https://groups.inf.ed.ac.uk/ami/icsi/"
          target="_blank"
          rel="noreferrer"
        >
          ICSI Meeting Corpus
        </a>{" "}
        (CC BY 4.0). Speakers are anonymous in the corpus. We converted the transcript, removed
        non-speech notes and the digit-reading task, and re-encoded the audio. Summaries are
        AFK&apos;s own.
      </div>
    </details>
  );
}
