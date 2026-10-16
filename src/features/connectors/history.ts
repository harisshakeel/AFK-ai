/**
 * The line history/actions.md gets for every executed command (requirement M4): when,
 * what, to whom, from which meeting. The host's own record; never logged.
 */
export type ActionResult =
  | { kind: "email"; to: string[]; subject: string; messageId: string }
  | {
      kind: "followup";
      title: string;
      startsAt: string;
      attendees: string[];
      eventId: string;
      link: string | null;
    }
  | { kind: "remind"; text: string; startsAt: string; eventId: string; link: string | null }
  | { kind: "slack"; channelName: string; message: string; ts: string; teamName: string };

const clock = (iso: string) => iso.replace("T", " ").slice(0, 16);
const short = (text: string, max = 80) =>
  text.replace(/\s+/g, " ").length > max
    ? `${text.replace(/\s+/g, " ").slice(0, max - 1)}…`
    : text.replace(/\s+/g, " ");

export function actionLine(
  nowIso: string,
  result: ActionResult,
  meetingTitle: string | null,
): string {
  const when = `- [${clock(nowIso)}]`;
  const from = meetingTitle ? ` (${meetingTitle})` : "";
  switch (result.kind) {
    case "email":
      return `${when} Sent "${short(result.subject, 60)}" to ${result.to.join(", ")}${from}`;
    case "followup":
      return `${when} Put "${short(result.title, 60)}" on the calendar for ${clock(result.startsAt)} with ${result.attendees.length} invitation${result.attendees.length === 1 ? "" : "s"}${from}`;
    case "remind":
      return `${when} Set a reminder "${short(result.text, 60)}" for ${clock(result.startsAt)}${from}`;
    case "slack":
      return `${when} Posted to #${result.channelName} in ${result.teamName}: "${short(result.message)}"${from}`;
  }
}
