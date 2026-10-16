import { z } from "zod";

import { parseMeetingUrl, type MeetingPlatform } from "../capture/meeting-url.ts";

/**
 * Google Calendar events (requirements-v2 X5, C7): events.insert on the primary calendar
 * with a client-generated id derived from the command, so a retry can never make a
 * second event (a 409 means "already there" and is read back as done).
 */
export const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class CalendarError extends Error {
  readonly code: "http" | "response" | "auth";
  readonly status: number | undefined;

  constructor(message: string, code: "http" | "response" | "auth", status?: number) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
    this.status = status;
  }
}

/** Google event ids are base32hex (0-9, a-v), 5 to 1024 characters: a uuid's hex fits. */
export function calendarEventId(commandId: string): string {
  const id = commandId.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-v]{5,1024}$/.test(id))
    throw new CalendarError("command id is not a valid event id", "response");
  return id;
}

export type CalendarEventInput = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  attendees: ReadonlyArray<string>;
  /** A reminder for the host: pops up at the time itself. */
  popupAtStart: boolean;
};

const eventResponse = z.object({
  id: z.string().min(1),
  htmlLink: z.string().url().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
});

export type CalendarEvent = {
  eventId: string;
  link: string | null;
  startsAt: string;
  endsAt: string;
};

function toEvent(body: unknown): CalendarEvent {
  const parsed = eventResponse.safeParse(body);
  if (!parsed.success) throw new CalendarError("Calendar's answer was not understood", "response");
  return {
    eventId: parsed.data.id,
    link: parsed.data.htmlLink ?? null,
    startsAt: parsed.data.start?.dateTime ?? parsed.data.start?.date ?? "",
    endsAt: parsed.data.end?.dateTime ?? parsed.data.end?.date ?? "",
  };
}

async function request(
  url: string,
  init: { method: "GET" | "POST"; accessToken: string; json?: unknown },
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${init.accessToken}`,
        ...(init.json !== undefined ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new CalendarError(
      `Calendar could not be reached: ${error instanceof Error ? error.message : "network"}`,
      "http",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new CalendarError(
      "Calendar refused the token; reconnect Google and allow calendar access.",
      "auth",
      response.status,
    );
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

export async function insertCalendarEvent(
  input: { accessToken: string; event: CalendarEventInput },
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarEvent & { alreadyExisted: boolean }> {
  const { event } = input;
  const payload = {
    id: event.id,
    summary: event.title,
    description: event.description ?? undefined,
    start: { dateTime: event.startsAt },
    end: { dateTime: event.endsAt },
    attendees: event.attendees.map((email) => ({ email })),
    reminders: event.popupAtStart
      ? { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }
      : { useDefault: true },
  };
  const url = `${CALENDAR_EVENTS_URL}?sendUpdates=${event.attendees.length > 0 ? "all" : "none"}`;
  const inserted = await request(
    url,
    { method: "POST", accessToken: input.accessToken, json: payload },
    fetchImpl,
  );
  if (inserted.status === 200) return { ...toEvent(inserted.body), alreadyExisted: false };
  if (inserted.status === 409) {
    // Already created by an earlier attempt: read it back.
    const existing = await request(
      `${CALENDAR_EVENTS_URL}/${encodeURIComponent(event.id)}`,
      { method: "GET", accessToken: input.accessToken },
      fetchImpl,
    );
    if (existing.status === 200) return { ...toEvent(existing.body), alreadyExisted: true };
    throw new CalendarError(
      `Calendar answered ${existing.status} reading the event`,
      "http",
      existing.status,
    );
  }
  throw new CalendarError(`Calendar answered ${inserted.status}`, "http", inserted.status);
}

/** The end of an event from its start and length, as ISO with the same offset. */
export function endOf(startsAt: string, durationMin: number): string {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) throw new CalendarError("start is not a date", "response");
  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(startsAt)?.[1] ?? "Z";
  const end = new Date(start.getTime() + durationMin * 60_000);
  if (offset === "Z") return end.toISOString();
  // Keep the host's offset so Google shows the time as they said it.
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h, m] = offset.slice(1).split(":").map(Number);
  const local = new Date(end.getTime() + sign * ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
  return `${local.toISOString().slice(0, 19)}${offset}`;
}

// ---------------------------------------------------------------------------------------
// Upcoming meetings: the events on the primary calendar with a video link,
// for AFK to join at their time. Read with the same calendar.events scope.

export type UpcomingEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  link: string;
  platform: MeetingPlatform;
  /** Everyone on the invite but the host and the rooms: an address, and a name when given. */
  attendees: Array<{ email: string; name: string | null }>;
};

const upcomingResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        status: z.string().optional(),
        summary: z.string().optional(),
        start: z
          .object({ dateTime: z.string().optional(), date: z.string().optional() })
          .optional(),
        end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
        hangoutLink: z.string().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        conferenceData: z
          .object({
            entryPoints: z
              .array(
                z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }),
              )
              .optional(),
          })
          .optional(),
        attendees: z
          .array(
            z.object({
              email: z.string().optional(),
              displayName: z.string().optional(),
              self: z.boolean().optional(),
              resource: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** The people on an invite: everyone but the host (self) and the rooms, each once. */
export function inviteesOf(
  attendees:
    | ReadonlyArray<{ email?: string; displayName?: string; self?: boolean; resource?: boolean }>
    | undefined,
): Array<{ email: string; name: string | null }> {
  const seen = new Set<string>();
  const people: Array<{ email: string; name: string | null }> = [];
  for (const attendee of attendees ?? []) {
    const email = attendee.email?.trim().toLowerCase() ?? "";
    if (!email.includes("@") || attendee.self || attendee.resource || seen.has(email)) continue;
    seen.add(email);
    people.push({ email, name: attendee.displayName?.trim() || null });
  }
  return people.slice(0, 50);
}

/** The invitees of the event a bot is sent to: the event named, else the one with the link. */
export function inviteesFor(
  events: ReadonlyArray<UpcomingEvent>,
  target: { calendarEventId: string | null; link: string },
): Array<{ email: string; name: string | null }> {
  const byId = target.calendarEventId
    ? events.find((event) => event.id === target.calendarEventId)
    : undefined;
  const event = byId ?? events.find((candidate) => candidate.link === target.link);
  return event?.attendees ?? [];
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/g;

/** The first Zoom, Meet or Teams link an event carries, in its fields in this order. */
export function meetingLinkOf(event: {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  location?: string;
  description?: string;
}): { url: string; platform: MeetingPlatform } | null {
  const candidates: string[] = [];
  if (event.hangoutLink) candidates.push(event.hangoutLink);
  for (const entry of event.conferenceData?.entryPoints ?? []) {
    if (entry.entryPointType === "video" && entry.uri) candidates.push(entry.uri);
  }
  for (const text of [event.location, event.description]) {
    candidates.push(...(text?.match(URL_IN_TEXT) ?? []));
  }
  for (const candidate of candidates) {
    const parsed = parseMeetingUrl(candidate);
    if (parsed.ok) return { url: parsed.url, platform: parsed.platform };
  }
  return null;
}

export async function listUpcomingEvents(
  accessToken: string,
  { from, to }: { from: Date; to: Date },
  fetchImpl: typeof fetch = fetch,
): Promise<UpcomingEvent[]> {
  const url = new URL(CALENDAR_EVENTS_URL);
  url.searchParams.set("timeMin", from.toISOString());
  url.searchParams.set("timeMax", to.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new CalendarError(
      error instanceof Error ? error.message : "Calendar unreachable",
      "http",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new CalendarError("Google refused the calendar read", "auth", response.status);
  }
  if (!response.ok)
    throw new CalendarError(`Calendar answered ${response.status}`, "http", response.status);
  const parsed = upcomingResponse.safeParse(await response.json());
  if (!parsed.success) throw new CalendarError("Calendar's answer was not understood", "response");
  const events: UpcomingEvent[] = [];
  for (const item of parsed.data.items ?? []) {
    if (item.status === "cancelled" || !item.start?.dateTime) continue;
    const link = meetingLinkOf(item);
    if (!link) continue;
    events.push({
      id: item.id,
      title: item.summary?.trim() || "Untitled meeting",
      startsAt: item.start.dateTime,
      endsAt: item.end?.dateTime ?? null,
      link: link.url,
      platform: link.platform,
      attendees: inviteesOf(item.attendees),
    });
  }
  return events;
}
