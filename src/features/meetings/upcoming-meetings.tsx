"use client";

import { CalendarClock, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { UpcomingEvent } from "@/features/connectors/calendar";
import { formatDateTimeUtc } from "@/lib/format-date";
import { visitorFetch } from "@/lib/visitor-api";

/**
 * The next week on the host's calendar, the meetings with a video link:
 * Send AFK schedules the bot for that time; the switch asks AFK to do that for every
 * such meeting by itself, which the daily keep-alive carries out a day ahead.
 */
export function UpcomingMeetings({
  events,
  scheduled,
  autoJoin,
}: {
  events: ReadonlyArray<UpcomingEvent>;
  /** Calendar event ids AFK is already scheduled for. */
  scheduled: ReadonlyArray<string>;
  autoJoin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoJoin);
  const [switching, setSwitching] = useState(false);
  const done = new Set(scheduled);

  const send = async (event: UpcomingEvent) => {
    setBusy(event.id);
    try {
      await visitorFetch("/api/bot", {
        method: "POST",
        body: {
          meetingUrl: event.link,
          title: event.title,
          joinAt: event.startsAt,
          calendarEventId: event.id,
        },
      });
      toast(`AFK joins "${event.title}" at its time.`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async () => {
    setSwitching(true);
    try {
      const result = await visitorFetch<{ enabled: boolean }>("/api/calendar/autojoin", {
        method: "POST",
        body: { enabled: !auto },
      });
      setAuto(result.enabled);
      toast(
        result.enabled
          ? "AFK joins every meeting with a link from now on, scheduled a day ahead."
          : "AFK joins only the meetings you send it to.",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't save.", "error");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section
      aria-labelledby="upcoming-title"
      className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="upcoming-title" className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-accent-strong" aria-hidden />
          On your calendar this week
        </h2>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={auto}
            disabled={switching}
            onChange={() => void toggle()}
            className="size-4 accent-accent"
          />
          Join every meeting with a link
        </label>
      </div>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          No meetings with a Zoom, Meet or Teams link in the next seven days.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{event.title}</p>
                <p className="font-mono text-[0.7rem] text-fg-muted">
                  {formatDateTimeUtc(event.startsAt)} · {event.platform}
                </p>
              </div>
              {done.has(event.id) ? (
                <span className="inline-flex items-center gap-1 text-xs text-success-strong">
                  <Check className="size-4" aria-hidden />
                  AFK joins
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === event.id}
                  onClick={() => void send(event)}
                >
                  Send AFK
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
