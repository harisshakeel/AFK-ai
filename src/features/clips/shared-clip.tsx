"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SpeakerMark } from "@/components/ui/speaker-mark";
import { cn } from "@/lib/cn";
import { speakerStyle, indexSpeakers } from "@/lib/speakers";
import { currentTurnIndex, formatTime } from "@/lib/time-rules";

import type { SharedClipData } from "./share-queries";
import { formatMeetingDate } from "@/lib/format-date";

/**
 * The shared clip itself: a player confined to the clip's range and the excerpt it
 * covers, with the line being spoken marked. Nothing links into the rest of the meeting.
 */
export function SharedClip({ clip }: { clip: SharedClipData }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [sec, setSec] = useState(clip.startSec);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped by "Try again" so the audio element is recreated and loads afresh.
  const [attempt, setAttempt] = useState(0);
  const length = Math.max(clip.endSec - clip.startSec, 0.001);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        if (audio.currentTime >= clip.endSec) {
          audio.pause();
          audio.currentTime = clip.endSec;
        }
        setSec(audio.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip.endSec]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.currentTime < clip.startSec || audio.currentTime >= clip.endSec - 0.05) {
      audio.currentTime = clip.startSec;
    }
    try {
      await audio.play();
    } catch (error) {
      // A second tap while the clip still buffers pauses it, which rejects the pending
      // play() with AbortError: nothing failed. Anything else is a load the page must own.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
    }
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clip.startSec;
    setSec(clip.startSec);
  };

  const speakerIndex = indexSpeakers(clip.speakers);
  const current = currentTurnIndex(clip.turns, sec);
  const progress = Math.min(1, Math.max(0, (sec - clip.startSec) / length));
  const date = clip.meeting.recordedAt ? formatMeetingDate(clip.meeting.recordedAt) : null;

  return (
    <article className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-accent-strong">A clip shared with you</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{clip.meeting.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {date && <>{date} · </>}
          {formatTime(clip.startSec)} – {formatTime(clip.endSec)} ({Math.round(length)} s of the
          meeting)
        </p>
        {clip.note && <p className="mt-3 rounded-md bg-surface-raised p-3 text-sm">{clip.note}</p>}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 shadow-raised">
        {clip.audioUrl && !failed ? (
          <>
            <audio
              key={attempt}
              ref={audioRef}
              src={clip.audioUrl}
              preload="metadata"
              onLoadedMetadata={() => {
                if (audioRef.current) audioRef.current.currentTime = clip.startSec;
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="icon"
                className="rounded-full"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play clip"}
              >
                {playing ? (
                  <Pause className="size-5 fill-current" aria-hidden />
                ) : (
                  <Play className="size-5 translate-x-px fill-current" aria-hidden />
                )}
              </Button>
              <div className="min-w-0 flex-1">
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-raised"
                  role="progressbar"
                  aria-label="Clip progress"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(length)}
                  aria-valuenow={Math.round(sec - clip.startSec)}
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 flex justify-between text-xs text-fg-muted tabular-nums">
                  <span>{formatTime(Math.max(0, sec - clip.startSec))}</span>
                  <span>{formatTime(length)}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={restart}
                aria-label="Back to the start of the clip"
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            </div>
          </>
        ) : clip.meeting.isPublic ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              The audio couldn&apos;t be loaded right now. The words are below.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            This clip comes from a private meeting, so it&apos;s shared as text only.
          </p>
        )}
      </div>

      <section aria-label="What was said">
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          What was said
        </h2>
        <ol className="flex flex-col gap-1">
          {clip.turns.map((turn, index) => {
            const idx = speakerIndex.get(turn.speaker) ?? 0;
            const label = clip.speakers[idx]?.label ?? turn.speaker;
            return (
              <li
                key={turn.id}
                style={speakerStyle(idx)}
                aria-current={index === current ? "true" : undefined}
                className={cn(
                  "rounded-md border-l-[3px] py-1.5 pr-2 pl-3",
                  index === current ? "border-now-strong bg-now" : "border-transparent",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <SpeakerMark label={label} />
                  {label}
                  <span className="text-xs font-normal text-fg-muted tabular-nums">
                    {formatTime(turn.startSec)}
                  </span>
                </div>
                <p className="mt-0.5 pl-7 leading-relaxed">{turn.text}</p>
              </li>
            );
          })}
        </ol>
        {clip.turns.length === 0 && (
          <p className="text-sm text-fg-muted">Nobody spoke during this clip.</p>
        )}
      </section>

      <footer className="border-t border-border pt-4 text-xs leading-relaxed text-fg-subtle">
        {clip.meeting.isPublic && (
          <p>
            From a real research meeting in the{" "}
            <a
              href="https://groups.inf.ed.ac.uk/ami/icsi/"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              ICSI Meeting Corpus
            </a>{" "}
            (CC BY 4.0); speakers are anonymous. Only this clip is shared.
          </p>
        )}
        <p className="mt-2">
          Shared with{" "}
          <Link href="/" className="font-medium text-accent-strong underline">
            AFK.ai
          </Link>
          , the notetaker that sits in your meetings so you don&apos;t have to.
        </p>
      </footer>
    </article>
  );
}
