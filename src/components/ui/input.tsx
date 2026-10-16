import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * One text field everywhere: the header search, the send form, find-in-meeting, the typed
 * command. The focus ring replaces the page's outline so the field reads as one shape.
 */
export function inputClass(extra?: string) {
  return cn(
    "h-10 w-full rounded-full border border-border bg-surface px-4 text-sm text-fg shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20 disabled:cursor-not-allowed disabled:opacity-50",
    extra,
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...props} />;
}
