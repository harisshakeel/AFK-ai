import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { GuestNotice } from "@/components/guest-notice";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import { Reveal } from "@/components/ui/reveal";
import { ApprovalCards } from "@/features/commands/approval-cards";
import { profileNames } from "@/features/commands/sender";
import { listUpcomingEvents, type UpcomingEvent } from "@/features/connectors/calendar";
import { appReady, connectorApp } from "@/features/connectors/registry";
import { checklistItems, FirstRunChecklist } from "@/features/meetings/first-run-checklist";
import { UpcomingMeetings } from "@/features/meetings/upcoming-meetings";
import { EMPTY_SKILLS, profileSays } from "@/features/memory/files";
import { listTasks } from "@/features/commands/tasks-queries";
import { afkRecord } from "@/features/meetings/afk-record";
import { AfkPlayerCard } from "@/features/meetings/afk-player-card";
import { dashboardRecordInput, emptyRecordInput } from "@/features/meetings/dashboard-queries";
import { groupByTime } from "@/features/meetings/group-by-time";
import { MeetingCard, OlderMeetingsLink } from "@/features/meetings/meeting-list";
import { listMeetings } from "@/features/meetings/meeting-queries";
import { loadSkillSettings } from "@/features/memory/memory-queries";
import { formatDuration } from "@/lib/time-rules";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { getViewer, viewerFirstName } from "@/server/auth/viewer";
import { googleAccessForUser, listConnectors, loadAddressBook } from "@/server/connectors/store";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";

export const metadata: Metadata = {
  title: "Quest log",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The quest log (requirement F1): the title, one quiet line of counted numbers, then
 * every call AFK recorded for you, grouped by when it happened, which is what the page
 * is for, with the player card beside it (level, twelve weeks, side quests, streak,
 * achievements). On a wide screen the page is framed to the viewport and only the list
 * scrolls; the full card is at /dashboard/record. Private to you. A guest sees their own
 * workspace with the notice that says where it lives (guest mode); a visitor
 * with no workspace yet sees the empty log and the way to start one.
 */
export default async function DashboardPage({ searchParams }: Props) {
  const viewer = await getViewer();
  const { after } = await searchParams;
  const own = Boolean(viewer.userId);
  const [
    { meetings, nextCursor },
    input,
    signInEnabled,
    awaiting,
    connectors,
    addressBook,
    skills,
  ] = await Promise.all([
    own ? listMeetings("own", { after }) : Promise.resolve({ meetings: [], nextCursor: null }),
    viewer.userId ? dashboardRecordInput(viewer.userId) : Promise.resolve(emptyRecordInput()),
    viewer.isGuest ? isGoogleSignInEnabled() : Promise.resolve(false),
    // The cards waiting for approval, with what their forms need to fill themselves in.
    own ? listTasks({ status: "proposed" }) : Promise.resolve([]),
    own ? listConnectors() : Promise.resolve([]),
    own ? loadAddressBook() : Promise.resolve([]),
    own && !viewer.isGuest ? loadSkillSettings() : Promise.resolve(EMPTY_SKILLS),
  ]);
  // The first-run checklist and the calendar: a few more reads for an owner, none for a
  // visitor; both need only the connectors, so they run side by side.
  const [setup, calendar] = await Promise.all([
    own ? firstRun(viewer.isGuest, connectors) : Promise.resolve(null),
    own && viewer.userId && !viewer.isGuest
      ? upcoming(viewer.userId, connectors)
      : Promise.resolve(null),
  ]);
  const groups = groupByTime(meetings, (meeting) => meeting.recordedAt);
  const firstPage = !after;
  const firstName = viewerFirstName(viewer);
  const record = afkRecord(input);
  const openActions = Math.max(0, input.actions - input.doneActions);
  const spells = input.awaitingApproval === 1 ? "spell" : "spells";
  const numbers = [
    `${input.meetings} ${input.meetings === 1 ? "quest" : "quests"}`,
    `${record.recordedSec > 0 ? formatDuration(record.recordedSec) : "0 min"} played`,
    `${openActions} open ${openActions === 1 ? "side quest" : "side quests"}`,
    ...(input.awaitingApproval > 0
      ? [`${input.awaitingApproval} ${spells} awaiting your cast`]
      : []),
  ];

  return (
    <AppShell
      viewer={viewer}
      fill
      actions={
        <Link href="/send" className={buttonClass("primary", "md")}>
          <span className="sm:hidden">Summon AFK</span>
          <span className="hidden sm:inline">Summon AFK to a meeting</span>
        </Link>
      }
    >
      {viewer.isGuest && (
        <Reveal className="mb-6">
          <GuestNotice signInEnabled={signInEnabled} />
        </Reveal>
      )}
      <Reveal>
        <PageTitle
          eyebrow={`Player one: ${firstName}`}
          title="Quest log"
          lede={
            firstPage ? (
              <span className="font-mono text-[0.72rem] tracking-wide text-fg-subtle">
                {numbers.join(" · ")}
              </span>
            ) : undefined
          }
        />
      </Reveal>

      <div className="mt-6 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8">
        {/* The list is the one thing that scrolls on a wide screen. */}
        <section aria-label="Quests" className="min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-2">
          {setup && firstPage && <FirstRunChecklist items={setup.items} />}
          {calendar && firstPage && (
            <UpcomingMeetings
              events={calendar.events}
              scheduled={calendar.scheduled}
              autoJoin={setup?.autoJoin ?? false}
            />
          )}
          {awaiting.length > 0 && firstPage && (
            <Reveal delay={0.05} className="mb-6">
              <section
                aria-labelledby="awaiting-title"
                className="rounded-2xl border border-warning/40 bg-warning/5 p-4 sm:p-5"
              >
                <h2 id="awaiting-title" className="flex items-center gap-2 text-lg font-semibold">
                  Awaiting your approval
                  <Badge tone="warning">{awaiting.length}</Badge>
                </h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Nothing leaves a meeting until you approve it, here or on the meeting&apos;s Tasks
                  tab. Every address AFK filled in says why.
                </p>
                <div className="mt-4">
                  <ApprovalCards
                    tasks={awaiting}
                    connectors={connectors}
                    addressBook={addressBook}
                    skills={skills}
                  />
                </div>
              </section>
            </Reveal>
          )}
          {meetings.length === 0 && firstPage ? (
            <Reveal
              delay={0.1}
              className="rounded-2xl border border-dashed border-border-strong p-10 text-center"
            >
              <p className="font-display text-2xl font-medium tracking-tight">No quests yet</p>
              <p className="mx-auto mt-2 max-w-prose text-sm text-fg-muted">
                Summon AFK to your next call, go do literally anything else, and come back for the
                recording, the transcript and the loot.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link href="/send" className={buttonClass("primary", "md")}>
                  Summon AFK to a meeting
                </Link>
                <Link href="/samples" className={buttonClass("secondary", "md")}>
                  Try the tutorial quests
                </Link>
              </div>
            </Reveal>
          ) : meetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-strong p-10 text-center">
              <p className="font-medium">No older quests</p>
              <Link href="/dashboard" className={buttonClass("secondary", "md", "mt-5")}>
                Back to the latest
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {groups.map((group, groupIndex) => (
                <Reveal key={group.label} delay={0.1 + groupIndex * 0.08} className="contents">
                  <section aria-labelledby={`period-${groupIndex}`}>
                    <h2
                      id={`period-${groupIndex}`}
                      className="mb-3 font-mono text-[0.7rem] font-medium tracking-[0.14em] text-fg-subtle uppercase"
                    >
                      {group.label}
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {group.items.map((meeting) => (
                        <MeetingCard key={meeting.id} meeting={meeting} />
                      ))}
                    </ul>
                  </section>
                </Reveal>
              ))}
              {nextCursor && <OlderMeetingsLink href={`/dashboard?after=${nextCursor}`} />}
            </div>
          )}
        </section>
        {firstPage && (
          <div className="min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-2">
            <AfkPlayerCard record={record} input={input} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** What a new account still has to do once, from what exists; and the auto-join switch. */
async function firstRun(
  guest: boolean,
  connectors: Awaited<ReturnType<typeof listConnectors>>,
): Promise<{ items: ReturnType<typeof checklistItems>; autoJoin: boolean }> {
  const supabase = await createSupabaseServerClient();
  const [profile, sent, matched] = await Promise.all([
    guest
      ? Promise.resolve({ data: null })
      : supabase.from("memory_files").select("content").eq("path", "profile.md").maybeSingle(),
    supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .not("bot_id", "is", null),
    // A call in which AFK told the host apart by name proves the name it knows works.
    supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("host_detected_by", "name"),
  ]);
  const content = profile.data?.content ?? null;
  const nameInCalls =
    /^\s*-\s*Name in calls\s*:\s*\S/im.test(content ?? "") || (matched.count ?? 0) > 0;
  return {
    items: checklistItems({
      guest,
      googleReady:
        appReady(connectorApp("gmail"), connectors) &&
        appReady(connectorApp("google-calendar"), connectors),
      slackChannel: appReady(connectorApp("slack"), connectors),
      nameInCalls: nameInCalls || profileNames(content).length > 1,
      sentOnce: (sent.count ?? 0) > 0,
    }),
    autoJoin: profileSays(content, "AFK joins my calendar meetings") === true,
  };
}

/** The next seven days on the calendar, and which of them AFK is already scheduled for. */
async function upcoming(
  userId: string,
  connectors: Awaited<ReturnType<typeof listConnectors>>,
): Promise<{ events: UpcomingEvent[]; scheduled: string[] } | null> {
  if (!appReady(connectorApp("google-calendar"), connectors)) return null;
  try {
    const google = await googleAccessForUser(userId);
    if (!google) return null;
    const now = new Date();
    const events = await listUpcomingEvents(google.accessToken, {
      from: now,
      to: new Date(now.getTime() + 7 * 86_400_000),
    });
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("meetings")
      .select("calendar_event_id")
      .in(
        "calendar_event_id",
        events.map((event) => event.id),
      )
      .in("status", ["scheduled", "requested", "recording", "transcribed", "ready"]);
    return {
      events,
      scheduled: (data ?? [])
        .map((row) => row.calendar_event_id)
        .filter((id): id is string => typeof id === "string"),
    };
  } catch (error) {
    // The calendar is a convenience; the log stands without it.
    log.warn("dashboard.calendar_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
