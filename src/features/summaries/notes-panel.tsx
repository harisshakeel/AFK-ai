"use client";

import { WaveLoader } from "@/components/ui/wave-loader";
import { Check, ClipboardCopy, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { Button, chipClass } from "@/components/ui/button";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { usePlayheadDerived, type Playhead } from "@/lib/playhead";
import { speakerStyle, type Speaker } from "@/lib/speakers";
import { formatTime } from "@/lib/time-rules";
import { TimestampButton } from "@/components/ui/timestamp-button";
import { SpeakerMark } from "@/components/ui/speaker-mark";

import { PotentialTasks } from "@/features/commands/potential-tasks";

import { summaryFor } from "./summary-sections";

/**
 * The meeting's notes (requirements F3, F4, F5): summary templates, action items,
 * decisions and chapters, plus a slot for highlights. Everything AI-written carries a
 * timestamp that plays the moment it came from.
 */
import type { NotesTab } from "./notes-tab";

export type { NotesTab };

export type NoteItem = {
  id: string;
  kind: "point" | "action" | "decision" | "note";
  /** "command": the host said it explicitly during the call. */
  source: "ai" | "command";
  templateKey: string | null;
  sectionIdx: number | null;
  section: string | null;
  idx: number;
  text: string;
  ownerSpeaker: string | null;
  ownerName: string | null;
  dueText: string | null;
  turnIds: string[];
};

export type GenerationState = {
  kind: "analyze" | "summarize";
  status: "queued" | "running" | "done" | "failed" | "none";
  updatedAt: string | null;
  /** Queued for over 15 minutes: something is holding it up (decided on the server). */
  stale: boolean;
};

type Props = {
  meetingTitle: string;
  items: ReadonlyArray<NoteItem>;
  turnStart: ReadonlyMap<string, number>;
  speakers: ReadonlyArray<Speaker>;
  chapters: ReadonlyArray<{ id: string; title: string; startSec: number }>;
  generation: ReadonlyArray<GenerationState>;
  doneIds: ReadonlySet<string>;
  onToggleDone: (itemId: string, done: boolean) => void;
  template: string;
  onTemplateChange: (key: string) => void;
  tab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
  onSeek: (sec: number) => void;
  playhead: Playhead;
  highlightCount: number;
  highlights: ReactNode;
  /** The Tasks tab (commands AFK heard), rendered by the commands feature. */
  tasks: ReactNode;
  /** Undefined on a sample meeting: the demo cards are not the visitor's. */
  taskCount: number | undefined;
  /** For the potential tasks at the end of the summary, which post a typed /task. */
  meetingId: string;
};

export function NotesPanel(props: Props) {
  const { items, tab, onTabChange, highlightCount } = props;
  const actions = useMemo(() => items.filter((item) => item.kind === "action"), [items]);
  const decisions = useMemo(() => items.filter((item) => item.kind === "decision"), [items]);

  return (
    <section aria-label="Meeting notes" className="flex h-full min-h-0 flex-col">
      <Tabs
        id="notes"
        label="Meeting notes"
        value={tab}
        onChange={onTabChange}
        className="px-2"
        items={[
          { key: "summary", label: "Summary" },
          { key: "actions", label: "Action items", count: actions.length },
          { key: "decisions", label: "Decisions", count: decisions.length },
          { key: "chapters", label: "Chapters", count: props.chapters.length },
          { key: "highlights", label: "Highlights", count: highlightCount },
          { key: "tasks", label: "Tasks", count: props.taskCount },
        ]}
      />
      {props.taskCount !== undefined &&
        props.taskCount > 0 &&
        props.generation.some(
          (state) => state.status === "queued" || state.status === "running",
        ) && (
          <p
            role="status"
            className="border-b border-border bg-accent-soft/60 px-4 py-2 text-xs text-fg-muted"
          >
            AFK heard {props.taskCount} command{props.taskCount === 1 ? "" : "s"}; they are on the
            Tasks tab while the notes are written.
          </p>
        )}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
        {...tabPanelProps("notes", tab)}
      >
        {tab === "summary" && <SummaryTab {...props} />}
        {tab === "actions" && <ActionsTab {...props} actions={actions} />}
        {tab === "decisions" && <DecisionsTab {...props} decisions={decisions} />}
        {tab === "chapters" && <ChaptersTab {...props} />}
        {tab === "highlights" && props.highlights}
        {tab === "tasks" && props.tasks}
      </div>
    </section>
  );
}

function firstCitedSec(item: NoteItem, turnStart: ReadonlyMap<string, number>): number | null {
  for (const id of item.turnIds) {
    const sec = turnStart.get(id);
    if (sec !== undefined) return sec;
  }
  return null;
}

function Cite({
  item,
  turnStart,
  onSeek,
}: {
  item: NoteItem;
  turnStart: ReadonlyMap<string, number>;
  onSeek: (sec: number) => void;
}) {
  const sec = firstCitedSec(item, turnStart);
  if (sec === null) return null;
  return (
    <TimestampButton
      sec={sec}
      onSeek={onSeek}
      extra={item.turnIds.length > 1 ? `+${item.turnIds.length - 1}` : undefined}
      className="ml-1.5 align-[1px]"
    />
  );
}

function GenerationNotice({ state, what }: { state: GenerationState | undefined; what: string }) {
  const status = state?.status ?? "none";
  const offline = status === "queued" && state?.stale === true;
  const content =
    status === "running" ? (
      <>
        <WaveLoader className="h-4 text-accent" label={null} />
        Writing the {what} now. It usually takes under a minute.
      </>
    ) : status === "queued" ? (
      <>
        <Sparkles className="size-4 text-accent" aria-hidden />
        {offline
          ? `The ${what} is taking longer than usual. Keep this page open: it checks again by itself and the ${what} will appear here when it's done.`
          : `The ${what} is queued and will appear here shortly.`}
      </>
    ) : status === "failed" ? (
      <>
        <TriangleAlert className="size-4 text-warning" aria-hidden />
        The {what} couldn&apos;t be generated for this meeting. The recording and transcript still
        work.
      </>
    ) : (
      <>
        <Sparkles className="size-4 text-fg-subtle" aria-hidden />
        No {what} has been generated for this meeting yet.
      </>
    );
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-3 text-sm text-fg-muted"
    >
      {content}
    </p>
  );
}

/** Marks an item the host said explicitly ("AFK, decision: …"), not one the AI inferred. */
function SaidOnCall() {
  return (
    <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px align-[1px] text-[0.7rem] font-medium text-accent-strong">
      said on the call
    </span>
  );
}

function SummaryTab({
  items,
  turnStart,
  template,
  onTemplateChange,
  onSeek,
  generation,
  taskCount,
  meetingId,
}: Props) {
  const { available, current, sections, notes } = summaryFor(items, template);

  if (available.length === 0) {
    return (
      <GenerationNotice
        state={generation.find((state) => state.kind === "summarize")}
        what="summary"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Summary template" className="flex flex-wrap gap-1.5">
        {available.map((definition) => (
          <button
            key={definition.key}
            type="button"
            aria-pressed={definition.key === current?.key}
            onClick={() => onTemplateChange(definition.key)}
            title={definition.description}
            className={chipClass(definition.key === current?.key)}
          >
            {definition.name}
          </button>
        ))}
      </div>
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
                  <SaidOnCall />
                  <Cite item={note} turnStart={turnStart} onSeek={onSeek} />
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
                  <Cite item={point} turnStart={turnStart} onSeek={onSeek} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {taskCount !== undefined && (
        <PotentialTasks
          meetingId={meetingId}
          tasks={items
            .filter((item) => item.kind === "action" && item.source === "ai")
            .map((item) => ({
              id: item.id,
              text: item.text,
              ownerName: item.ownerName,
              dueText: item.dueText,
            }))}
        />
      )}
      <AiNote />
    </div>
  );
}

function OwnerLabel({ item, speakers }: { item: NoteItem; speakers: ReadonlyArray<Speaker> }) {
  if (item.ownerSpeaker) {
    const index = speakers.findIndex((speaker) => speaker.code === item.ownerSpeaker);
    const speaker = speakers[index];
    if (speaker) {
      return (
        <span className="inline-flex items-center gap-1.5 text-fg" style={speakerStyle(index)}>
          <SpeakerMark label={speaker.label} className="size-4 text-[0.55rem]" />
          {speaker.label}
        </span>
      );
    }
  }
  if (item.ownerName) return <span className="text-fg">{item.ownerName}</span>;
  return <span className="font-semibold tracking-tight text-fg-subtle">No owner mentioned</span>;
}

function ActionsTab({
  actions,
  turnStart,
  speakers,
  doneIds,
  onToggleDone,
  onSeek,
  generation,
  meetingTitle,
}: Props & { actions: NoteItem[] }) {
  const toast = useToast();
  if (actions.length === 0) {
    const state = generation.find((candidate) => candidate.kind === "analyze");
    return state?.status === "done" ? (
      <p className="text-sm text-fg-muted">No action items were agreed in this meeting.</p>
    ) : (
      <GenerationNotice state={state} what="action items" />
    );
  }

  const copyAll = async () => {
    const lines = actions.map((item) => {
      const owner = item.ownerSpeaker
        ? speakers.find((speaker) => speaker.code === item.ownerSpeaker)?.label
        : item.ownerName;
      const sec = firstCitedSec(item, turnStart);
      return [
        `- [${doneIds.has(item.id) ? "x" : " "}] ${item.text}`,
        owner ? `owner: ${owner}` : "no owner mentioned",
        item.dueText ? `due: ${item.dueText}` : null,
        sec !== null ? `at ${formatTime(sec)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    });
    try {
      await navigator.clipboard.writeText(`Action items: ${meetingTitle}\n${lines.join("\n")}`);
      toast(`Copied ${actions.length} action items`);
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", "error");
    }
  };

  const doneCount = actions.filter((item) => doneIds.has(item.id)).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {doneCount} of {actions.length} done{" "}
          <span className="text-fg-subtle">· your ticks are private to you</span>
        </p>
        <Button variant="secondary" size="sm" onClick={copyAll}>
          <ClipboardCopy className="size-4" aria-hidden />
          Copy all
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {actions.map((item) => {
          const done = doneIds.has(item.id);
          return (
            <li key={item.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={`Mark "${item.text}" ${done ? "not done" : "done"}`}
                onClick={() => onToggleDone(item.id, !done)}
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded border transition-colors",
                  done
                    ? "border-success bg-success text-white"
                    : "border-border-strong hover:border-accent",
                )}
              >
                {done && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[0.95rem] leading-snug",
                    done && "text-fg-muted line-through",
                  )}
                >
                  {item.text}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <OwnerLabel item={item} speakers={speakers} />
                  {item.dueText && <span>Due {item.dueText}</span>}
                  {item.source === "command" && <SaidOnCall />}
                  <Cite item={item} turnStart={turnStart} onSeek={onSeek} />
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <AiNote />
    </div>
  );
}

function DecisionsTab({
  decisions,
  turnStart,
  onSeek,
  generation,
}: Props & { decisions: NoteItem[] }) {
  if (decisions.length === 0) {
    const state = generation.find((candidate) => candidate.kind === "analyze");
    return state?.status === "done" ? (
      <p className="text-sm text-fg-muted">No decisions were settled in this meeting.</p>
    ) : (
      <GenerationNotice state={state} what="decisions" />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {decisions.map((item, index) => (
          <li key={item.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 text-[0.95rem] leading-snug">
              {item.text}
              {item.source === "command" && <SaidOnCall />}
              <Cite item={item} turnStart={turnStart} onSeek={onSeek} />
            </p>
          </li>
        ))}
      </ol>
      <AiNote />
    </div>
  );
}

function ChaptersTab({ chapters, onSeek, playhead, generation }: Props) {
  const currentId = usePlayheadDerived(playhead, (sec) => {
    let id: string | null = null;
    for (const chapter of chapters) if (chapter.startSec <= sec) id = chapter.id;
    return id;
  });
  if (chapters.length === 0) {
    return (
      <GenerationNotice
        state={generation.find((state) => state.kind === "analyze")}
        what="chapters"
      />
    );
  }
  return (
    <ol className="flex flex-col">
      {chapters.map((chapter) => {
        const current = chapter.id === currentId;
        return (
          <li key={chapter.id}>
            <button
              type="button"
              onClick={() => onSeek(chapter.startSec)}
              aria-current={current ? "true" : undefined}
              className={cn(
                "flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left transition-colors",
                current ? "bg-now" : "hover:bg-surface-raised",
              )}
            >
              <span className="w-14 shrink-0 text-xs text-accent-strong tabular-nums">
                {formatTime(chapter.startSec)}
              </span>
              <span className={cn("text-[0.95rem]", current && "font-semibold")}>
                {chapter.title}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AiNote() {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle">
      <Sparkles className="size-3.5" aria-hidden />
      Written by AFK with Claude from the transcript. Every point links to the moment it came from.
    </p>
  );
}
