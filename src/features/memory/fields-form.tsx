"use client";

import { useEffect, useId, useRef } from "react";

import { inputClass } from "@/components/ui/input";

import { parseFields, setField } from "./fields";
import type { MemoryPath } from "./files";

/**
 * The fields view of a memory file: every "- Key: value" line as a labelled input, a
 * yes/no line as a choice, grouped under the file's headings. Each change rewrites that
 * one line of the Markdown, so the file is what the form shows; the Markdown view has
 * the rest (the guidance, the lines without a colon, what AFK learned).
 */
export function FieldsForm({
  path,
  content,
  readOnly,
  onChange,
  focusKey = null,
}: {
  path: MemoryPath;
  content: string;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** A field to focus once on open, by its key ("Name in calls"), when a link named one. */
  focusKey?: string | null;
}) {
  const uid = useId();
  const groups = parseFields(content, path);
  const focused = useRef(false);

  useEffect(() => {
    if (!focusKey || focused.current) return;
    const wanted = groups
      .flatMap((group) => group.fields)
      .find((field) => field.key.toLowerCase() === focusKey.toLowerCase());
    if (!wanted) return;
    focused.current = true;
    const element = document.getElementById(`${uid}f${wanted.line}`);
    element?.scrollIntoView({ block: "center" });
    element?.focus();
  }, [focusKey, groups, uid]);

  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-fg-muted">
        No &ldquo;Key: value&rdquo; lines in this file. The Markdown view has it all.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, index) => (
        <fieldset key={index}>
          {group.heading && (
            <legend className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
              {group.heading}
            </legend>
          )}
          <div className="flex flex-col gap-3">
            {group.fields.map((field) => {
              const id = `${uid}f${field.line}`;
              const update = (value: string) =>
                onChange(setField(content, field.line, value, field.placeholder));
              return (
                <div key={field.line}>
                  <label htmlFor={id} className="text-xs font-medium text-fg-muted">
                    {field.key}
                  </label>
                  {field.kind === "yesno" ? (
                    <select
                      id={id}
                      value={field.value.trim().toLowerCase() === "yes" ? "yes" : "no"}
                      onChange={(event) => update(event.target.value)}
                      disabled={readOnly}
                      className={inputClass("mt-1 h-9 w-auto")}
                    >
                      <option value="yes">yes</option>
                      <option value="no">no</option>
                    </select>
                  ) : (
                    <input
                      id={id}
                      type="text"
                      value={field.value}
                      placeholder={field.placeholder ?? field.hint ?? undefined}
                      onChange={(event) => update(event.target.value)}
                      readOnly={readOnly}
                      aria-readonly={readOnly}
                      autoComplete="off"
                      spellCheck={false}
                      className={inputClass("mt-1 h-9")}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
