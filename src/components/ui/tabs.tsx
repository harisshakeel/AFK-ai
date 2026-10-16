"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Accessible tabs (WAI-ARIA tabs pattern): one tab stop, arrow keys move between tabs,
 * Home/End jump to the ends. Panels are rendered by the caller with `tabPanelProps`.
 * Drawn as an underline strip: the selected tab's rule sits on the list's bottom border.
 */
export type TabItem<K extends string> = { key: K; label: ReactNode; count?: number };

export function Tabs<K extends string>({
  id,
  label,
  items,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  const refs = useRef(new Map<K, HTMLButtonElement | null>());

  // On a narrow screen the list scrolls sideways: when the page selects a tab (after a
  // highlight, say), bring it into view. Only on a change, never on mount: scrolling an
  // element into view also moves where the next Tab press starts from in Chromium, and
  // a keyboard user who just opened the page expects to start at the top. (A plain
  // "first run" flag is not enough: in development React runs mount effects twice.)
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    refs.current.get(value)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.key === value);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    const item = items[next];
    if (next < 0 || !item) return;
    event.preventDefault();
    onChange(item.key);
    refs.current.get(item.key)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(element) => {
              refs.current.set(item.key, element);
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`${id}-panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cn(
              "relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-t-md px-3 text-sm font-medium whitespace-nowrap transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:transition-colors",
              selected
                ? "text-fg after:bg-accent"
                : "text-fg-muted after:bg-transparent hover:bg-surface-raised/70 hover:text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[0.7rem] tabular-nums",
                  selected
                    ? "bg-accent-soft text-accent-strong"
                    : "bg-surface-raised text-fg-muted",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(id: string, key: string) {
  return {
    role: "tabpanel" as const,
    id: `${id}-panel-${key}`,
    "aria-labelledby": `${id}-tab-${key}`,
    tabIndex: 0,
  };
}
