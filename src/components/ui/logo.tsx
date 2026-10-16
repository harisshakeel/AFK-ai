import { cn } from "@/lib/cn";

/**
 * The AFK.ai mark: an empty chair in profile, and at head height, where the sitter's
 * face would be, one amber line of the transcript. You are away from keyboard; the
 * meeting carries on, and what is said still lands in your notes. The amber is the
 * product's own "now" colour. No container: it sits on any background in the text
 * colour. Drawn once here and mirrored in src/app/icon.svg, apple-icon.tsx,
 * opengraph-image.tsx and public/brand/.
 */
export const MARK_PATHS = ["M15 8L21 38", "M16 38H46", "M21 38L17 56", "M46 38L50 56"] as const;
export const MARK_LINE = "M32 20H45";

export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
      <path d={MARK_LINE} className="stroke-now-strong" />
    </svg>
  );
}

/** The mark beside the name. `.ai` is quieter, so "AFK" is what people read. */
export function Wordmark({
  className,
  markClassName = "size-8",
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight text-fg",
        className,
      )}
    >
      <Logo className={markClassName} />
      <span>
        AFK<span className="text-fg-muted">.ai</span>
      </span>
    </span>
  );
}
