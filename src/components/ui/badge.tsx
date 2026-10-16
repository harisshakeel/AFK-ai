import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "accent" | "neutral" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-strong",
  neutral: "bg-surface-raised text-fg-muted",
  success: "bg-success/12 text-success-strong",
  warning: "bg-warning/15 text-fg",
  danger: "bg-danger/10 text-danger-strong",
};

/** A small label: a status, a kind ("Decision"), a count. Never the only cue. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A section's small label above its heading, set in mono capitals. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p
      className={cn(
        "font-mono text-[0.7rem] font-medium tracking-[0.14em] text-accent-strong uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}
