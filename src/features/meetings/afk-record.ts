/**
 * The dashboard's game layer and its charts: XP, a level, a weekly streak, badges, and
 * the series the tiles draw, every one counted from the user's own rows and nothing
 * else. Pure functions; the query that feeds them is in dashboard-queries.ts. The voice
 * is the landing's: light, never a lie.
 */
export type Call = { id: string; title: string; sec: number; week: string };

export type RecordInput = {
  /** Every meeting the user owns, ready or not. */
  meetings: number;
  /** The ready ones, with their length and ISO week. */
  calls: Call[];
  decisions: number;
  actions: number;
  doneActions: number;
  spokenCommands: number;
  typedCommands: number;
  doneCommands: number;
  awaitingApproval: number;
  highlights: number;
  now: Date;
};

export type Level = {
  index: number;
  name: string;
  /** XP where this level starts. */
  from: number;
  /** XP where the next level starts, or null at the top. */
  nextAt: number | null;
  /** 0 to 1 through this level. */
  progress: number;
};

export type Badge = {
  id: string;
  name: string;
  how: string;
  unlocked: boolean;
  have: number;
  need: number;
};

export type WeekPoint = { week: string; calls: number; sec: number; current: boolean };

export type AfkRecord = {
  xp: number;
  level: Level;
  streakWeeks: number;
  recordedSec: number;
  longestSec: number;
  badges: Badge[];
  unlocked: number;
  /** The last twelve weeks, oldest first. */
  weekly: WeekPoint[];
  /** The last eight weeks as on/off, oldest first. */
  recentWeeks: boolean[];
  /** The three longest calls. */
  longest: Call[];
};

export const LEVELS: ReadonlyArray<{ name: string; from: number }> = [
  { name: "Lurker", from: 0 },
  { name: "Attendee", from: 100 },
  { name: "Delegator", from: 300 },
  { name: "Decision-maker", from: 700 },
  { name: "Chief AFK Officer", from: 1500 },
  { name: "AFK Legend", from: 3000 },
];

export const XP = {
  meeting: 50,
  recordedMinute: 1,
  decision: 10,
  action: 5,
  command: 15,
  doneCommand: 25,
  highlight: 5,
} as const;

export const recordedSec = (calls: ReadonlyArray<Call>) =>
  calls.reduce((sum, call) => sum + call.sec, 0);

export function xpFor(input: RecordInput): number {
  return (
    input.meetings * XP.meeting +
    Math.floor(recordedSec(input.calls) / 60) * XP.recordedMinute +
    input.decisions * XP.decision +
    input.actions * XP.action +
    (input.spokenCommands + input.typedCommands) * XP.command +
    input.doneCommands * XP.doneCommand +
    input.highlights * XP.highlight
  );
}

export function levelFor(xp: number): Level {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (xp >= LEVELS[i]!.from) index = i;
  const from = LEVELS[index]!.from;
  const nextAt = LEVELS[index + 1]?.from ?? null;
  return {
    index,
    name: LEVELS[index]!.name,
    from,
    nextAt,
    progress: nextAt === null ? 1 : Math.min(1, (xp - from) / (nextAt - from)),
  };
}

/** The ISO week of a date, as "2026-W41". */
export function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weekBefore(week: string): string {
  const [year, number] = week.split("-W").map(Number) as [number, number];
  // The Thursday of that week, minus seven days, is in the week before.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const thursday = new Date(jan4.getTime() + ((number - 1) * 7 + (4 - jan4Weekday)) * 86_400_000);
  return isoWeek(new Date(thursday.getTime() - 7 * 86_400_000));
}

/** The last `count` ISO weeks ending with the current one, oldest first. */
export function weeksBack(now: Date, count: number): string[] {
  const weeks: string[] = [];
  let cursor = isoWeek(now);
  for (let i = 0; i < count; i += 1) {
    weeks.unshift(cursor);
    cursor = weekBefore(cursor);
  }
  return weeks;
}

/**
 * Consecutive weeks with a call, counted back from this week, or from last week when
 * this week has none yet (a Monday should not break a streak).
 */
export function streakFor(calls: ReadonlyArray<Call>, now: Date): number {
  const weeks = new Set(calls.map((call) => call.week));
  let cursor = isoWeek(now);
  if (!weeks.has(cursor)) cursor = weekBefore(cursor);
  let streak = 0;
  while (weeks.has(cursor) && streak < 520) {
    streak += 1;
    cursor = weekBefore(cursor);
  }
  return streak;
}

export function weeklyFor(calls: ReadonlyArray<Call>, now: Date, count = 12): WeekPoint[] {
  const current = isoWeek(now);
  return weeksBack(now, count).map((week) => {
    const inWeek = calls.filter((call) => call.week === week);
    return { week, calls: inWeek.length, sec: recordedSec(inWeek), current: week === current };
  });
}

export function badgesFor(input: RecordInput, streakWeeks: number, longestSec: number): Badge[] {
  const list: Array<Omit<Badge, "unlocked">> = [
    {
      id: "first-seat",
      name: "First seat",
      how: "AFK sat in a call for you.",
      have: input.meetings,
      need: 1,
    },
    {
      id: "marathon",
      name: "Marathon",
      how: "A call of an hour or more.",
      have: longestSec,
      need: 3600,
    },
    {
      id: "magic-word",
      name: "Said the magic word",
      how: "“AFK, …” spoken in a call.",
      have: input.spokenCommands,
      need: 1,
    },
    {
      id: "delegator",
      name: "Delegator",
      how: "Ten side quests on the record.",
      have: input.actions,
      need: 10,
    },
    {
      id: "receipts",
      name: "Receipts",
      how: "Ten decisions, each with its moment.",
      have: input.decisions,
      need: 10,
    },
    {
      id: "hands-off",
      name: "Hands off",
      how: "Five things AFK did after your nod.",
      have: input.doneCommands,
      need: 5,
    },
    {
      id: "habit",
      name: "Habit",
      how: "Three weeks in a row with a call.",
      have: streakWeeks,
      need: 3,
    },
    {
      id: "highlighter",
      name: "Highlighter",
      how: "Ten moments saved as replays.",
      have: input.highlights,
      need: 10,
    },
  ];
  return list.map((badge) => ({ ...badge, unlocked: badge.have >= badge.need }));
}

export function afkRecord(input: RecordInput): AfkRecord {
  const xp = xpFor(input);
  const streakWeeks = streakFor(input.calls, input.now);
  const longestSec = input.calls.reduce((max, call) => Math.max(max, call.sec), 0);
  const badges = badgesFor(input, streakWeeks, longestSec);
  const weekSet = new Set(input.calls.map((call) => call.week));
  return {
    xp,
    level: levelFor(xp),
    streakWeeks,
    recordedSec: recordedSec(input.calls),
    longestSec,
    badges,
    unlocked: badges.filter((badge) => badge.unlocked).length,
    weekly: weeklyFor(input.calls, input.now),
    recentWeeks: weeksBack(input.now, 8).map((week) => weekSet.has(week)),
    longest: [...input.calls].sort((a, b) => b.sec - a.sec).slice(0, 3),
  };
}
