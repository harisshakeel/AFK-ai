"use client";

import Link from "next/link";
import { useState } from "react";

import type { AddressEntry } from "@/features/connectors/address-book";
import type { ConnectorView } from "@/features/connectors/registry";
import type { SkillSettings } from "@/features/memory/files";
import { createPlayhead } from "@/lib/playhead";

import { CommandCard } from "./tasks-tab";
import type { TaskRow } from "./tasks-queries";

/**
 * The cards awaiting approval, away from their meetings (the dashboard, the Tasks page):
 * the same card and form as the meeting's Tasks tab, grouped under the meeting each
 * came from. No player here, so a card's moment is a link to the meeting instead of a
 * seek; approving, dismissing and rewriting work exactly as on the meeting page.
 */
const NO_TURNS: ReadonlyMap<string, number> = new Map();
const noSeek = () => {};

export function ApprovalCards({
  tasks,
  connectors,
  addressBook,
  skills,
}: {
  tasks: ReadonlyArray<TaskRow>;
  connectors: ReadonlyArray<ConnectorView>;
  addressBook: ReadonlyArray<AddressEntry>;
  skills: SkillSettings;
}) {
  // A card's form reads a playhead only for typed commands, which this list has none of.
  const [playhead] = useState(() => createPlayhead(0));
  const meetings = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const list = meetings.get(task.meetingId) ?? [];
    list.push(task);
    meetings.set(task.meetingId, list);
  }
  return (
    <div className="flex flex-col gap-5">
      {[...meetings.entries()].map(([meetingId, rows]) => (
        <section key={meetingId} aria-label={rows[0]!.meetingTitle}>
          <h3 className="mb-2 text-sm font-medium text-fg-muted">
            From{" "}
            <Link
              href={`/meetings/${meetingId}?tab=tasks`}
              className="text-accent-strong underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              {rows[0]!.meetingTitle}
            </Link>
          </h3>
          <ol className="flex flex-col gap-3">
            {rows.map((task) => (
              <CommandCard
                key={task.id}
                command={task}
                meetingId={meetingId}
                isOwn
                commands={rows}
                host={{ label: null, detectedBy: null }}
                speakers={[]}
                turnStart={NO_TURNS}
                onSeek={noSeek}
                playhead={playhead}
                connectors={connectors}
                addressBook={addressBook}
                skills={skills}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
