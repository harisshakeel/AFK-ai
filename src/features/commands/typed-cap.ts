/**
 * The database's refusal of a meeting's 21st typed command (cap_meeting_commands()).
 * PostgREST sends the SQLSTATE as the code ("23514"), never the condition name
 * ("check_violation"); the message says which of the meeting's caps it was.
 */
export function isTypedCommandCap(error: { code?: string; message: string }): boolean {
  return error.code === "23514" && /\bat most 20 typed commands\b/.test(error.message);
}

export const TYPED_CAP_MESSAGE = "That's the limit of 20 typed commands for this meeting.";
