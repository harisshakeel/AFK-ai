import type { FollowupApproved, RemindApproved } from "../approve-args.ts";
import { CalendarError, calendarEventId, endOf, insertCalendarEvent } from "../calendar.ts";
import type { ActionResult } from "../history.ts";
import { AdapterError } from "./adapter.ts";

/**
 * Creates the approved event on the host's primary calendar (requirement X5). The event
 * id comes from the command, so a retry finds the event already there instead of making
 * a second one; that is why the job may try three times.
 */
export async function runCalendarCreate(
  input:
    | {
        kind: "followup";
        args: FollowupApproved;
        commandId: string;
        accessToken: string;
        fetchImpl?: typeof fetch;
      }
    | {
        kind: "remind";
        args: RemindApproved;
        commandId: string;
        accessToken: string;
        fetchImpl?: typeof fetch;
      },
): Promise<ActionResult> {
  const id = calendarEventId(input.commandId);
  const event =
    input.kind === "followup"
      ? {
          id,
          title: input.args.title,
          description: input.args.description,
          startsAt: input.args.startsAt,
          endsAt: endOf(input.args.startsAt, input.args.durationMin),
          attendees: input.args.attendees,
          popupAtStart: false,
        }
      : {
          id,
          title: `Reminder: ${input.args.text}`,
          description: "Set by AFK at your request.",
          startsAt: input.args.startsAt,
          endsAt: endOf(input.args.startsAt, 15),
          attendees: [],
          popupAtStart: true,
        };
  try {
    const created = await insertCalendarEvent(
      { accessToken: input.accessToken, event },
      input.fetchImpl ?? fetch,
    );
    if (input.kind === "followup") {
      return {
        kind: "followup",
        title: input.args.title,
        startsAt: created.startsAt || input.args.startsAt,
        attendees: input.args.attendees,
        eventId: created.eventId,
        link: created.link,
      };
    }
    return {
      kind: "remind",
      text: input.args.text,
      startsAt: created.startsAt || input.args.startsAt,
      eventId: created.eventId,
      link: created.link,
    };
  } catch (error) {
    if (error instanceof CalendarError) {
      // Safe to try again whenever the service, not the token or the input, was the problem.
      const retryable =
        error.code === "http" &&
        (error.status === undefined || error.status >= 500 || error.status === 429);
      throw new AdapterError(error.message, { retryable });
    }
    throw error;
  }
}
