"use client";

import { motion, useInView, useScroll, useSpring } from "framer-motion";
import {
  FileText,
  Headphones,
  Link2,
  type LucideIcon,
  Mic,
  Scissors,
  Send,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useRef } from "react";

import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { GmailMark, GoogleCalendarMark, SlackMark } from "@/features/connectors/brand-marks";

import { TypedLines } from "./typed-lines";

/**
 * The route through the product, as a timeline: a spine that draws itself as the page
 * scrolls, a coin for each stop that lights and flips as it comes into view, and the
 * stop's title and one line. On a laptop the stops alternate sides of the spine; on a
 * phone they stack beside it. The sixth stop carries the tools AFK acts through. Every
 * claim is something the app does today. With reduced motion the spine is drawn and
 * every coin is lit from the start.
 */
type Tool = { name: string; icon: React.ComponentType<{ className?: string }> };
type Stop = { title: string; body: ReactNode; icon: LucideIcon; tools?: Tool[] };

const STOPS: Stop[] = [
  {
    title: "Drop the link.",
    icon: Link2,
    body: "Meet, Zoom or Teams. Paste it on the dashboard, press Send AFK, then go be somewhere else.",
  },
  {
    title: "AFK takes your seat.",
    icon: Headphones,
    body: "It joins as an audio-only guest and listens. No avatar, no small talk, no camera.",
  },
  {
    title: "Say the magic word.",
    icon: Mic,
    body: (
      <>
        <TypedLines
          lines={["“AFK, decision: we ship Friday.”", "“AFK, task: Sam sends the deck.”"]}
          className="block font-medium text-fg"
        />
        Said once, written down. No post-meeting archaeology.
      </>
    ),
  },
  {
    title: "The notes land.",
    icon: FileText,
    body: "Summary, decisions and action items, each stamped with the moment it was said. Click one, hear it. Receipts.",
  },
  {
    title: "It asks before it sends.",
    icon: ShieldCheck,
    body: "Every email, invite and Slack post waits in Tasks for your one click. Confident, not reckless.",
  },
  {
    title: "Then it does the thing.",
    icon: Send,
    body: "The follow-up goes out, the next call gets booked, the team gets told, all from your own accounts.",
    tools: [
      { name: "Gmail", icon: GmailMark },
      { name: "Google Calendar", icon: GoogleCalendarMark },
      { name: "Slack", icon: SlackMark },
    ],
  },
  {
    title: "Share what you choose.",
    icon: Scissors,
    body: "Private by default. A clip is all anyone sees. Nobody else’s meetings, ever.",
  },
];

export function FeatureFlow() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLOListElement | null>(null);
  // The spine draws from the first coin to the last as they pass the lower third.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 72%", "end 72%"] });
  const drawn = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 });

  return (
    <ol ref={ref} aria-label="How AFK works" className="relative mt-14 lg:mt-20">
      <div
        aria-hidden
        className="absolute top-6 bottom-6 left-6 w-px bg-border lg:left-1/2 lg:-translate-x-px"
      >
        <motion.div
          className="absolute inset-0 origin-top bg-accent"
          style={{ scaleY: reduce ? 1 : drawn }}
        />
      </div>
      {STOPS.map((stop, index) => (
        <FlowStop key={stop.title} stop={stop} index={index} />
      ))}
    </ol>
  );
}

function FlowStop({ stop, index }: { stop: Stop; index: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLLIElement | null>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -30% 0px" });
  const lit = reduce || seen;
  const Icon = stop.icon;
  const right = index % 2 === 1;

  return (
    <li
      ref={ref}
      className="relative grid grid-cols-[3rem_1fr] gap-x-4 pb-14 [perspective:800px] last:pb-0 lg:grid-cols-[1fr_4rem_1fr] lg:gap-x-8"
    >
      <div
        className={cn(
          "relative z-[1] col-start-1 row-start-1 flex size-12 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow] duration-500 lg:col-start-2 lg:size-14 lg:justify-self-center",
          lit
            ? "border-accent bg-[linear-gradient(180deg,var(--color-accent),var(--color-accent-strong))] text-on-accent shadow-coin motion-safe:animate-coin"
            : "border-border bg-surface text-fg-subtle shadow-keycap",
        )}
      >
        <Icon className="size-5 lg:size-6" aria-hidden />
      </div>
      <Reveal
        delay={0.05}
        className={cn("col-start-2 row-start-1", right ? "lg:col-start-3" : "lg:col-start-1")}
      >
        <div
          className={cn(
            "max-w-md pt-2.5 lg:pt-3",
            right ? "" : "lg:ml-auto lg:text-right",
            index === STOPS.length - 1 ? "pb-2" : "",
          )}
        >
          <span className="font-mono text-[0.68rem] font-medium tracking-[0.14em] text-fg-subtle uppercase">
            Stop {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-1 font-display text-2xl tracking-tight sm:text-3xl">{stop.title}</h3>
          <p className="mt-2 leading-relaxed text-fg-muted">{stop.body}</p>
          {stop.tools && (
            <ul
              aria-label="Tools"
              className={cn("mt-4 flex flex-wrap gap-2", right ? "" : "lg:justify-end")}
            >
              {stop.tools.map((tool) => {
                const ToolIcon = tool.icon;
                return (
                  <li
                    key={tool.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1.5 pr-3.5 pl-3 text-sm font-medium text-fg shadow-keycap transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-keycap-hover"
                  >
                    <ToolIcon className="size-4" />
                    {tool.name}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Reveal>
    </li>
  );
}
