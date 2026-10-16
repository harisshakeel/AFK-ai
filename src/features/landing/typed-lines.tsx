"use client";

import { useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Lines typed out one character at a time with a blinking caret, one line after the
 * other. Driven by a clock (`drive="time"`, the default) the typing starts the first
 * time the block scrolls into view and runs on its own: the spoken commands on the
 * route. Driven by the scroll (`drive="scroll"`) the characters follow how far the block
 * has come up the screen, forward and back, the way the animation above plays by the
 * scroll: the claim. The full text is always in the DOM for assistive tech and search;
 * the typing is a visual on top of it. Each line can have a face of its own. With
 * reduced motion the lines are simply shown.
 */
const CHAR_MS = 28;
const LINE_PAUSE_MS = 650;
/** By scroll, the typing runs while the block rises from the bottom edge to a third of the way up. */
const SCROLL_RANGE = ["start 100%", "start 32%"] as const;

export function TypedLines({
  lines,
  className,
  lineClassNames = [],
  drive = "time",
}: {
  lines: string[];
  className?: string;
  /** Classes for each line, by index; every line is a block. */
  lineClassNames?: string[];
  drive?: "time" | "scroll";
}) {
  const reduce = useReducedMotion();
  const byScroll = drive === "scroll";
  const ref = useRef<HTMLSpanElement | null>(null);
  // How many characters of the joined text are shown; -1 until the typing has begun.
  const [shown, setShown] = useState(-1);
  const joined = lines.join("\n");
  const total = joined.length;

  // By scroll: the block's progress up the viewport, eased so a flick glides, mapped onto
  // the characters. The hooks run either way; only the scroll drive listens.
  const { scrollYProgress } = useScroll({ target: ref, offset: [...SCROLL_RANGE] });
  const eased = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  // The first measurement after mount is a change too, so a page restored mid-way starts
  // with the right amount typed.
  useMotionValueEvent(eased, "change", (value) => {
    if (byScroll && !reduce) setShown(Math.round(value * total));
  });

  // By the clock: start the first time the block is on screen, then tick.
  useEffect(() => {
    const element = ref.current;
    if (!element || reduce || byScroll) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((value) => (value < 0 ? 0 : value));
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduce, byScroll]);

  useEffect(() => {
    if (reduce || byScroll || shown < 0 || shown >= total) return;
    const atLineEnd = joined[shown - 1] === "\n";
    const timer = setTimeout(
      () => setShown((value) => value + 1),
      atLineEnd ? LINE_PAUSE_MS : CHAR_MS,
    );
    return () => clearTimeout(timer);
  }, [reduce, byScroll, shown, total, joined]);

  const done = reduce || shown >= total;
  const visible = reduce ? total : Math.max(0, shown);
  // Where each line starts in the joined text (every line before it, plus its newline).
  const starts = lines.map((_, index) =>
    lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0),
  );
  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{lines.join(" ")}</span>
      <span aria-hidden>
        {lines.map((line, index) => {
          const start = starts[index] ?? 0;
          const count = Math.min(line.length, Math.max(0, visible - start));
          // The caret sits after the last typed character, on the line being typed.
          const caretHere =
            !done && shown >= 0 && visible >= start && visible <= start + line.length;
          return (
            <span key={`${index}-${line}`} className={cn("block", lineClassNames[index])}>
              {/* A zero-width space keeps an untyped line's height, so nothing jumps. */}
              {count > 0 ? line.slice(0, count) : "​"}
              {caretHere && (
                <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-caret bg-accent align-baseline" />
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}
