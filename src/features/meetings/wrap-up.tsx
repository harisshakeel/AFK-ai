"use client";

import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ApprovalCards } from "@/features/commands/approval-cards";
import type { TaskRow } from "@/features/commands/tasks-queries";
import type { AddressEntry } from "@/features/connectors/address-book";
import type { ConnectorView } from "@/features/connectors/registry";
import type { SkillSettings } from "@/features/memory/files";
import { formatDuration } from "@/lib/time-rules";
import { visitorFetch } from "@/lib/visitor-api";

/**
 * The wrap-up (requirement C4 as amended): once a meeting's notes are
 * written, the next page the owner opens shows this dialog, the headline, the numbers,
 * the cards waiting for approval and "How was the meeting?", until Done. Later closes it
 * for this visit only, so nothing waits unseen. One fetch per page; nothing when
 * nothing waits.
 */
type WrapUp = {
  /** A fresh wrap-up, or the nudge for cards that have waited a day. */
  mode: "wrap-up" | "nudge";
  meeting: {
    id: string;
    title: string;
    headline: string | null;
    recordedAt: string | null;
    durationSec: number | null;
    actions: number;
    decisions: number;
  } | null;
  waiting: TaskRow[];
  connectors: ConnectorView[];
  addressBook: AddressEntry[];
  skills: SkillSettings;
};

/** Later keeps a wrap-up away for this visit; a later nudge for the same meeting is its own event. */
const snoozeKey = (mode: "wrap-up" | "nudge", meetingId: string) =>
  `afk-wrap-up-later:${mode}:${meetingId}`;

export function WrapUpPrompt() {
  const [data, setData] = useState<WrapUp | null>(null);
  useEffect(() => {
    let cancelled = false;
    visitorFetch<WrapUp>("/api/wrap-up", { method: "GET" })
      .then((result) => {
        if (cancelled || !result.meeting) return;
        try {
          if (sessionStorage.getItem(snoozeKey(result.mode, result.meeting.id))) return;
        } catch {
          // No session storage: the dialog simply shows.
        }
        setData(result);
      })
      .catch(() => {
        // A failed fetch shows nothing; the next page tries again.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const meeting = data?.meeting;
  if (!data || !meeting) return null;
  return <WrapUpDialog data={{ ...data, meeting }} onClose={() => setData(null)} />;
}

function WrapUpDialog({
  data,
  onClose,
}: {
  data: WrapUp & { meeting: NonNullable<WrapUp["meeting"]> };
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement | null>(null);
  const [rating, setRating] = useState<"good" | "bad" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { meeting, waiting } = data;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const nudge = data.mode === "nudge";

  /** Away for this visit: Later, and the links to the meeting, whose page would ask again. */
  const awayForVisit = () => {
    try {
      sessionStorage.setItem(snoozeKey(data.mode, meeting.id), "1");
    } catch {
      // Without storage it returns on the next page; fine.
    }
    ref.current?.close();
    onClose();
  };

  const later = () => {
    awayForVisit();
    // A nudge sleeps for a day, not just for this visit.
    if (nudge)
      void visitorFetch(`/api/meetings/${meeting.id}/snooze`, { method: "POST" }).catch(() => {});
  };

  const done = async () => {
    setBusy(true);
    try {
      await visitorFetch(
        nudge ? `/api/meetings/${meeting.id}/snooze` : `/api/meetings/${meeting.id}/review`,
        {
          method: "POST",
          body: nudge
            ? {}
            : { ...(rating ? { rating } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
        },
      );
      ref.current?.close();
      onClose();
      toast(rating ? "Thanks. Noted for next time." : "Wrapped up.");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't save.", "error");
    } finally {
      setBusy(false);
    }
  };

  const numbers = [
    meeting.durationSec ? formatDuration(meeting.durationSec) : null,
    `${meeting.actions} action ${meeting.actions === 1 ? "item" : "items"}`,
    `${meeting.decisions} ${meeting.decisions === 1 ? "decision" : "decisions"}`,
    waiting.length > 0
      ? `${waiting.length} ${waiting.length === 1 ? "card" : "cards"} waiting for you`
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        later();
      }}
      aria-labelledby="wrap-up-title"
      className="m-auto max-h-[90dvh] w-[min(100vw-2rem,44rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-fg shadow-raised backdrop:bg-fg/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent-strong uppercase">
              {nudge ? "Still waiting for you" : "Meeting wrap-up"}
            </p>
            <h2 id="wrap-up-title" className="mt-1 text-xl font-semibold tracking-tight">
              {meeting.title}
            </h2>
            {meeting.headline && (
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{meeting.headline}</p>
            )}
            <p className="mt-2 font-mono text-[0.72rem] tracking-wide text-fg-subtle">
              {numbers.join(" · ")}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close for now" onClick={later}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {waiting.length > 0 ? (
          <section aria-labelledby="wrap-up-waiting">
            <h3 id="wrap-up-waiting" className="text-sm font-semibold">
              Waiting for your approval
            </h3>
            <div className="mt-2">
              <ApprovalCards
                tasks={waiting}
                connectors={data.connectors}
                addressBook={data.addressBook}
                skills={data.skills}
              />
            </div>
          </section>
        ) : (
          <p className="text-sm text-fg-muted">
            Nothing is waiting for your approval from this one.{" "}
            <Link
              href={`/meetings/${meeting.id}`}
              onClick={awayForVisit}
              className="font-medium text-accent-strong underline"
            >
              Open the notes
            </Link>
            .
          </p>
        )}

        {!nudge && (
          <section aria-labelledby="wrap-up-rating" className="rounded-xl bg-surface-raised p-4">
            <h3 id="wrap-up-rating" className="text-sm font-semibold">
              How was the meeting?
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              Your verdict on the notes, kept for our own evaluation. Optional.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={rating === "good" ? "primary" : "secondary"}
                size="sm"
                aria-pressed={rating === "good"}
                onClick={() => setRating(rating === "good" ? null : "good")}
              >
                <ThumbsUp aria-hidden />
                Good
              </Button>
              <Button
                type="button"
                variant={rating === "bad" ? "primary" : "secondary"}
                size="sm"
                aria-pressed={rating === "bad"}
                onClick={() => setRating(rating === "bad" ? null : "bad")}
              >
                <ThumbsDown aria-hidden />
                Not great
              </Button>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={300}
                placeholder="A word on why (optional)"
                aria-label="A word on why"
                className={inputClass("h-9 min-w-0 flex-1")}
              />
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/meetings/${meeting.id}`}
            onClick={awayForVisit}
            className={buttonClass("secondary", "sm")}
          >
            Open the meeting
          </Link>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={later}>
              Later
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => void done()}
            >
              Done
            </Button>
          </div>
        </div>
        {waiting.length > 0 && (
          <p className="text-xs text-fg-subtle">
            {nudge
              ? "These have waited a day. Done or Later keeps them on the dashboard and asks again tomorrow."
              : "Done closes this wrap-up; cards you leave stay on the dashboard until you approve or dismiss them."}
          </p>
        )}
      </div>
    </dialog>
  );
}
