"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * The one way things arrive on screen, on the landing and in the app: a short rise and
 * fade as the block scrolls into view, once. `delay` staggers siblings. With reduced
 * motion the transition is zero-length, so the markup is the same and nothing is left
 * hidden; the server renders the start state and the client picks it up.
 */
const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  className,
  y = 14,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
  /** A list item when the parent is a list: nothing may sit between a ul and its li. */
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion();
  const Element = as === "li" ? motion.li : motion.div;
  return (
    <Element
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={reduce ? { duration: 0 } : { delay, duration: 0.6, ease: EASE }}
    >
      {children}
    </Element>
  );
}

/**
 * A heading whose words rise out of a clipped line, one after another, when it scrolls
 * into view. The heading as a whole is what is watched: a word still below its clipped
 * line is never "in view" on its own. The words stay real text, read in order by
 * assistive tech and search.
 */
const WORD = { hidden: { y: "110%" }, shown: { y: 0 } };

export function RevealWords({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <motion.span
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
    >
      {words.map((word, index) => (
        <span key={`${word}-${index}`} className="inline-block overflow-hidden align-bottom">
          <motion.span
            className="inline-block"
            variants={WORD}
            transition={
              reduce ? { duration: 0 } : { delay: delay + index * 0.06, duration: 0.7, ease: EASE }
            }
          >
            {word}
          </motion.span>
          {index < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </motion.span>
  );
}
