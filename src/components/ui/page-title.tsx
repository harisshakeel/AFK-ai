import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Eyebrow } from "./badge";

/** The title block of a list-style page: a small label, the title in the display face, a line under it. */
export function PageTitle({
  eyebrow,
  title,
  lede,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="max-w-2xl">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-[2.75rem]">
          {title}
        </h1>
        {lede && <p className="mt-2 text-[0.95rem] leading-relaxed text-fg-muted">{lede}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
