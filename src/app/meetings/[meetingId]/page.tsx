import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/features/meetings/auto-refresh";
import { hasPendingWork, needsKick } from "@/features/meetings/generation-state";
import { getMeeting } from "@/features/meetings/meeting-queries";
import { MeetingHeader } from "@/features/meetings/meeting-header";
import { MeetingProcessing } from "@/features/meetings/meeting-processing";
import { MeetingView } from "@/features/meetings/meeting-view";
import { WrapUpPrompt } from "@/features/meetings/wrap-up";
import { parseNotesTab } from "@/features/summaries/notes-tab";
import { clampTime, parseTimeParam } from "@/lib/time-rules";
import { EMPTY_SKILLS } from "@/features/memory/files";
import { loadSkillSettings } from "@/features/memory/memory-queries";
import { listConnectors, loadAddressBook } from "@/server/connectors/store";
import { kickJobs } from "@/server/jobs";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/** The page runs the meeting's waiting jobs after it renders (see server/jobs.ts). */
// The literal: Next.js reads a segment config statically (JOB_FUNCTION_SECONDS,
// which a test keeps equal to it).
export const maxDuration = 300;

type Props = {
  params: Promise<{ meetingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** As often as the processing page checks: a pending note or card shows within seconds. */
const REFRESH_MS = 10_000;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { meetingId } = await params;
  const detail = MEETING_ID.test(meetingId) ? await getMeeting(meetingId) : null;
  if (!detail) return { title: "Meeting not found", robots: { index: false, follow: false } };
  const { meeting } = detail;
  // Sample meetings are public pages; a user's own meeting is theirs alone.
  return {
    title: meeting.title,
    description: meeting.headline ?? undefined,
    alternates: meeting.isOwn ? undefined : { canonical: `/meetings/${meeting.id}` },
    robots: meeting.isOwn ? { index: false, follow: false } : undefined,
    openGraph: { title: meeting.title, description: meeting.headline ?? undefined },
  };
}

export default async function MeetingPage({ params, searchParams }: Props) {
  const { meetingId } = await params;
  if (!MEETING_ID.test(meetingId)) notFound();
  const query = await searchParams;

  const detail = await getMeeting(meetingId);
  if (!detail) notFound();
  const { meeting } = detail;

  // Work waiting on this meeting (the recording to fetch, notes to write) runs after the
  // page has gone out; the page refreshes itself meanwhile. Only when something can be
  // claimed: a queued job, or a running one whose lease has gone stale (a cut-off
  // function); a job another function is working on is left to it.
  if (detail.commandsQueued || needsKick(meeting.status, detail.generation)) {
    kickJobs({ meetingId: meeting.id });
  }

  if (meeting.status !== "ready" || meeting.durationSec === null) {
    return <MeetingProcessing meeting={meeting} />;
  }

  const initialTimeSec = clampTime(parseTimeParam(first(query.t)) ?? 0, meeting.durationSec);
  // The Tasks tab's approval forms need the owner's connected apps, address book and skills.
  const [connectors, addressBook, skills] = meeting.isOwn
    ? await Promise.all([listConnectors(), loadAddressBook(), loadSkillSettings()])
    : [[], [], EMPTY_SKILLS];

  return (
    <div className="flex h-dvh flex-col">
      <MeetingHeader
        meetingId={meeting.id}
        isOwn={meeting.isOwn}
        title={meeting.title}
        recordedAt={meeting.recordedAt}
        durationSec={meeting.durationSec}
        headline={meeting.headline}
        speakers={detail.speakers}
        source={meeting.source}
        link={detail.link}
      />
      <MeetingView
        key={meeting.id}
        meetingId={meeting.id}
        title={meeting.title}
        durationSec={meeting.durationSec}
        speakers={detail.speakers}
        turns={detail.turns}
        chapters={detail.chapters}
        items={detail.items}
        generation={detail.generation}
        media={detail.media}
        initialTimeSec={initialTimeSec}
        initialTab={parseNotesTab(first(query.tab))}
        initialTemplate={first(query.template) ?? null}
        initialQuery={(first(query.q) ?? "").slice(0, 100)}
        initialHighlights={detail.highlights}
        initialDoneIds={detail.doneItemIds}
        commands={detail.commands}
        isOwn={meeting.isOwn}
        host={meeting.host}
        connectors={connectors}
        addressBook={addressBook}
        skills={skills}
      />
      {meeting.isOwn && <WrapUpPrompt />}
      {/* Notes being written or a card being drafted: shown here when they land. */}
      {hasPendingWork(detail.generation, detail.commands) && <AutoRefresh everyMs={REFRESH_MS} />}
    </div>
  );
}
