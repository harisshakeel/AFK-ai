import { describe, expect, it } from "vitest";

import { listUpcomingEvents, meetingLinkOf, inviteesFor, inviteesOf } from "./calendar";

describe("upcoming calendar meetings", () => {
  it("finds the video link in the event's fields, in order, and ignores anything else", () => {
    expect(meetingLinkOf({ hangoutLink: "https://meet.google.com/abc-defg-hij" })).toEqual({
      url: "https://meet.google.com/abc-defg-hij",
      platform: "meet",
    });
    expect(
      meetingLinkOf({
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123456789" }],
        },
      })?.platform,
    ).toBe("zoom");
    expect(
      meetingLinkOf({
        description: "Agenda... join https://teams.microsoft.com/l/meetup-join/x here",
      })?.platform,
    ).toBe("teams");
    expect(meetingLinkOf({ location: "Room 4B, https://example.com/notes" })).toBeNull();
  });

  it("lists the timed events with a link in the window, skipping cancelled and all-day ones", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({
        items: [
          {
            id: "e1",
            summary: "Launch sync",
            start: { dateTime: "2026-10-21T10:00:00+05:00" },
            end: { dateTime: "2026-10-21T10:30:00+05:00" },
            hangoutLink: "https://meet.google.com/abc-defg-hij",
            attendees: [
              { email: "me@example.com", self: true },
              { email: "Sam@Example.com", displayName: "Sam Lee" },
              { email: "room@resource.calendar.google.com", resource: true },
              { email: "sam@example.com", displayName: "Sam again" },
            ],
          },
          {
            id: "e2",
            summary: "Focus day",
            start: { date: "2026-10-21" },
            hangoutLink: "https://meet.google.com/x",
          },
          {
            id: "e3",
            status: "cancelled",
            start: { dateTime: "2026-10-22T10:00:00+05:00" },
            hangoutLink: "https://meet.google.com/zzz-zzzz-zzz",
          },
          {
            id: "e4",
            summary: "",
            start: { dateTime: "2026-10-22T11:00:00+05:00" },
            location: "Office",
          },
        ],
      });
    }) as typeof fetch;
    const events = await listUpcomingEvents(
      "tok",
      { from: new Date("2026-10-20T00:00:00Z"), to: new Date("2026-10-27T00:00:00Z") },
      fetchImpl,
    );
    expect(events).toEqual([
      {
        id: "e1",
        title: "Launch sync",
        startsAt: "2026-10-21T10:00:00+05:00",
        endsAt: "2026-10-21T10:30:00+05:00",
        link: "https://meet.google.com/abc-defg-hij",
        platform: "meet",
        attendees: [{ email: "sam@example.com", name: "Sam Lee" }],
      },
    ]);
    expect(calls[0]).toContain("singleEvents=true");
    expect(calls[0]).toContain("timeMin=2026-10-20T00%3A00%3A00.000Z");
  });

  it("finds the invitees of the event a bot goes to: by the event's id, else by its link", () => {
    const events = [
      {
        id: "e1",
        title: "Launch sync",
        startsAt: "2026-10-21T10:00:00+05:00",
        endsAt: null,
        link: "https://meet.google.com/abc-defg-hij",
        platform: "meet" as const,
        attendees: [{ email: "sam@example.com", name: "Sam Lee" }],
      },
      {
        id: "e2",
        title: "Interview",
        startsAt: "2026-10-21T12:00:00+05:00",
        endsAt: null,
        link: "https://meet.google.com/xyz-abcd-efg",
        platform: "meet" as const,
        attendees: [{ email: "shumail@example.com", name: null }],
      },
    ];
    expect(
      inviteesFor(events, { calendarEventId: "e2", link: "https://meet.google.com/abc-defg-hij" }),
    ).toEqual([{ email: "shumail@example.com", name: null }]);
    expect(
      inviteesFor(events, { calendarEventId: null, link: "https://meet.google.com/abc-defg-hij" }),
    ).toEqual([{ email: "sam@example.com", name: "Sam Lee" }]);
    expect(
      inviteesFor(events, { calendarEventId: "nope", link: "https://meet.google.com/none" }),
    ).toEqual([]);
    expect(inviteesOf(undefined)).toEqual([]);
  });
});
