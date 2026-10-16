import {
  contextTemplate,
  type MemoryPath,
  profileTemplate,
  SKILL_PATHS,
  splitZones,
  LEARNED_MARKER,
} from "./files.ts";

/**
 * The fields view of a memory file (owner's call: "there should be a better
 * way of editing these files"): every "- Key: value" line of the profile and the three
 * skills becomes a labelled field, grouped under the "##" heading it sits beneath. A
 * change rewrites that one line; the title, the guidance, lines without a colon and
 * what AFK learned stay exactly as they are and remain reachable in the Markdown view.
 * No I/O here.
 */
export type Field = {
  /** The line's index within the user's zone. */
  line: number;
  key: string;
  value: string;
  /** The template's "(…)" value for this line: written back when the field is emptied. */
  placeholder: string | null;
  /** A hint for the empty field that is never written to the file. */
  hint: string | null;
  kind: "text" | "yesno";
};
export type FieldGroup = { heading: string | null; fields: Field[] };

/** The files whose lines are settings: the profile and the skills, not the free lists. */
export function hasFields(path: MemoryPath): boolean {
  return path === "profile.md" || (SKILL_PATHS as ReadonlyArray<string>).includes(path);
}

const FIELD = /^(\s*[-*]\s*)([^:]{1,40}):\s?(.*)$/;
const BRACKETED = /^\((.*)\)$/;
const YES_NO = /^(yes|no)$/i;

/** Hints for the profile's lines that carry no placeholder of their own (the profile's names are read as written, so a placeholder there would be taken for a name). */
const HINTS: Record<string, string> = {
  "name in calls": "The name Meet shows for you, when it differs from your name",
  "role and company": "Product lead at Example Co",
  timezone: "Asia/Karachi",
  "email sign-off": "Best, Sam",
  notes: "Decisions first, then the rest, short",
};

const templatePlaceholders = new Map<MemoryPath, Record<string, string>>();

/** The "(…)" values of the file's template, by lower-cased key, so an emptied field gets its hint back. */
function placeholdersFor(path: MemoryPath): Record<string, string> {
  const known = templatePlaceholders.get(path);
  if (known) return known;
  const template =
    path === "profile.md" ? profileTemplate({ name: null, email: null }) : contextTemplate(path);
  const found: Record<string, string> = {};
  for (const line of template.split("\n")) {
    const match = FIELD.exec(line);
    const bracketed = match ? BRACKETED.exec(match[3]!.trim())?.[1]?.trim() : undefined;
    if (match && bracketed) found[match[2]!.trim().toLowerCase()] = bracketed;
  }
  templatePlaceholders.set(path, found);
  return found;
}

export function parseFields(content: string, path: MemoryPath): FieldGroup[] {
  const placeholders = placeholdersFor(path);
  const groups: FieldGroup[] = [];
  let group: FieldGroup = { heading: null, fields: [] };
  splitZones(content)
    .user.split("\n")
    .forEach((line, index) => {
      const heading = /^##\s+(.*?)\s*$/.exec(line);
      if (heading) {
        if (group.fields.length > 0) groups.push(group);
        group = { heading: heading[1] || null, fields: [] };
        return;
      }
      const match = FIELD.exec(line);
      if (!match) return;
      const key = match[2]!.trim();
      const raw = match[3]!.replace(/^\s+/, "");
      const bracketed = BRACKETED.exec(raw.trim())?.[1]?.trim() ?? null;
      const value = bracketed === null ? raw : "";
      const placeholder = bracketed ?? placeholders[key.toLowerCase()] ?? null;
      const settled = value.trim();
      const kind =
        YES_NO.test(settled) || (settled === "" && placeholder !== null && YES_NO.test(placeholder))
          ? "yesno"
          : "text";
      group.fields.push({
        line: index,
        key,
        value,
        placeholder,
        hint: HINTS[key.toLowerCase()] ?? null,
        kind,
      });
    });
  if (group.fields.length > 0) groups.push(group);
  return groups;
}

/**
 * The file with one field's value changed: the line keeps its bullet and key, an emptied
 * field gets its placeholder back, and nothing else moves, the learned zone included.
 */
export function setField(
  content: string,
  line: number,
  value: string,
  placeholder: string | null,
): string {
  const at = content.indexOf(LEARNED_MARKER);
  const user = at < 0 ? content : content.slice(0, at);
  const rest = at < 0 ? "" : content.slice(at);
  const lines = user.split("\n");
  const match = FIELD.exec(lines[line] ?? "");
  if (!match) return content;
  const clean = value.replace(/[\r\n]+/g, " ");
  const head = `${match[1]}${match[2]!.trim()}:`;
  lines[line] =
    clean.trim() === "" ? (placeholder ? `${head} (${placeholder})` : head) : `${head} ${clean}`;
  return lines.join("\n") + rest;
}
