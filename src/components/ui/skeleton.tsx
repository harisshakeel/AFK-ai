import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/** A loading placeholder the shape of what is coming (globals.css `skeleton`). */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />;
}
