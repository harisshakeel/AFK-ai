"use client";

import { Check, ListPlus, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { hasDueTrigger } from "./parse";
import { useState } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { visitorFetch } from "@/lib/visitor-api";

/**
 * At the end of the summary: the action items AFK found, offered as tasks. One click
 * sends "/task <wording>" through the typed-command route, the same path as typing it
 * on the Tasks tab, so the task lands there with the meeting as its source. The pencil
 * opens the wording for a change first. Only on the owner's own meeting: a visitor on a
 * sample has no Tasks tab to land on.
 */
export type PotentialTask = {
  id: string;
  text: string;
  ownerName: string | null;
  dueText: string | null;
};

type Row = { id: string; wording: string; state: "idle" | "editing" | "sending" | "added" };

/** The deadline as the typed parser reads it: its own trigger word when it has one. */
const dueWording = (dueText: string) => {
  const due = dueText.trim().replace(/^for\s+/i, "");
  return hasDueTrigger(due) ? due : `by ${due}`;
};

const wordingFor = (task: PotentialTask) =>
  [
    task.ownerName ? `for ${task.ownerName}:` : null,
    task.text,
    task.dueText ? dueWording(task.dueText) : null,
  ]
    .filter(Boolean)
    .join(" ");

export function PotentialTasks({
  tasks,
  meetingId,
}: {
  tasks: PotentialTask[];
  meetingId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((task) => ({ id: task.id, wording: wordingFor(task), state: "idle" })),
  );
  if (rows.length === 0) return null;
  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  async function add(row: Row) {
    const wording = row.wording.trim();
    if (wording.length < 2) return;
    update(row.id, { state: "sending" });
    try {
      await visitorFetch(`/api/meetings/${meetingId}/commands`, {
        method: "POST",
        body: { text: `/task ${wording}` },
      });
      update(row.id, { state: "added", wording });
      toast("Added to Tasks");
      router.refresh();
    } catch (error) {
      update(row.id, { state: "idle" });
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Potential tasks
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm shadow-xs",
              row.state === "added" && "border-success/40 bg-success/8",
            )}
          >
            {row.state === "editing" ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  update(row.id, { state: "idle" });
                }}
              >
                <label htmlFor={`potential-${row.id}`} className="sr-only">
                  Task wording
                </label>
                <input
                  id={`potential-${row.id}`}
                  autoFocus
                  value={row.wording}
                  onChange={(event) => update(row.id, { wording: event.target.value })}
                  className={inputClass("h-9 min-w-0 flex-1")}
                />
                <button
                  type="submit"
                  aria-label="Keep the wording"
                  title="Keep the wording"
                  className={buttonClass("ghost", "icon-sm")}
                >
                  <Check aria-hidden />
                </button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 leading-relaxed">{row.wording}</span>
                {row.state === "added" ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success-strong">
                    <Check className="size-3.5" aria-hidden />
                    On the Tasks tab
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Edit the wording"
                      title="Edit the wording"
                      disabled={row.state === "sending"}
                      onClick={() => update(row.id, { state: "editing" })}
                      className={buttonClass("ghost", "icon-sm")}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={row.state === "sending"}
                      onClick={() => void add(row)}
                    >
                      {row.state !== "sending" && <ListPlus aria-hidden />}
                      Make it a task
                    </Button>
                  </span>
                )}
              </>
            )}
            {row.state === "editing" && (
              <button
                type="button"
                aria-label="Cancel editing"
                title="Cancel editing"
                onClick={() => update(row.id, { state: "idle" })}
                className={buttonClass("ghost", "icon-sm")}
              >
                <X aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
