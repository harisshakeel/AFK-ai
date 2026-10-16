import { WaveLoader } from "@/components/ui/wave-loader";
import { ArrowLeft, CircleAlert, Radio } from "lucide-react";
import Link from "next/link";

import { formatDateTimeUtc } from "@/lib/format-date";

import { AutoRefresh } from "./auto-refresh";
import { DeleteMeetingButton } from "./delete-meeting-button";
import type { MeetingDetail } from "./meeting-queries";

/**
 * A bot meeting that isn't ready yet (requirement F9): the bot is joining, recording, or
 * the recording is being processed; or it failed, with the reason. While it is under way the
 * page re-fetches its data every ten seconds, so the next step appears by itself.
 */
const REFRESH_MS = 10_000;
const STEPS = [
  { status: "scheduled", label: "Scheduled" },
  { status: "requested", label: "Joining the call" },
  { status: "recording", label: "Recording" },
  { status: "transcribed", label: "Processing the recording" },
  { status: "ready", label: "Ready" },
] as const;

export function MeetingProcessing({ meeting }: { meeting: MeetingDetail["meeting"] }) {
  const failed = meeting.status === "failed";
  // A meeting sent now was never scheduled: that step is not shown.
  const steps = meeting.scheduledFor ? STEPS : STEPS.filter((step) => step.status !== "scheduled");
  const current = steps.findIndex((step) => step.status === meeting.status);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Your meetings
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">{meeting.title}</h1>
      {failed ? (
        <div
          role="alert"
          className="mt-6 flex gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4"
        >
          <CircleAlert className="size-5 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="font-medium">AFK couldn&apos;t record this meeting.</p>
            <p className="mt-1 text-sm text-fg-muted">
              {meeting.statusDetail ?? "The bot stopped before it had anything to save."}
            </p>
          </div>
        </div>
      ) : (
        <ol
          className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
          aria-label="Progress"
        >
          {steps.map((step, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li
                key={step.status}
                className="flex items-center gap-3"
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={
                    done
                      ? "grid size-6 place-items-center rounded-full bg-success text-xs text-white"
                      : active
                        ? "grid size-6 place-items-center rounded-full bg-accent-soft text-accent"
                        : "grid size-6 place-items-center rounded-full border border-border text-fg-subtle"
                  }
                >
                  {done ? (
                    "✓"
                  ) : active ? (
                    step.status === "recording" ? (
                      <Radio className="size-3.5" aria-hidden />
                    ) : (
                      <WaveLoader className="h-3.5" label={null} />
                    )
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={active ? "font-medium" : done ? "text-fg-muted" : "text-fg-subtle"}
                >
                  {step.label}
                  {step.status === "scheduled" && meeting.scheduledFor && (
                    <span className="text-fg-muted">
                      {" "}
                      for {formatDateTimeUtc(meeting.scheduledFor)}; AFK joins by itself
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {!failed && (
        <>
          <AutoRefresh everyMs={REFRESH_MS} />
          <p className="mt-8 text-sm text-fg-muted">
            This page checks on progress every ten seconds. A bot that never reports back is closed
            after six hours.
          </p>
        </>
      )}
      {meeting.isOwn && (
        <div className="mt-6">
          <DeleteMeetingButton meetingId={meeting.id} title={meeting.title} />
        </div>
      )}
    </main>
  );
}
