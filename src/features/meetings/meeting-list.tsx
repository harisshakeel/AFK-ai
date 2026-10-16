import { WaveLoader } from "@/components/ui/wave-loader";
import { ArrowDown, Clock, Lock, Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { SpeakerMark } from "@/components/ui/speaker-mark";
import { speakerStyle } from "@/lib/speakers";
import { formatDuration } from "@/lib/time-rules";

import type { MeetingSummaryRow } from "./meeting-queries";
import { formatMeetingDate } from "@/lib/format-date";

/**
 * The meetings list (requirement F1): newest first, enough to pick the right one. Shared
 * by the dashboard (your meetings) and /samples. Twenty at a time; "Older meetings" is a
 * plain link to the next page, so it works before any script runs.
 */
export function MeetingList({
  meetings,
  nextHref,
}: {
  meetings: ReadonlyArray<MeetingSummaryRow>;
  nextHref?: string | null;
}) {
  return (
    <>
      <ul className="flex flex-col gap-3">
        {meetings.map((meeting) => (
          <MeetingCard key={meeting.id} meeting={meeting} />
        ))}
      </ul>
      {nextHref && <OlderMeetingsLink href={nextHref} />}
    </>
  );
}

/** The next page, as a plain link: it works before any script runs. */
export function OlderMeetingsLink({ href }: { href: string }) {
  return (
    <nav aria-label="More meetings" className="mt-6 flex justify-center">
      <Link href={href} className={buttonClass("secondary", "md")}>
        <ArrowDown className="size-4" aria-hidden />
        Older meetings
      </Link>
    </nav>
  );
}

/** Where the sample meetings come from; shown wherever they are listed. */
export function SeedAttribution() {
  return (
    <p className="mt-10 text-xs leading-relaxed text-fg-subtle">
      The sample meetings are real research-group meetings from the{" "}
      <a
        href="https://groups.inf.ed.ac.uk/ami/icsi/"
        className="underline"
        target="_blank"
        rel="noreferrer"
      >
        ICSI Meeting Corpus
      </a>{" "}
      (CC BY 4.0), with anonymous speakers. Transcripts converted and audio re-encoded by us;
      summaries written by AFK with Claude.
    </p>
  );
}

const STATUS_LABEL: Record<MeetingSummaryRow["status"], string> = {
  scheduled: "AFK joins at the time",
  requested: "Joining the lobby",
  recording: "AFK is listening",
  transcribed: "Writing the recap",
  ready: "",
  failed: "Couldn't record",
};

export function MeetingCard({ meeting }: { meeting: MeetingSummaryRow }) {
  const pending = meeting.status !== "ready";
  return (
    <li>
      <Link
        href={`/meetings/${meeting.id}`}
        className={cardClass({ interactive: true, extra: "group relative block p-4 sm:p-5" })}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-[1.05rem] font-semibold tracking-tight transition-colors group-hover:text-accent-strong">
              {meeting.title}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.72rem] text-fg-muted">
              {meeting.recordedAt && (
                <time dateTime={meeting.recordedAt}>{formatMeetingDate(meeting.recordedAt)}</time>
              )}
              {meeting.durationSec !== null && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden />
                  {formatDuration(meeting.durationSec)}
                </span>
              )}
              {meeting.speakers.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden />
                  {meeting.speakers.length} speakers
                </span>
              )}
              {meeting.isOwn && (
                <span className="inline-flex items-center gap-1" title="Yours, private">
                  <Lock className="size-3.5" aria-hidden />
                  <span className="sr-only">Yours, private</span>
                </span>
              )}
            </p>
          </div>
          {pending ? (
            <Badge tone={meeting.status === "failed" ? "danger" : "accent"} className="py-1">
              {meeting.status === "recording" ? (
                <span className="relative mr-0.5 flex size-2" aria-hidden>
                  <span className="absolute inline-flex size-full rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
              ) : meeting.status !== "failed" ? (
                <WaveLoader className="h-3" label={null} />
              ) : null}
              {STATUS_LABEL[meeting.status]}
            </Badge>
          ) : (
            <ul className="flex -space-x-1.5" aria-label={`${meeting.speakers.length} speakers`}>
              {meeting.speakers.slice(0, 8).map((speaker, index) => (
                <li key={speaker.code} style={speakerStyle(index)}>
                  <SpeakerMark label={speaker.label} className="size-6 ring-2 ring-surface" />
                </li>
              ))}
            </ul>
          )}
        </div>
        {meeting.headline ? (
          <p className="mt-3 max-w-3xl text-[0.95rem] leading-relaxed text-fg">
            {meeting.headline}
          </p>
        ) : !pending ? (
          <p className="mt-3 text-sm font-semibold tracking-tight text-fg-subtle">No recap yet.</p>
        ) : null}
      </Link>
    </li>
  );
}
