/** The notes pane's tabs, shared by the page (reading ?tab=) and the client view. */
export type NotesTab = "summary" | "actions" | "decisions" | "chapters" | "highlights" | "tasks";

export const NOTES_TABS: ReadonlyArray<NotesTab> = [
  "summary",
  "actions",
  "decisions",
  "chapters",
  "highlights",
  "tasks",
];

export function parseNotesTab(value: string | undefined): NotesTab {
  return NOTES_TABS.find((tab) => tab === value) ?? "summary";
}
