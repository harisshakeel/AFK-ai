"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createPlayhead, type Playhead } from "@/lib/playhead";
import { clampTime } from "@/lib/time-rules";

/**
 * The meeting's media element and its playhead: the hidden audio of a seed meeting or
 * the video of a bot meeting, both an HTMLMediaElement. While playing, the time is read
 * every animation frame (timeupdate alone fires about four times a second, too coarse
 * for the 250 ms sync target). The timeline is the meeting's durationSec: playback stops
 * there even when the file runs longer (the corpus recordings end with a digit-reading
 * task).
 *
 * The element may be replaced under the player: a recording's short-lived link renewed
 * (a new `key`), or the video moving between the phone and the desktop layout. When the
 * old element goes, its position and whether it was playing are kept, and the new one
 * picks both up once its metadata has loaded.
 */
export type MediaState = "idle" | "loading" | "ready" | "error";

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/** Where the next element to load should start, and whether it should play. */
type Resume = { sec: number; playing: boolean };

export function useMediaPlayer({
  hasSource,
  durationSec,
  initialTimeSec,
}: {
  hasSource: boolean;
  durationSec: number;
  initialTimeSec: number;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [playhead] = useState<Playhead>(() => createPlayhead(initialTimeSec));
  const [playing, setPlaying] = useState(false);
  // The same as `playing`, readable from the ref callback, which runs outside a render.
  const playingRef = useRef(false);
  const [rate, setRateState] = useState<number>(1);
  const rateRef = useRef(1);
  const [state, setState] = useState<MediaState>(hasSource ? "loading" : "idle");
  const resume = useRef<Resume | null>(
    initialTimeSec > 0 ? { sec: initialTimeSec, playing: false } : null,
  );
  const endRef = useRef(durationSec);
  useEffect(() => {
    endRef.current = durationSec;
  }, [durationSec]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const media = mediaRef.current;
      if (media) {
        if (media.currentTime >= endRef.current) {
          media.pause();
          media.currentTime = endRef.current;
        }
        playhead.set(media.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, playhead]);

  const seek = useCallback(
    (sec: number) => {
      const target = clampTime(sec, endRef.current);
      playhead.set(target);
      const media = mediaRef.current;
      if (media && media.readyState >= 1) media.currentTime = target;
      else resume.current = { sec: target, playing: resume.current?.playing ?? false };
    },
    [playhead],
  );

  const play = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.currentTime >= endRef.current - 0.05) media.currentTime = 0;
    try {
      await media.play();
    } catch {
      // Refusals and aborted loads surface through the element's own events.
    }
  }, []);

  const pause = useCallback(() => mediaRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void play();
    else media.pause();
  }, [play]);

  const setRate = useCallback((next: number) => {
    rateRef.current = next;
    setRateState(next);
    if (mediaRef.current) mediaRef.current.playbackRate = next;
  }, []);

  const onMetadata = useCallback(
    (media: HTMLMediaElement) => {
      media.playbackRate = rateRef.current;
      setState("ready");
      const pending = resume.current;
      if (pending) {
        resume.current = null;
        media.currentTime = pending.sec;
        if (pending.playing) void play();
      }
    },
    [play],
  );

  // One callback for the element's lifetime: React re-attaches a ref callback whose
  // identity changed on every render, calling it with null in between, which would
  // read as the element going away.
  const attach = useCallback(
    (media: HTMLMediaElement | null) => {
      const previous = mediaRef.current;
      // An element going after it had loaded (a renewed link, a layout change): keep its
      // place. One detached before its metadata arrived has no place to keep, and the
      // pending seek stands; dev-mode StrictMode detaches every ref once right after
      // attaching it, which must not erase a ?t= position.
      if (media === null && previous && previous.readyState >= 1) {
        resume.current = {
          sec: previous.currentTime,
          playing: playingRef.current && !previous.ended,
        };
        setState("loading");
      }
      mediaRef.current = media;
      // The element is server-rendered, so its metadata can load, or its load can fail,
      // before React attaches the handlers below; a ?t= link would then leave the media
      // at 0:00, and a failed load would never be reported. Catch up on both here.
      if (media && media.readyState >= 1) onMetadata(media);
      else if (media?.error) setState("error");
    },
    [onMetadata],
  );

  const mediaProps = {
    ref: attach,
    preload: "metadata" as const,
    onLoadedMetadata: () => {
      if (mediaRef.current) onMetadata(mediaRef.current);
    },
    onPlay: () => {
      playingRef.current = true;
      setPlaying(true);
    },
    onPause: () => {
      playingRef.current = false;
      setPlaying(false);
      if (mediaRef.current) playhead.set(mediaRef.current.currentTime);
    },
    onEnded: () => {
      playingRef.current = false;
      setPlaying(false);
    },
    onSeeked: () => {
      if (mediaRef.current) playhead.set(mediaRef.current.currentTime);
    },
    onError: () => {
      playingRef.current = false;
      setPlaying(false);
      setState("error");
    },
  };

  return { mediaProps, playhead, playing, rate, state, seek, play, pause, toggle, setRate };
}

export type MediaPlayer = ReturnType<typeof useMediaPlayer>;
