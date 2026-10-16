import { cn } from "@/lib/cn";
import { speakerMark } from "@/lib/speakers";

/** A speaker's mark: their colour (from the enclosing speakerStyle) plus a letter or initials. */
export function SpeakerMark({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full bg-(--speaker) text-[0.65rem] font-semibold text-white",
        className,
      )}
    >
      {speakerMark(label)}
    </span>
  );
}
