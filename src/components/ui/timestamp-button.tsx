"use client";

import { Play } from "lucide-react";

import { cn } from "@/lib/cn";

import { formatTime } from "@/lib/time-rules";

/** A moment in the recording. Pressing it plays from there (requirement F4: every point seeks). */
export function TimestampButton({
  sec,
  onSeek,
  extra,
  className,
}: {
  sec: number;
  onSeek: (sec: number) => void;
  /** e.g. "+2" when a point cites more turns */
  extra?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSeek(sec)}
      aria-label={`Play from ${formatTime(sec)}`}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2 font-mono text-[0.7rem] font-medium text-accent-strong tabular-nums transition-colors hover:border-accent hover:bg-accent-soft",
        className,
      )}
    >
      <Play className="size-2.5 fill-current" aria-hidden />
      {formatTime(sec)}
      {extra && <span className="text-fg-subtle">{extra}</span>}
    </button>
  );
}
