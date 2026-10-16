import { WaveLoader } from "@/components/ui/wave-loader";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One button everywhere, pill-shaped, with a body you can feel. The filled one is a violet keycap: a
 * gradient face, a lit top edge, a deep edge beneath it that the press collapses, a
 * tinted glow that grows on hover, and a shine that sweeps across the face. The quiet
 * ones sit on a lighter keycap edge and press the same way. Both lean toward the
 * pointer (the `magnet` class, see interactions.tsx). Focus draws a soft ring in the
 * accent. Icons inside size themselves to the button, so callers need not.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline-danger";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const SHINE =
  "after:pointer-events-none after:absolute after:inset-0 after:-translate-x-[130%] after:bg-[linear-gradient(110deg,transparent_35%,var(--color-shine)_50%,transparent_65%)] after:transition-transform after:duration-700 after:ease-out hover:after:translate-x-[130%] motion-reduce:after:hidden";

const variants: Record<Variant, string> = {
  primary: cn(
    "magnet relative overflow-hidden border-0 text-on-accent",
    "bg-[linear-gradient(180deg,var(--color-accent)_0%,var(--color-accent-strong)_100%)]",
    "shadow-press hover:-translate-y-0.5 hover:shadow-press-hover",
    "active:translate-y-[3px] active:shadow-press-down",
    "focus-visible:ring-accent/30 disabled:hover:translate-y-0",
    SHINE,
  ),
  secondary: cn(
    "magnet relative border border-border bg-surface text-fg",
    "shadow-keycap hover:-translate-y-0.5 hover:border-border-strong hover:shadow-keycap-hover",
    "active:translate-y-[2px] active:shadow-keycap-down",
    "focus-visible:ring-accent/25 disabled:hover:translate-y-0 disabled:hover:border-border",
  ),
  ghost:
    "text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:ring-accent/25 disabled:hover:bg-transparent disabled:hover:text-fg-muted",
  danger:
    "text-danger hover:bg-danger/10 focus-visible:ring-danger/25 disabled:hover:bg-transparent",
  "outline-danger":
    "border border-danger/40 bg-surface text-danger shadow-key hover:border-danger hover:bg-danger/8 focus-visible:ring-danger/25 active:shadow-xs disabled:hover:border-danger/40 disabled:hover:bg-surface",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-[0.8125rem] [&_svg]:size-3.5",
  md: "h-10 gap-2 rounded-full px-4 text-sm [&_svg]:size-4",
  lg: "h-12 gap-2.5 rounded-full px-6 text-[0.95rem] [&_svg]:size-[1.125rem]",
  icon: "size-10 rounded-full [&_svg]:size-[1.125rem]",
  "icon-sm": "size-8 rounded-full [&_svg]:size-4",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium tracking-[-0.005em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow,translate,opacity] duration-200 ease-out select-none [&_svg]:shrink-0",
    "focus-visible:ring-3 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner in place of the leading icon and blocks a second press. */
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <WaveLoader className="h-[1em]" label={null} />}
      {children}
    </button>
  );
}

/**
 * A toggle chip: a template, a speaker, an answer. Pressed chips fill with the accent;
 * the rest sit quietly until hovered. Pair it with `aria-pressed` so the state is spoken.
 */
export function chipClass(on: boolean, extra?: string) {
  return cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 select-none focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
    on
      ? "border-accent bg-accent text-on-accent shadow-accent"
      : "border-border bg-surface text-fg-muted shadow-key hover:border-border-strong hover:text-fg",
    extra,
  );
}

/** A keyboard key, for shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface px-1 font-mono text-[0.68rem] leading-4 text-fg-muted shadow-key">
      {children}
    </kbd>
  );
}
