"use client";

import { useState } from "react";

import { chipClass } from "@/components/ui/button";
import { TimestampButton } from "@/components/ui/timestamp-button";
import { summaryFor } from "@/features/summaries/summary-sections";

import type { SharedItem } from "./shared-data";

/**
 * The summary on a shared meeting page: the templates the meeting has, the notes said
 * on the call, and the chosen template's points, each a click from its moment. The
 * same grouping the notes panel uses; none of its tabs, ticks or tasks.
 */
export function SharedSummary({
  items,
  turnStart,
  onSeek,
}: {
  items: ReadonlyArray<SharedItem>;
  turnStart: ReadonlyMap<string, number>;
  onSeek: (sec: number) => void;
}) {
  const [template, setTemplate] = useState<string | null>(null);
  const { available, current, sections, notes } = summaryFor(items, template);

  if (available.length === 0 && notes.length === 0) {
    return (
      <p className="rounded-md bg-surface-raised px-3 py-3 text-sm text-fg-muted" role="status">
        No summary was written for this meeting. The recording and the transcript are here.
      </p>
    );
  }

  const cite = (item: SharedItem) => {
    const sec = item.turnIds.map((id) => turnStart.get(id)).find((value) => value !== undefined);
    if (sec === undefined) return null;
    return (
      <TimestampButton
        sec={sec}
        onSeek={onSeek}
        extra={item.turnIds.length > 1 ? `+${item.turnIds.length - 1}` : undefined}
        className="ml-1.5 align-[1px]"
      />
    );
  };

  return (
    <section aria-label="Summary" className="flex flex-col gap-5">
      {available.length > 1 && (
        <div role="group" aria-label="Summary template" className="flex flex-wrap gap-1.5">
          {available.map((definition) => (
            <button
              key={definition.key}
              type="button"
              aria-pressed={definition.key === current?.key}
              onClick={() => setTemplate(definition.key)}
              title={definition.description}
              className={chipClass(definition.key === current?.key)}
            >
              {definition.name}
            </button>
          ))}
        </div>
      )}
      {current && <p className="-mt-2 text-xs text-fg-subtle">{current.description}</p>}
      {notes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Notes from the call
          </h3>
          <ul className="flex flex-col gap-2.5">
            {notes.map((note) => (
              <li key={note.id} className="flex gap-2.5 text-[0.95rem] leading-relaxed">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-warning" />
                <span>
                  {note.text}
                  {cite(note)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.map((section) => (
        <div key={section.heading}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {section.heading}
          </h3>
          <ul className="flex flex-col gap-2.5">
            {section.points.map((point) => (
              <li key={point.id} className="flex gap-2.5 text-[0.95rem] leading-relaxed">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" />
                <span>
                  {point.text}
                  {cite(point)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
