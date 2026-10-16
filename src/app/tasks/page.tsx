import type { Metadata } from "next";
import Link from "next/link";

import { Chrome } from "@/components/chrome";
import { SendBotLink } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import {
  COMMAND_STATUS_LABEL,
  COMMAND_STATUS_TONE,
  resultSummary,
} from "@/features/commands/command-view";
import { commandSpec, COMMANDS, isActive } from "@/features/commands/registry";
import { ApprovalCards } from "@/features/commands/approval-cards";
import { listTasks, TASKS_LIMIT, type TaskRow } from "@/features/commands/tasks-queries";
import { EMPTY_SKILLS } from "@/features/memory/files";
import { loadSkillSettings } from "@/features/memory/memory-queries";
import { formatMeetingDate } from "@/lib/format-date";
import { getViewer } from "@/server/auth/viewer";
import { listConnectors, loadAddressBook } from "@/server/connectors/store";

export const metadata: Metadata = { title: "Tasks", robots: { index: false, follow: false } };

/**
 * The record of everything AFK heard or was told across your meetings (requirement C7),
 * newest first, with its state. The ones waiting for approval come first as the same
 * cards the meeting's Tasks tab shows, approvable here; the rest link to their meeting.
 * Guests see their own too (Row Level Security reads the caller); a visitor with no
 * workspace yet sees none.
 */
export default async function TasksPage() {
  const viewer = await getViewer();
  const own = Boolean(viewer.userId);
  const [tasks, connectors, addressBook, skills] = await Promise.all([
    own ? listTasks() : Promise.resolve([]),
    own ? listConnectors() : Promise.resolve([]),
    own ? loadAddressBook() : Promise.resolve([]),
    own && !viewer.isAnonymous ? loadSkillSettings() : Promise.resolve(EMPTY_SKILLS),
  ]);
  const open = tasks.filter((task) => task.status === "proposed");
  const rest = tasks.filter((task) => task.status !== "proposed");
  // Newest first, so the last open one is the oldest.
  const oldest = open.length > 0 ? open[open.length - 1]!.createdAt : null;
  return (
    <Chrome actions={<SendBotLink />}>
      <>
        <PageTitle
          eyebrow="Tasks"
          title="What AFK heard, and did"
          lede="Every command from your meetings, spoken or typed, with where it stands. The ones waiting for you come first: approve, rewrite or dismiss them here, or on the meeting's Tasks tab next to the moment they were said."
          className="mb-8"
        />
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
            <p className="font-display text-2xl font-medium tracking-tight">Nothing yet</p>
            <p className="mx-auto mt-2 max-w-prose text-sm text-fg-muted">
              In a call, start a sentence with &ldquo;AFK&rdquo; and it lands here after the call:{" "}
              {COMMANDS.filter(isActive)
                .map((command) => command.slash)
                .join(", ")}
              . Or type one on any meeting&apos;s Tasks tab.
            </p>
            <Link href="/send" className={buttonClass("primary", "md", "mt-6")}>
              Send AFK to a meeting
            </Link>
          </div>
        ) : (
          <>
            {open.length > 0 && (
              <section aria-labelledby="waiting-title" className="mb-8">
                <h2
                  id="waiting-title"
                  className="mb-3 flex items-center gap-2 text-lg font-semibold"
                >
                  Waiting for you
                  <Badge tone="warning">{open.length}</Badge>
                  {oldest && (
                    <span className="text-sm font-normal text-fg-muted">
                      the oldest since {formatMeetingDate(oldest)}
                    </span>
                  )}
                </h2>
                <ApprovalCards
                  tasks={open}
                  connectors={connectors}
                  addressBook={addressBook}
                  skills={skills}
                />
              </section>
            )}
            {rest.length > 0 && open.length > 0 && (
              <h2 className="mb-3 text-lg font-semibold">The record</h2>
            )}
            <ul className="flex flex-col gap-2.5">
              {rest.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </ul>
            {tasks.length >= TASKS_LIMIT && (
              <p className="mt-6 text-xs text-fg-subtle">
                Showing the latest {TASKS_LIMIT}. Older ones stay on their meetings&apos; Tasks
                tabs.
              </p>
            )}
          </>
        )}
      </>
    </Chrome>
  );
}

function TaskCard({ task }: { task: TaskRow }) {
  const label = task.kind === "unknown" ? "Not a command" : commandSpec(task.kind).label;
  const href = `/meetings/${task.meetingId}?tab=tasks`;
  return (
    <li className={cardClass({ interactive: true, extra: "p-4" })}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="font-medium text-fg">{label}</span>
            <span className="font-mono text-[0.7rem]">{task.source}</span>
            <Badge tone={COMMAND_STATUS_TONE[task.status]}>
              {COMMAND_STATUS_LABEL[task.status]}
            </Badge>
          </p>
          <p className="mt-1.5 text-[0.95rem] leading-snug">&ldquo;{task.sentence}&rdquo;</p>
          {task.status === "done" && resultSummary(task.result) && (
            <p className="mt-1 text-xs text-fg-muted">{resultSummary(task.result)}</p>
          )}
          {task.error && <p className="mt-1 text-xs text-danger">{task.error}</p>}
        </div>
        <Link
          href={href}
          className="shrink-0 text-sm font-medium text-accent-strong underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
        >
          {task.meetingTitle}
          {task.recordedAt && (
            <span className="ml-1.5 font-mono text-[0.7rem] text-fg-muted no-underline">
              {formatMeetingDate(task.recordedAt)}
            </span>
          )}
        </Link>
      </div>
    </li>
  );
}
