"use client";

import { Download, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTimeUtc } from "@/lib/format-date";
import { ApiError, visitorFetch } from "@/lib/visitor-api";

import {
  contextTemplate,
  isAfkOnly,
  MEMORY_BLURBS,
  MEMORY_FILE_LIMIT_BYTES,
  MEMORY_PATHS,
  MEMORY_TITLES,
  type MemoryPath,
} from "./files";
import { hasFields } from "./fields";
import { FieldsForm } from "./fields-form";
import { MarkdownPreview } from "./markdown";
import type { MemoryFileRow } from "./memory-queries";

/**
 * The Memory page (requirement M6): the nine files as tabs, an editor beside a preview,
 * save with a conflict check, download all, forget everything. The profile and the
 * skills open as fields (every "- Key: value" line an input) with the Markdown a click
 * away; the other files are Markdown only. History files are AFK's and read-only. In
 * demo mode (signed out) nothing can be saved.
 */
type FileState = { content: string; updatedAt: string | null; updatedBy: "you" | "afk" };

/** The six files, plus tools.md rendered from the connectors (requirement M8), read-only. */
type TabKey = MemoryPath | "tools.md";

export function MemoryPage({
  files,
  toolsMd,
  demo = false,
  initialTab = "profile.md",
  focusField = null,
}: {
  files: ReadonlyArray<MemoryFileRow>;
  toolsMd: string;
  demo?: boolean;
  /** The tab to open, from the page's ?tab= (the checklist opens the profile). */
  initialTab?: MemoryPath;
  /** A field to focus in that tab, from ?field= ("Name in calls"). */
  focusField?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [state, setState] = useState<Record<MemoryPath, FileState>>(() => {
    const initial = {} as Record<MemoryPath, FileState>;
    for (const path of MEMORY_PATHS) {
      const row = files.find((file) => file.path === path);
      initial[path] = row
        ? { content: row.content, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
        : { content: contextTemplate(path), updatedAt: null, updatedBy: "you" };
    }
    return initial;
  });
  const [saved, setSaved] = useState<Record<MemoryPath, string>>(() => {
    const initial = {} as Record<MemoryPath, string>;
    for (const path of MEMORY_PATHS) {
      initial[path] = files.find((file) => file.path === path)?.content ?? contextTemplate(path);
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  // The profile and the skills open as fields; the Markdown is a click away.
  const [view, setView] = useState<"fields" | "markdown">("fields");

  const file: MemoryPath | null = tab === "tools.md" ? null : tab;
  const current: FileState = file
    ? state[file]
    : { content: toolsMd, updatedAt: null, updatedBy: "afk" };
  const dirty = file ? current.content !== saved[file] : false;
  const readOnly = demo || file === null || isAfkOnly(file);
  const fieldsAvailable = file !== null && hasFields(file);
  const showFields = fieldsAvailable && view === "fields";
  const bytes = new TextEncoder().encode(current.content).length;
  const tooLarge = bytes > MEMORY_FILE_LIMIT_BYTES;

  const save = async () => {
    if (!file || readOnly || !dirty || tooLarge) return;
    setBusy(true);
    try {
      const { updatedAt } = await visitorFetch<{ updatedAt: string }>(`/api/memory/${file}`, {
        method: "PUT",
        body: { content: current.content, updatedAt: current.updatedAt },
      });
      setState((all) => ({ ...all, [file]: { ...all[file], updatedAt, updatedBy: "you" } }));
      setSaved((all) => ({ ...all, [file]: current.content }));
      toast("Saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast(error.message, "error");
      } else {
        toast(error instanceof Error ? error.message : "Couldn't save.", "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (demo) return;
    if (
      !window.confirm(
        "Forget everything? Every memory file is deleted, and AFK asks its welcome questions again.",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await visitorFetch<{ next?: string }>("/api/memory", { method: "DELETE" });
      toast("Memory erased");
      // With no profile left, the welcome asks its questions again (requirement M10).
      router.push(result.next ?? "/welcome");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't erase memory.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          id="memory"
          label="Memory files"
          value={tab}
          onChange={setTab}
          className="min-w-0 flex-1 border-b-0"
          items={[
            ...MEMORY_PATHS.map((path) => ({ key: path as TabKey, label: MEMORY_TITLES[path] })),
            { key: "tools.md" as TabKey, label: "Tools" },
          ]}
        />
        <div className="flex items-center gap-2">
          {demo ? (
            <span className="text-xs text-fg-muted">Demo: sign in to keep your own</span>
          ) : (
            <>
              <a href="/api/memory" download className={buttonClass("secondary", "sm")}>
                <Download className="size-4" aria-hidden />
                Download all
              </a>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => void forget()}
                disabled={busy}
              >
                <Trash2 aria-hidden />
                Forget everything
              </Button>
            </>
          )}
        </div>
      </div>

      <section
        {...tabPanelProps("memory", tab)}
        className="rounded-xl border border-border bg-surface shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.72rem] text-fg-muted">{tab}</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {file
                ? MEMORY_BLURBS[file]
                : "What AFK may act through, rendered from your connectors. Change it on the Connectors page."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            {current.updatedBy === "afk" && <Badge tone="accent">written by AFK</Badge>}
            {current.updatedAt && (
              <span className="font-mono text-[0.7rem]">
                {formatDateTimeUtc(current.updatedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 border-b border-border px-3 py-2 lg:hidden" role="group">
          {(["edit", "preview"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                "h-8 flex-1 rounded-md text-sm font-medium capitalize",
                mode === key ? "bg-accent-soft text-accent-strong" : "text-fg-muted",
              )}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-2">
          <div
            className={cn("p-3 lg:block lg:border-r lg:border-border", mode !== "edit" && "hidden")}
          >
            {fieldsAvailable && (
              <div className="mb-3 flex gap-1" role="group" aria-label="How to edit">
                {(["fields", "markdown"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                      "h-8 rounded-md px-3 text-sm font-medium",
                      view === key
                        ? "bg-accent-soft text-accent-strong"
                        : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {key === "fields" ? "Fields" : "Markdown"}
                  </button>
                ))}
              </div>
            )}
            {showFields && file ? (
              <FieldsForm
                path={file}
                content={current.content}
                readOnly={readOnly}
                focusKey={focusField}
                onChange={(content) =>
                  setState((all) => ({ ...all, [file]: { ...all[file], content } }))
                }
              />
            ) : (
              <>
                <label htmlFor="memory-editor" className="sr-only">
                  {file ? MEMORY_TITLES[file] : "Tools"} as Markdown
                </label>
                <textarea
                  id="memory-editor"
                  value={current.content}
                  readOnly={readOnly}
                  aria-readonly={readOnly}
                  onChange={(event) => {
                    if (!file) return;
                    setState((all) => ({
                      ...all,
                      [file]: { ...all[file], content: event.target.value },
                    }));
                  }}
                  spellCheck={false}
                  className={cn(
                    "min-h-[28rem] w-full resize-y rounded-lg border border-border bg-canvas p-3 font-mono text-[0.8rem] leading-relaxed text-fg focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
                    readOnly && "cursor-default text-fg-muted",
                  )}
                />
              </>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span className={cn("font-mono", tooLarge && "text-danger")}>
                {(bytes / 1024).toFixed(1)} KB of {MEMORY_FILE_LIMIT_BYTES / 1024} KB
              </span>
              {readOnly ? (
                <span>
                  {demo
                    ? "Read-only in the demo."
                    : file
                      ? "AFK writes this file."
                      : "Rendered from your connectors."}
                </span>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void save()}
                  loading={busy}
                  disabled={!dirty || tooLarge}
                >
                  {!busy && <Save aria-hidden />}
                  {dirty ? "Save" : "Saved"}
                </Button>
              )}
            </div>
          </div>
          <div className={cn("p-5 lg:block", mode !== "preview" && "hidden")}>
            <MarkdownPreview content={current.content} />
          </div>
        </div>
      </section>
    </div>
  );
}
