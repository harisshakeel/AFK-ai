/**
 * The notes as an email to the people on the call: the headline, the
 * decisions, the action items with their owners and dates, the summary's points. Built
 * from what is stored, never from the model, and sent only after the host approves the
 * card like any other email.
 */
export type NotesForEmail = {
  title: string;
  headline: string | null;
  decisions: string[];
  actions: Array<{ text: string; owner: string | null; due: string | null }>;
  points: Array<{ section: string; text: string }>;
  signOff: string | null;
  /** The meeting's address and PIN, when the link is on (owner's decision: both in the email). */
  link: { url: string; pin: string } | null;
};

/**
 * The email skill's sign-off with its placeholders filled: "{my name}" is the host's
 * name, or "[your name]" to fill in when AFK has none; "{first name}" has no one
 * recipient here, so it becomes "all".
 */
export function fillSignOff(signOff: string | null, myName: string | null): string | null {
  if (!signOff) return null;
  return signOff
    .replace(/\{my name\}/gi, myName?.trim() || "[your name]")
    .replace(/\{first name\}/gi, "all");
}

export function notesEmail(notes: NotesForEmail): { subject: string; body: string } {
  const lines: string[] = ["Hi all,", "", `Here are the notes from ${notes.title}.`];
  if (notes.headline) lines.push("", notes.headline);
  if (notes.decisions.length > 0) {
    lines.push("", "What we decided");
    for (const decision of notes.decisions) lines.push(`- ${decision}`);
  }
  if (notes.actions.length > 0) {
    lines.push("", "Action items");
    for (const action of notes.actions) {
      const who = action.owner
        ? ` (${action.owner}${action.due ? `, ${action.due}` : ""})`
        : action.due
          ? ` (${action.due})`
          : "";
      lines.push(`- ${action.text}${who}`);
    }
  }
  if (notes.points.length > 0) {
    let section: string | null = null;
    lines.push("", "Summary");
    for (const point of notes.points) {
      if (point.section !== section) {
        section = point.section;
        lines.push("", section);
      }
      lines.push(`- ${point.text}`);
    }
  }
  if (notes.link) {
    lines.push(
      "",
      `The recording, the transcript and the summary: ${notes.link.url}`,
      `PIN: ${notes.link.pin}`,
    );
  }
  lines.push("", notes.signOff ?? "Best,\n[your name]");
  return { subject: `Notes from ${notes.title}`, body: lines.join("\n") };
}
