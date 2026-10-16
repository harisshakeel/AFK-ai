"use client";

import { memo, useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/cn";

import { usePlayheadTime, type Playhead } from "@/lib/playhead";
import { speakerColorVar, type Speaker, indexSpeakers } from "@/lib/speakers";
import { formatTime, clampTime } from "@/lib/time-rules";

/**
 * The scrubber (requirement F3): one lane per speaker showing who spoke when, chapter
 * ticks, search matches, the visitor's highlights and the playhead. It is an ARIA slider:
 * click or drag to seek, arrows move 5 s, Page Up/Down 1 minute, Home/End the ends.
 */
type Props = {
  durationSec: number;
  speakers: ReadonlyArray<Speaker>;
  turns: ReadonlyArray<{ speaker: string; startSec: number; endSec: number }>;
  chapters: ReadonlyArray<{ title: string; startSec: number }>;
  matchSecs: ReadonlyArray<number>;
  highlights: ReadonlyArray<{ id: string; startSec: number; endSec: number }>;
  dimmedSpeakers: ReadonlySet<string>;
  playhead: Playhead;
  onSeek: (sec: number) => void;
  compact?: boolean;
};

const pct = (sec: number, durationSec: number) =>
  `${Math.min(100, Math.max(0, (sec / durationSec) * 100))}%`;

export function Timeline(props: Props) {
  const { durationSec, onSeek, playhead, chapters } = props;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<{ sec: number; x: number } | null>(null);

  const secAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return ((clientX - rect.left) / rect.width) * durationSec;
    },
    [durationSec],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(secAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) setHover({ sec: secAt(event.clientX), x: event.clientX - rect.left });
    if (dragging.current) onSeek(secAt(event.clientX));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const now = playhead.get();
    const moves: Record<string, number> = {
      ArrowLeft: now - 5,
      ArrowRight: now + 5,
      ArrowDown: now - 5,
      ArrowUp: now + 5,
      PageDown: now - 60,
      PageUp: now + 60,
      Home: 0,
      End: durationSec,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(target);
  };

  const hoverChapter =
    hover === null
      ? undefined
      : [...chapters].reverse().find((chapter) => chapter.startSec <= hover.sec);

  return (
    <div className="relative w-full select-none">
      <PlayheadSlider
        playhead={playhead}
        durationSec={durationSec}
        trackRef={trackRef}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <Lanes {...props} />
      </PlayheadSlider>
      {hover && (
        <div
          className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-sm bg-fg px-1.5 py-0.5 text-xs whitespace-nowrap text-canvas tabular-nums shadow-raised"
          style={{ left: hover.x }}
          aria-hidden
        >
          {formatTime(clampTime(hover.sec, durationSec))}
          {hoverChapter ? ` · ${hoverChapter.title}` : ""}
        </div>
      )}
    </div>
  );
}

function PlayheadSlider({
  playhead,
  durationSec,
  trackRef,
  children,
  ...handlers
}: {
  playhead: Playhead;
  durationSec: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}) {
  const sec = usePlayheadTime(playhead);
  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(sec)}
      aria-valuetext={`${formatTime(sec)} of ${formatTime(durationSec)}`}
      className="relative cursor-pointer touch-none rounded-sm py-1"
      {...handlers}
    >
      {children}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-fg"
        style={{ left: pct(sec, durationSec) }}
        aria-hidden
      >
        <div className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-fg" />
      </div>
    </div>
  );
}

/** Everything that doesn't move with the playhead: drawn once per data change. */
const Lanes = memo(function Lanes({
  durationSec,
  speakers,
  turns,
  chapters,
  matchSecs,
  highlights,
  dimmedSpeakers,
  compact,
}: Props) {
  const laneOf = indexSpeakers(speakers);
  const laneCount = compact ? 1 : Math.max(1, speakers.length);
  const laneHeight = compact ? 10 : laneCount > 8 ? 3 : 4;
  const gap = compact ? 0 : 1;
  const height = laneCount * laneHeight + (laneCount - 1) * gap;

  return (
    <div className="relative" style={{ height }} aria-hidden>
      <div className="absolute inset-0 rounded-[2px] bg-surface-raised" />
      {highlights.map((highlight) => (
        <div
          key={highlight.id}
          className="absolute -inset-y-1 rounded-[2px] bg-now-strong/35"
          style={{
            left: pct(highlight.startSec, durationSec),
            width: pct(highlight.endSec - highlight.startSec, durationSec),
          }}
        />
      ))}
      {turns.map((turn, index) => {
        const lane = laneOf.get(turn.speaker) ?? 0;
        return (
          <div
            key={index}
            className={cn(
              "absolute rounded-[1px]",
              dimmedSpeakers.has(turn.speaker) ? "opacity-15" : "opacity-90",
            )}
            style={{
              left: pct(turn.startSec, durationSec),
              width: `max(1px, ${pct(turn.endSec - turn.startSec, durationSec)})`,
              top: compact ? 0 : lane * (laneHeight + gap),
              height: laneHeight,
              background: speakerColorVar(lane),
            }}
          />
        );
      })}
      {chapters.slice(1).map((chapter) => (
        <div
          key={chapter.startSec}
          className="absolute -inset-y-1 w-px bg-border-strong"
          style={{ left: pct(chapter.startSec, durationSec) }}
        />
      ))}
      {matchSecs.map((sec, index) => (
        <div
          key={index}
          className="absolute -top-1.5 size-1.5 -translate-x-1/2 rounded-full bg-match ring-1 ring-fg/40"
          style={{ left: pct(sec, durationSec) }}
        />
      ))}
    </div>
  );
});
