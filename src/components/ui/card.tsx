import { cn } from "@/lib/cn";

/** The surface every list item, result and panel sits on. Hoverable cards add `interactive`. */
export function cardClass({
  interactive = false,
  extra,
}: { interactive?: boolean; extra?: string } = {}) {
  return cn(
    "rounded-xl border border-border bg-surface shadow-xs",
    interactive &&
      "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-border-strong hover:shadow-raised",
    extra,
  );
}
