import { MEETING_TIME_ZONE } from "../../lib/format-date.ts";

/**
 * Groups a newest-first list into the periods people think in: today, yesterday, this
 * week, this month, earlier. A meeting without a recorded date (not yet recorded) goes
 * by when it was created, which the caller passes as its date. Days are counted in the
 * zone the dates are printed in, so a label and the date under it never disagree.
 */
export type TimeGroup<T> = { label: string; items: T[] };

const DAY_MS = 24 * 60 * 60 * 1000;

const calendarParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MEETING_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: MEETING_TIME_ZONE });
const monthAndYear = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: MEETING_TIME_ZONE,
});

type Calendar = { day: number; month: number; year: number };

/** The calendar day in the meeting zone, as a count of days, plus its month and year. */
function calendar(date: Date): Calendar {
  const parts = Object.fromEntries(
    calendarParts.formatToParts(date).map((part) => [part.type, Number(part.value)]),
  );
  const year = parts.year ?? 0;
  const month = parts.month ?? 0;
  return { day: Date.UTC(year, month - 1, parts.day ?? 0) / DAY_MS, month, year };
}

export function periodLabel(date: Date, now: Date): string {
  return label(calendar(date), calendar(now), date);
}

function label(then: Calendar, today: Calendar, date: Date): string {
  if (then.day >= today.day + 1) return "Upcoming";
  if (then.day === today.day) return "Today";
  if (then.day === today.day - 1) return "Yesterday";
  if (then.day > today.day - 7) return "This week";
  if (then.year === today.year && then.month === today.month) return "This month";
  return (then.year === today.year ? monthName : monthAndYear).format(date);
}

export function groupByTime<T>(
  items: ReadonlyArray<T>,
  dateOf: (item: T) => string | null,
  now = new Date(),
): TimeGroup<T>[] {
  const today = calendar(now);
  const groups: TimeGroup<T>[] = [];
  for (const item of items) {
    const iso = dateOf(item);
    const date = iso ? new Date(iso) : null;
    const name = date ? label(calendar(date), today, date) : "Undated";
    const last = groups[groups.length - 1];
    if (last && last.label === name) last.items.push(item);
    else groups.push({ label: name, items: [item] });
  }
  return groups;
}
