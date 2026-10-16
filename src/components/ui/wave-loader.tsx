import { cn } from "@/lib/cn";

/**
 * The loader everywhere: five bars that rise and fall in turn, the hero animation's
 * listening wave in miniature, in place of a spinner. It is as tall as its text line
 * unless sized, and takes the text colour. `label` is what assistive tech hears; pass
 * null inside a control that already says it is busy (a button with aria-busy).
 */
export function WaveLoader({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string | null;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex h-[1em] shrink-0 items-center gap-[2px]", className)}
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className="h-full w-[2px] origin-center rounded-full bg-current motion-safe:animate-wave motion-reduce:scale-y-60"
          style={{ animationDelay: `${index * 0.11}s` }}
        />
      ))}
    </span>
  );
}
