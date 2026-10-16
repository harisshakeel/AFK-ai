"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * The hero is the owner's twelve-second animation of what AFK does in a call, the full
 * screen, and the visitor's scroll is its playhead: a run five to seven screens tall holds
 * the stage, which sticks at the top of the viewport (the nav floats over it), and the
 * video's time follows how far down that run the page has gone, five to seven screens
 * for the whole animation, with an ease so it glides. No autoplay, no loop;
 * scrolling back rewinds. A visitor who prefers reduced motion gets a play button
 * instead, and the video plays on its own clock.
 *
 * The animation has no sound and is an illustration, not a recording; its captions track
 * says so, and nothing is written over the frame (owner's call). The stage is
 * the animation's own cream (the `stage` token), so the frame has no visible edge at any
 * viewport shape. On a phone the frame is wider than
 * the screen, so the cards in its middle fill the width and the empty margins fall off
 * the sides; on a laptop it fits the viewport whole. Phones load nothing until a video
 * has been asked to play, so a muted play-then-pause wakes the decoder before the first
 * seek. The captions track describes what happens on screen, and the headline follows
 * in the next section.
 */
/** The scroll ends on "Go AFK. Come back to the notes.", before the animation loops back. */
const SCRUB_END_SEC = 10.6;
/** How much of the gap to the scroll's target the playhead closes per frame: the ease. */
const EASE_PER_FRAME = 0.1;
/**
 * At the top of the page the waveform keeps moving: the opening plays to just before the
 * first speech bubble appears, then starts over, always forward, until the first scroll
 * takes the playhead. Scrolling back to the top resumes it.
 */
const IDLE_LOOP_END_SEC = 0.62;
/** The idle loop runs slower than real time, so the waves drift rather than flicker. */
const IDLE_PLAYBACK_RATE = 0.6;

export function Hero() {
  const reduce = useReducedMotion();
  const runRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Scroll drives the playhead, with an ease: each frame the playhead closes part of the
  // gap to where the scroll says it should be, so a flick plays as a glide, not a jump.
  // Seeks happen only while there is a gap worth a frame, so the decoder is never flooded.
  // At the top, with no scroll yet, the opening breathes on a loop instead.
  useEffect(() => {
    const run = runRef.current;
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!run || !stage || !video || reduce) return;
    let frame = 0;
    let woken = false;
    let target = 0;
    let shown = 0;
    let idle = false;
    let idleFrame = 0;
    // The loop: play natively until the bubble is about to appear, then start over; the
    // waves only ever move forward.
    const idleTick = () => {
      idleFrame = 0;
      if (!idle) return;
      if (video.currentTime >= IDLE_LOOP_END_SEC) {
        video.currentTime = 0;
      } else if (video.paused && video.readyState >= 2) {
        // Something paused it (a wake, a tab switch): keep going.
        void video.play().catch(() => undefined);
      }
      idleFrame = requestAnimationFrame(idleTick);
    };
    const enterIdle = () => {
      idle = true;
      shown = 0;
      video.playbackRate = IDLE_PLAYBACK_RATE;
      video.currentTime = 0;
      void video.play().catch(() => undefined);
      if (!idleFrame) idleFrame = requestAnimationFrame(idleTick);
    };
    const leaveIdle = () => {
      idle = false;
      cancelAnimationFrame(idleFrame);
      idleFrame = 0;
      video.pause();
      video.playbackRate = 1;
      shown = video.currentTime;
    };
    // A muted inline video may be played without a gesture; one play-then-pause makes
    // the browser fetch and decode it, which seeking alone does not on iOS. While the
    // idle loop is running it is the one playing, so it is left alone.
    const wake = () => {
      if (woken) return;
      woken = true;
      void video
        .play()
        .then(() => {
          if (!idle) video.pause();
        })
        .catch(() => undefined);
    };
    const update = () => {
      frame = 0;
      const travel = run.offsetHeight - stage.offsetHeight;
      const top = run.getBoundingClientRect().top;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -top / travel)) : 0;
      if (!Number.isFinite(video.duration)) return;
      if (progress === 0) {
        if (!idle) enterIdle();
        return;
      }
      if (idle) leaveIdle();
      target = progress * Math.min(video.duration, SCRUB_END_SEC);
      const gap = target - shown;
      if (Math.abs(gap) < 1 / 60) return;
      shown = Math.abs(gap) < 0.05 ? target : shown + gap * EASE_PER_FRAME;
      video.currentTime = shown;
      frame = requestAnimationFrame(update);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    video.addEventListener("loadedmetadata", schedule);
    video.addEventListener("loadeddata", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("touchstart", wake, { passive: true });
    window.addEventListener("resize", schedule);
    if (video.readyState < 2) wake();
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(idleFrame);
      idle = false;
      video.removeEventListener("loadedmetadata", schedule);
      video.removeEventListener("loadeddata", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("resize", schedule);
    };
  }, [reduce]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  return (
    <section ref={runRef} data-scrub className={reduce ? "" : "h-[480vh] lg:h-[700vh]"}>
      <figure
        ref={stageRef}
        className={`relative m-0 overflow-hidden bg-stage ${reduce ? "aspect-video max-h-svh w-full" : "sticky top-0 h-svh"}`}
      >
        <video
          ref={videoRef}
          className="absolute top-1/2 left-1/2 w-[140%] max-w-none -translate-x-1/2 -translate-y-1/2 lg:static lg:size-full lg:translate-x-0 lg:translate-y-0 lg:object-contain"
          poster="/landing/hero.png"
          muted
          playsInline
          preload="auto"
          loop={reduce}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label="Twelve-second animation: AFK listens to a call, captures a decision and an action item, writes the summary, and keeps the transcript line each one came from"
        >
          <source src="/landing/hero.mp4" type="video/mp4" />
          <source src="/landing/hero.webm" type="video/webm" />
          <track kind="captions" src="/landing/hero.vtt" srcLang="en" label="What happens" />
        </video>
        {reduce && (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause the animation" : "Play the animation"}
            className="absolute right-4 bottom-4 grid size-11 place-items-center rounded-full bg-fg/85 text-canvas shadow-raised backdrop-blur transition hover:bg-fg focus-visible:ring-3 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            {playing ? (
              <Pause className="size-4 fill-current" aria-hidden />
            ) : (
              <Play className="size-4 translate-x-px fill-current" aria-hidden />
            )}
          </button>
        )}
      </figure>
    </section>
  );
}
