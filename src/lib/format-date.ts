/**
 * Dates as the pages print them, the same on the server and in the browser (a formatter
 * that followed the runtime's locale or zone would render differently on each and break
 * hydration). One zone for every meeting date: the seed meetings were recorded in
 * Berkeley, and the day a list groups a meeting under must be the day its date shows.
 */
export const MEETING_TIME_ZONE = "America/Los_Angeles";

const meetingDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: MEETING_TIME_ZONE,
});

const dateTimeUtc = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** A meeting's date as the list, search, tasks and share pages print it: "Oct 16, 2026". */
export function formatMeetingDate(iso: string): string {
  return meetingDate.format(new Date(iso));
}

/** A moment with its time, in UTC and saying so: "Oct 16, 2026, 3:00 PM UTC". */
export function formatDateTimeUtc(iso: string): string {
  return `${dateTimeUtc.format(new Date(iso))} UTC`;
}
