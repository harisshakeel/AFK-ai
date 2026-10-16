"use client";

import { FileText, MessageSquareText } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { findMatches } from "@/features/transcript/find-matches";
import { PlayerBar } from "@/features/transcript/player-bar";
import { TranscriptPanel } from "@/features/transcript/transcript-panel";
import { useMediaPlayer } from "@/features/transcript/use-media-player";
import { VideoPane } from "@/features/transcript/video-pane";
import { useRenewingMedia } from "@/features/meetings/use-renewing-media";

import type { SharedMeetingData } from "./shared-data";
import { SharedSummary } from "./shared-summary";

/**
 * A shared meeting (2026-10-16): the recording, the summary and the synced transcript,
 * laid out as the meeting page is, with nothing to change: no highlights, no ticks, no
 * tasks. The recording's link is renewed through the link's own media route.
 */

export function SharedMeetingView({ code, data }: { code: string; data: SharedMeetingData }) {
  const { turns, speakers, items } = data;
  const durationSec = data.meeting.durationSec;
  const { media, renew } = useRenewingMedia(data.media, `/api/m/${code}/media`);
  const player = useMediaPlayer({ hasSource: media !== null, durationSec, initialTimeSec: 0 });
  const { playhead, seek, play } = player;

  const [pane, setPane] = useState<"notes" | "transcript">("notes");
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<Set<string>>(() => new Set());
  const [followSignal, setFollowSignal] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const turnStart = useMemo(() => new Map(turns.map((turn) => [turn.id, turn.startSec])), [turns]);
  const matches = useMemo(
    () => findMatches(turns, query, speakerFilter),
    [query, turns, speakerFilter],
  );
  const matchSecs = useMemo(
    () => matches.map((index) => turns[index]?.startSec ?? 0),
    [matches, turns],
  );
  const dimmed = useMemo(
    () =>
      speakerFilter.size === 0
        ? new Set<string>()
        : new Set(
            speakers.map((speaker) => speaker.code).filter((code) => !speakerFilter.has(code)),
          ),
    [speakerFilter, speakers],
  );

  const playFrom = useCallback(
    (sec: number) => {
      seek(sec);
      setFollowSignal((value) => value + 1);
      void play();
    },
    [seek, play],
  );
  const onTimelineSeek = useCallback(
    (sec: number) => {
      seek(sec);
      setFollowSignal((value) => value + 1);
    },
    [seek],
  );

  const isWide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-hydrated={hydrated}>
      {media?.kind === "audio" && (
        <audio key={media.url} src={media.url} {...player.mediaProps} className="hidden" />
      )}
      {media?.kind === "video" && !isWide && <VideoPane src={media.url} player={player} />}

      <div
        className="flex border-b border-border px-3 py-1.5 lg:hidden"
        role="group"
        aria-label="Show"
      >
        {(
          [
            ["notes", "Summary", FileText],
            ["transcript", "Transcript", MessageSquareText],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={pane === key}
            onClick={() => setPane(key)}
            className={cn(
              "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium",
              pane === key ? "bg-accent-soft text-accent-strong" : "text-fg-muted",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div
          className={cn(
            "min-h-0 flex-col border-border lg:flex lg:border-r",
            pane === "notes" ? "flex" : "hidden",
          )}
        >
          {media?.kind === "video" && isWide && <VideoPane src={media.url} player={player} />}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <SharedSummary items={items} turnStart={turnStart} onSeek={playFrom} />
          </div>
        </div>
        <div className={cn("min-h-0 lg:block", pane === "transcript" ? "block" : "hidden")}>
          <TranscriptPanel
            turns={turns}
            speakers={speakers}
            playhead={playhead}
            playing={player.playing}
            onSeek={playFrom}
            query={query}
            onQueryChange={setQuery}
            matches={matches}
            speakerFilter={speakerFilter}
            onSpeakerFilterChange={setSpeakerFilter}
            onHighlightRange={() => {}}
            followSignal={followSignal}
            findInputRef={findInputRef}
            visible={pane === "transcript" || isWide}
            readOnly
          />
        </div>
      </div>

      <PlayerBar
        player={player}
        durationSec={durationSec}
        media={media?.kind ?? null}
        onHighlight={() => {}}
        onRetryMedia={() => void renew()}
        onTimelineSeek={onTimelineSeek}
        readOnly
        timeline={{
          speakers,
          turns,
          chapters: [],
          matchSecs,
          highlights: [],
          dimmedSpeakers: dimmed,
        }}
      />
    </div>
  );
}

const WIDE = "(min-width: 64rem)";
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
