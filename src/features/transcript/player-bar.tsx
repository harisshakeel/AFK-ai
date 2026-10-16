"use client";

import { WaveLoader } from "@/components/ui/wave-loader";
import { Highlighter, Pause, Play, RotateCcw, RotateCw, TriangleAlert } from "lucide-react";

import { Button, Kbd } from "@/components/ui/button";

import { usePlayheadTime, type Playhead } from "@/lib/playhead";
import { Timeline } from "./timeline";
import { formatTime } from "@/lib/time-rules";
import { PLAYBACK_RATES, type MediaPlayer } from "./use-media-player";

type TimelineProps = Omit<
  React.ComponentProps<typeof Timeline>,
  "playhead" | "onSeek" | "durationSec" | "compact"
>;

/**
 * The player, docked at the bottom of the meeting page: play, skip, speed (1x to 2x),
 * the who-spoke-when scrubber, and Highlight (H), which clips from where the current
 * speaker started.
 */
export function PlayerBar({
  player,
  durationSec,
  timeline,
  onHighlight,
  onRetryMedia,
  onTimelineSeek,
  media,
  readOnly = false,
}: {
  player: MediaPlayer;
  durationSec: number;
  timeline: TimelineProps;
  onHighlight: () => void;
  onRetryMedia: () => void;
  onTimelineSeek: (sec: number) => void;
  /** What the meeting has to play, if anything. */
  media: "audio" | "video" | null;
  /** A shared meeting: no highlight button. */
  readOnly?: boolean;
}) {
  const { playhead, playing, state, toggle, seek, rate, setRate } = player;
  const nextRate =
    PLAYBACK_RATES[
      (PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length
    ] ?? 1;
  const unavailable = media === null || state === "error";

  return (
    <div className="border-t border-border bg-surface/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-5">
      {unavailable && (
        <p
          role="status"
          className="mb-1.5 flex items-center justify-center gap-2 text-xs text-fg-muted"
        >
          <TriangleAlert className="size-3.5 text-warning" aria-hidden />
          {media
            ? `The ${media} didn't load. The transcript and notes still work.`
            : "This meeting has no recording."}
          {media && (
            <button
              type="button"
              onClick={onRetryMedia}
              className="font-medium text-accent-strong underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="order-2 flex items-center gap-1 sm:order-1">
          <Button
            variant="primary"
            size="icon"
            onClick={toggle}
            disabled={unavailable}
            aria-label={playing ? "Pause (K)" : "Play (K)"}
            className="rounded-full"
          >
            {state === "loading" && playing ? (
              <WaveLoader className="h-5" label={null} />
            ) : playing ? (
              <Pause className="size-5 fill-current" aria-hidden />
            ) : (
              <Play className="size-5 translate-x-px fill-current" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => seek(playhead.get() - 10)}
            aria-label="Back 10 seconds (J)"
          >
            <RotateCcw className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => seek(playhead.get() + 10)}
            aria-label="Forward 10 seconds (L)"
          >
            <RotateCw className="size-4" aria-hidden />
          </Button>
          <Clock playhead={playhead} durationSec={durationSec} />
          <div className="ml-auto flex items-center gap-1 sm:hidden">
            <RateButton rate={rate} onClick={() => setRate(nextRate)} />
            {!readOnly && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onHighlight}
                aria-label="Highlight this moment (H)"
              >
                <Highlighter className="size-4" aria-hidden />
                Highlight
              </Button>
            )}
          </div>
        </div>
        <div className="order-1 min-w-0 flex-1 pt-2 sm:order-2 sm:pt-0">
          <Timeline
            {...timeline}
            durationSec={durationSec}
            playhead={playhead}
            onSeek={onTimelineSeek}
          />
        </div>
        <div className="order-3 hidden items-center gap-1.5 sm:flex">
          <RateButton rate={rate} onClick={() => setRate(nextRate)} />
          {!readOnly && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onHighlight}
              aria-label="Highlight this moment (H)"
            >
              <Highlighter className="size-4" aria-hidden />
              Highlight
              <Kbd>H</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Clock({ playhead, durationSec }: { playhead: Playhead; durationSec: number }) {
  const sec = usePlayheadTime(playhead);
  return (
    <span className="ml-1 text-xs whitespace-nowrap text-fg-muted tabular-nums">
      <span className="text-fg">{formatTime(sec)}</span> / {formatTime(durationSec)}
    </span>
  );
}

function RateButton({ rate, onClick }: { rate: number; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={`Playback speed ${rate}×. Change speed`}
      className="w-14 tabular-nums"
    >
      {rate}×
    </Button>
  );
}
