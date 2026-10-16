"use client";

import { Highlighter, Link2, Link2Off, Minus, Play, Plus, Trash2 } from "lucide-react";

import { Button, Kbd } from "@/components/ui/button";
import { formatTime, turnsInClip } from "@/lib/time-rules";

/**
 * The visitor's highlights on this meeting (requirements F6, F7). Each is a clip: play it,
 * nudge its start and end a second at a time, copy a share link, or delete it.
 */
export type HighlightView = {
  id: string;
  startSec: number;
  endSec: number;
  note: string | null;
  shareToken: string | null;
};

export function HighlightsList({
  highlights,
  turns,
  busyIds,
  onPlay,
  onAdjust,
  onShare,
  onUnshare,
  onDelete,
  onCreate,
}: {
  highlights: ReadonlyArray<HighlightView>;
  turns: ReadonlyArray<{ startSec: number; endSec: number; text: string }>;
  busyIds: ReadonlySet<string>;
  onPlay: (highlight: HighlightView) => void;
  onAdjust: (highlight: HighlightView, change: { startSec?: number; endSec?: number }) => void;
  onShare: (highlight: HighlightView) => void;
  onUnshare: (highlight: HighlightView) => void;
  onDelete: (highlight: HighlightView) => void;
  onCreate: () => void;
}) {
  if (highlights.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-strong p-4 text-sm text-fg-muted">
        <p>
          Keep a moment worth sharing. Press <Kbd>H</Kbd> while listening to clip from where the
          current speaker started, or select lines in the transcript.
        </p>
        <Button variant="secondary" size="sm" onClick={onCreate}>
          <Highlighter className="size-4" aria-hidden />
          Highlight this moment
        </Button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {[...highlights]
        .sort((a, b) => a.startSec - b.startSec)
        .map((highlight) => {
          const excerpt = turnsInClip(turns, highlight)
            .map((turn) => turn.text)
            .join(" ");
          const busy = busyIds.has(highlight.id);
          return (
            <li
              key={highlight.id}
              className="rounded-lg border border-border bg-surface p-3"
              aria-busy={busy}
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => onPlay(highlight)}
                  aria-label={`Play clip from ${formatTime(highlight.startSec)}`}
                >
                  <Play className="size-4 fill-current" aria-hidden />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tabular-nums">
                    {formatTime(highlight.startSec)} – {formatTime(highlight.endSec)}
                    <span className="ml-1.5 text-xs font-normal text-fg-subtle">
                      {Math.round(highlight.endSec - highlight.startSec)} s
                    </span>
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onShare(highlight)}
                  disabled={busy}
                >
                  <Link2 className="size-4" aria-hidden />
                  {highlight.shareToken ? "Copy link" : "Share"}
                </Button>
                <Button
                  variant="danger"
                  size="icon-sm"
                  onClick={() => onDelete(highlight)}
                  disabled={busy}
                  aria-label="Delete highlight"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-muted">
                {excerpt || "No speech in this clip."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
                <Nudge
                  label="Start"
                  value={highlight.startSec}
                  disabled={busy}
                  onChange={(startSec) => onAdjust(highlight, { startSec })}
                />
                <Nudge
                  label="End"
                  value={highlight.endSec}
                  disabled={busy}
                  onChange={(endSec) => onAdjust(highlight, { endSec })}
                />
                {highlight.shareToken && (
                  <button
                    type="button"
                    onClick={() => onUnshare(highlight)}
                    disabled={busy}
                    className="ml-auto inline-flex items-center gap-1 font-medium text-fg-muted hover:text-danger disabled:opacity-40"
                  >
                    <Link2Off className="size-3.5" aria-hidden />
                    Turn off link
                  </button>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}

function Nudge({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (sec: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={`${label} of clip`}>
      <span className="w-9">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value - 1)}
        aria-label={`${label} one second earlier`}
        className="grid size-6 place-items-center rounded border border-border hover:bg-surface-raised disabled:opacity-40"
      >
        <Minus className="size-3" aria-hidden />
      </button>
      <span className="w-12 text-center text-fg tabular-nums">{formatTime(value)}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        aria-label={`${label} one second later`}
        className="grid size-6 place-items-center rounded border border-border hover:bg-surface-raised disabled:opacity-40"
      >
        <Plus className="size-3" aria-hidden />
      </button>
    </span>
  );
}
