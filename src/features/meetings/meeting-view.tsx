"use client";

import { FileText, MessageSquareText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { visitorFetch } from "@/lib/visitor-api";
import { HighlightsList, type HighlightView } from "@/features/clips/highlights-list";
import type { CommandView, HostNote } from "@/features/commands/command-view";
import type { AddressEntry } from "@/features/connectors/address-book";
import type { ConnectorView } from "@/features/connectors/registry";
import type { SkillSettings } from "@/features/memory/files";
import { TasksTab } from "@/features/commands/tasks-tab";
import {
  NotesPanel,
  type GenerationState,
  type NoteItem,
  type NotesTab,
} from "@/features/summaries/notes-panel";
import { parseNotesTab } from "@/features/summaries/notes-tab";
import { DEFAULT_TEMPLATE_KEY, findTemplate } from "@/features/summaries/templates";
import { PlayerBar } from "@/features/transcript/player-bar";
import { currentTurnIndex, normaliseClip } from "@/lib/time-rules";
import { findMatches } from "@/features/transcript/find-matches";
import { TranscriptPanel, type TranscriptTurn } from "@/features/transcript/transcript-panel";
import { useMediaPlayer } from "@/features/transcript/use-media-player";
import { VideoPane } from "@/features/transcript/video-pane";
import type { MediaUrl } from "@/server/media/media-url";

/**
 * The meeting page's interactive part: notes on one side, the synced transcript on the
 * other, the player docked below; a bot meeting's video sits above the notes (above the
 * tabs on a phone). On a phone the two panes become tabs.
 *
 * URL state (requirement NFR Persistence): ?t= (the moment), ?tab=, ?template=. Updated
 * with history.replaceState, which Next keeps in sync, so nothing reloads.
 */
export type MeetingViewProps = {
  meetingId: string;
  title: string;
  durationSec: number;
  speakers: Array<{ code: string; label: string }>;
  turns: TranscriptTurn[];
  chapters: Array<{ id: string; title: string; firstTurnId: string }>;
  items: NoteItem[];
  generation: GenerationState[];
  /** The recording's link and when it expires; the view renews it in time. */
  media: MediaUrl | null;
  initialTimeSec: number;
  initialTab: NotesTab;
  initialTemplate: string | null;
  /** From a search result: the term is highlighted in the transcript. */
  initialQuery: string;
  initialHighlights: HighlightView[];
  initialDoneIds: string[];
  /** The Tasks tab: the owner's commands, or demo cards on a sample meeting. */
  commands: CommandView[];
  isOwn: boolean;
  host: HostNote;
  /** The owner's connected apps and the addresses in their people file; empty otherwise. */
  connectors: ConnectorView[];
  addressBook: AddressEntry[];
  /** How the owner wants AFK to write for each app, from the skill files. */
  skills: SkillSettings;
};

export function MeetingView(props: MeetingViewProps) {
  const { meetingId, title, durationSec, speakers, turns, items, generation } = props;
  const toast = useToast();
  const [media, setMedia] = useState(props.media);
  const player = useMediaPlayer({
    hasSource: media !== null,
    durationSec,
    initialTimeSec: props.initialTimeSec,
  });
  const { playhead, seek, play, pause } = player;

  const [tab, setTab] = useState<NotesTab>(props.initialTab);
  // The tab follows ?tab= when something else navigates there, such as "Share the notes"
  // opening Tasks on its new card. The view's own replaceState writes keep the two equal,
  // so this changes nothing when the tab is picked here.
  const urlTab = parseNotesTab(useSearchParams().get("tab") ?? undefined);
  const [seenUrlTab, setSeenUrlTab] = useState(urlTab);
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }
  const [template, setTemplate] = useState(
    findTemplate(props.initialTemplate)?.key ?? DEFAULT_TEMPLATE_KEY,
  );
  // On a phone, a link to a moment opens on the transcript; otherwise the notes come first.
  const [pane, setPane] = useState<"notes" | "transcript">(
    props.initialTimeSec > 0 || props.initialQuery ? "transcript" : "notes",
  );
  const [query, setQuery] = useState(props.initialQuery);
  const [speakerFilter, setSpeakerFilter] = useState<Set<string>>(() => new Set());
  const [followSignal, setFollowSignal] = useState(0);
  const [highlights, setHighlights] = useState(props.initialHighlights);
  // A typed /highlight is created on the server and arrives through router.refresh():
  // adopt the fresh list when the prop changes (state derived from props, during render).
  const [seenHighlights, setSeenHighlights] = useState(props.initialHighlights);
  if (seenHighlights !== props.initialHighlights) {
    setSeenHighlights(props.initialHighlights);
    setHighlights(props.initialHighlights);
  }
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [doneIds, setDoneIds] = useState(() => new Set(props.initialDoneIds));
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const clipEnd = useRef<number | null>(null);

  const turnStart = useMemo(() => new Map(turns.map((turn) => [turn.id, turn.startSec])), [turns]);
  const chapters = useMemo(
    () =>
      props.chapters
        .map((chapter) => ({ ...chapter, startSec: turnStart.get(chapter.firstTurnId) ?? 0 }))
        .sort((a, b) => a.startSec - b.startSec),
    [props.chapters, turnStart],
  );

  // Find in meeting: visible turns (the speaker filter applies) containing the text.
  const matches = useMemo(
    () => findMatches(turns, query, speakerFilter),
    [query, turns, speakerFilter],
  );
  const matchSecs = useMemo(
    () => matches.map((index) => turns[index]?.startSec ?? 0),
    [matches, turns],
  );

  // ---- URL state -------------------------------------------------------------------
  const writeUrl = useCallback((changes: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    writeUrl({ tab: tab === "summary" ? null : tab });
  }, [tab, writeUrl]);
  useEffect(() => {
    writeUrl({ template: template === DEFAULT_TEMPLATE_KEY ? null : template });
  }, [template, writeUrl]);
  // The find term, a moment after typing stops, so a refresh keeps (or clears) it.
  useEffect(() => {
    const timer = setTimeout(() => writeUrl({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [query, writeUrl]);

  // Keep ?t= current while listening (every few seconds) and whenever playback pauses.
  useEffect(() => {
    const save = () => {
      const sec = Math.floor(playhead.get());
      writeUrl({ t: sec > 0 ? String(sec) : null });
    };
    if (!player.playing) {
      save();
      return;
    }
    const timer = setInterval(save, 4000);
    return () => clearInterval(timer);
  }, [player.playing, playhead, writeUrl]);

  // A highlight being played stops at its end.
  useEffect(
    () =>
      playhead.subscribe(() => {
        if (clipEnd.current !== null && playhead.get() >= clipEnd.current) {
          clipEnd.current = null;
          pause();
        }
      }),
    [playhead, pause],
  );

  // ---- Seeking -------------------------------------------------------------------------
  /** Jump to a moment the visitor chose (a timestamp, a chapter, a line) and play it. */
  const playFrom = useCallback(
    (sec: number) => {
      clipEnd.current = null;
      seek(sec);
      setFollowSignal((value) => value + 1);
      void play();
    },
    [seek, play],
  );

  const onTimelineSeek = useCallback(
    (sec: number) => {
      clipEnd.current = null;
      seek(sec);
      setFollowSignal((value) => value + 1);
    },
    [seek],
  );

  // ---- Highlights ------------------------------------------------------------------------
  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const createHighlight = useCallback(
    async (range: { startSec: number; endSec: number }) => {
      const clip = normaliseClip(range, durationSec);
      try {
        const { highlight } = await visitorFetch<{ highlight: HighlightView }>("/api/highlights", {
          method: "POST",
          body: { meetingId, ...clip },
        });
        setHighlights((current) => [...current, highlight]);
        setTab("highlights");
        setPane("notes");
        toast(`Highlighted ${Math.round(clip.endSec - clip.startSec)} s`);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Couldn't save the highlight.", "error");
      }
    },
    [durationSec, meetingId, toast],
  );

  /**
   * H: clip from where the current speaker started (as Fathom does), through the end of
   * their turn, at least 20 s and at most 90 s. In a very long turn, start near now.
   */
  const highlightNow = useCallback(() => {
    const sec = playhead.get();
    const turn = turns[currentTurnIndex(turns, sec)];
    let startSec = turn ? turn.startSec : Math.max(0, sec - 10);
    if (sec - startSec > 45) startSec = sec - 30;
    const endSec = Math.min(Math.max(sec + 5, startSec + 20, turn?.endSec ?? 0), startSec + 90);
    void createHighlight({ startSec, endSec });
  }, [createHighlight, playhead, turns]);

  const adjustHighlight = async (
    highlight: HighlightView,
    change: { startSec?: number; endSec?: number },
  ) => {
    const clip = normaliseClip(
      {
        startSec: change.startSec ?? highlight.startSec,
        endSec: change.endSec ?? highlight.endSec,
      },
      durationSec,
    );
    const previous = highlights;
    setHighlights((current) =>
      current.map((item) => (item.id === highlight.id ? { ...item, ...clip } : item)),
    );
    markBusy(highlight.id, true);
    try {
      await visitorFetch(`/api/highlights/${highlight.id}`, { method: "PATCH", body: clip });
    } catch (error) {
      setHighlights(previous);
      toast(error instanceof Error ? error.message : "Couldn't change the highlight.", "error");
    } finally {
      markBusy(highlight.id, false);
    }
  };

  const shareHighlight = async (highlight: HighlightView) => {
    markBusy(highlight.id, true);
    try {
      const { token } = highlight.shareToken
        ? { token: highlight.shareToken }
        : await visitorFetch<{ token: string }>(`/api/highlights/${highlight.id}/share`, {
            method: "POST",
          });
      setHighlights((current) =>
        current.map((item) => (item.id === highlight.id ? { ...item, shareToken: token } : item)),
      );
      const url = `${window.location.origin}/share/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copied. Anyone with it can play this clip, and nothing else.");
      } catch {
        window.prompt("Copy this link", url);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create a link.", "error");
    } finally {
      markBusy(highlight.id, false);
    }
  };

  const unshareHighlight = async (highlight: HighlightView) => {
    markBusy(highlight.id, true);
    try {
      await visitorFetch(`/api/highlights/${highlight.id}/share`, { method: "DELETE" });
      setHighlights((current) =>
        current.map((item) => (item.id === highlight.id ? { ...item, shareToken: null } : item)),
      );
      toast("Link turned off. Anyone who opens it now sees that it's unavailable.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't turn the link off.", "error");
    } finally {
      markBusy(highlight.id, false);
    }
  };

  const deleteHighlight = async (highlight: HighlightView) => {
    const previous = highlights;
    setHighlights((current) => current.filter((item) => item.id !== highlight.id));
    try {
      await visitorFetch(`/api/highlights/${highlight.id}`, { method: "DELETE" });
      toast("Highlight deleted");
    } catch (error) {
      setHighlights(previous);
      toast(error instanceof Error ? error.message : "Couldn't delete the highlight.", "error");
    }
  };

  const playClip = (highlight: HighlightView) => {
    seek(highlight.startSec);
    clipEnd.current = highlight.endSec;
    setFollowSignal((value) => value + 1);
    void play();
  };

  // ---- Ticks -----------------------------------------------------------------------------
  const toggleDone = async (itemId: string, done: boolean) => {
    setDoneIds((current) => {
      const next = new Set(current);
      if (done) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
    try {
      await visitorFetch(`/api/items/${itemId}/state`, { method: "PUT", body: { done } });
    } catch (error) {
      setDoneIds((current) => {
        const next = new Set(current);
        if (done) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
      toast(error instanceof Error ? error.message : "Couldn't save that.", "error");
    }
  };

  // ---- Keyboard shortcuts (off while typing) -----------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Off while typing. The timeline slider keeps the arrow keys for itself (it stops
      // their propagation), so the player shortcuts still work after a click on it.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === " " && target?.closest("button, a, [role='tab'], [role='checkbox']")) return;
      if (key === " " || key === "k") {
        event.preventDefault();
        player.toggle();
      } else if (key === "j") seek(playhead.get() - 10);
      else if (key === "l") seek(playhead.get() + 10);
      else if (key === "h") {
        event.preventDefault();
        highlightNow();
      } else if (key === "/") {
        event.preventDefault();
        setPane("transcript");
        // On a phone the transcript pane is hidden until this render lands.
        setTimeout(() => findInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [player, seek, playhead, highlightNow]);

  /** A fresh link for the recording, swapped under the player, which keeps its place. */
  const renewMedia = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/meetings/${meetingId}/media`);
      const body = (await response.json()) as Partial<MediaUrl>;
      if (!response.ok || !body.kind || !body.url || !body.expiresAt) throw new Error();
      setMedia({ kind: body.kind, url: body.url, expiresAt: body.expiresAt });
      return true;
    } catch {
      return false;
    }
  }, [meetingId]);

  const retryMedia = async () => {
    if (!(await renewMedia())) {
      toast("The recording is still unavailable. Try again later.", "error");
    }
  };

  // A video's link lasts thirty minutes (an audio link an hour or six): a fresh one is
  // fetched shortly before the current one expires, so a long watch never stalls.
  useEffect(() => {
    if (!media) return;
    const due = Date.parse(media.expiresAt) - RENEW_BEFORE_MS - Date.now();
    const timer = setTimeout(() => void renewMedia(), Math.max(due, 1_000));
    return () => clearTimeout(timer);
  }, [media, renewMedia]);

  const dimmed = useMemo(
    () =>
      speakerFilter.size === 0
        ? new Set<string>()
        : new Set(
            speakers.map((speaker) => speaker.code).filter((code) => !speakerFilter.has(code)),
          ),
    [speakerFilter, speakers],
  );

  const isWide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

  // True once React has hydrated this view (tests wait for it before interacting).
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-hydrated={hydrated}>
      {media?.kind === "audio" && (
        // The synced transcript is the caption track for this audio.
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
            ["notes", "Notes", FileText],
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
          <div className="min-h-0 flex-1">
            <NotesPanel
              meetingId={meetingId}
              meetingTitle={title}
              items={items}
              turnStart={turnStart}
              speakers={speakers}
              chapters={chapters}
              generation={generation}
              doneIds={doneIds}
              onToggleDone={toggleDone}
              template={template}
              onTemplateChange={setTemplate}
              tab={tab}
              onTabChange={setTab}
              onSeek={(sec) => {
                playFrom(sec);
              }}
              playhead={playhead}
              highlightCount={highlights.length}
              highlights={
                <HighlightsList
                  highlights={highlights}
                  turns={turns}
                  busyIds={busyIds}
                  onPlay={playClip}
                  onAdjust={adjustHighlight}
                  onShare={shareHighlight}
                  onUnshare={unshareHighlight}
                  onDelete={deleteHighlight}
                  onCreate={highlightNow}
                />
              }
              taskCount={
                props.isOwn
                  ? props.commands.filter((command) => command.status !== "dismissed").length
                  : undefined
              }
              tasks={
                <TasksTab
                  meetingId={meetingId}
                  isOwn={props.isOwn}
                  commands={props.commands}
                  host={props.host}
                  speakers={speakers}
                  turnStart={turnStart}
                  onSeek={(sec) => {
                    playFrom(sec);
                  }}
                  playhead={playhead}
                  connectors={props.connectors}
                  addressBook={props.addressBook}
                  skills={props.skills}
                />
              }
            />
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
            onHighlightRange={(range) => void createHighlight(range)}
            followSignal={followSignal}
            findInputRef={findInputRef}
            visible={pane === "transcript" || isWide}
          />
        </div>
      </div>

      <PlayerBar
        player={player}
        durationSec={durationSec}
        media={media?.kind ?? null}
        onHighlight={highlightNow}
        onRetryMedia={retryMedia}
        onTimelineSeek={onTimelineSeek}
        timeline={{
          speakers,
          turns,
          chapters,
          matchSecs,
          highlights,
          dimmedSpeakers: dimmed,
        }}
      />
    </div>
  );
}

const noopSubscribe = () => () => {};

/** A recording's link is renewed this long before it expires. */
const RENEW_BEFORE_MS = 2 * 60_000;

/**
 * Indexes of the turns that contain `query` (case-insensitive, at least two characters),
 * limited to the speakers shown when a filter is on, so the match count, next/previous
 * and the timeline marks agree with the rows on screen.
 */

// Tailwind's lg breakpoint: both panes side by side.
const WIDE = "(min-width: 64rem)";
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
