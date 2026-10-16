"use client";

import { ArrowDownToLine, ChevronDown, ChevronUp, Highlighter, Search } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { SpeakerMark } from "@/components/ui/speaker-mark";
import { cn } from "@/lib/cn";

import { usePlayheadDerived, type Playhead } from "@/lib/playhead";
import { speakerStyle, type Speaker, indexSpeakers } from "@/lib/speakers";
import { currentTurnIndex, firstMatchAtOrAfter, formatTime } from "@/lib/time-rules";

/**
 * The synced transcript (requirements F2, F3). The line under the playhead is marked and
 * kept in view while playing; scrolling away stops following and offers "Back to now".
 * Click a line (or its time) to play from it; select text to highlight that stretch.
 */
export type TranscriptTurn = {
  id: string;
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
};

type Props = {
  turns: ReadonlyArray<TranscriptTurn>;
  speakers: ReadonlyArray<Speaker>;
  playhead: Playhead;
  playing: boolean;
  onSeek: (sec: number) => void;
  query: string;
  onQueryChange: (query: string) => void;
  matches: ReadonlyArray<number>;
  speakerFilter: ReadonlySet<string>;
  onSpeakerFilterChange: (filter: Set<string>) => void;
  onHighlightRange: (range: { startSec: number; endSec: number }) => void;
  /** Bumped by the page when it seeks on purpose (a timestamp, a chapter): follow again. */
  followSignal: number;
  findInputRef: React.RefObject<HTMLInputElement | null>;
  /** False while a phone shows the notes pane instead. */
  visible: boolean;
  /** A shared meeting: no highlighting from a selection. */
  readOnly?: boolean;
};

export function TranscriptPanel(props: Props) {
  const {
    turns,
    speakers,
    playhead,
    playing,
    onSeek,
    query,
    onQueryChange,
    matches,
    speakerFilter,
    onSpeakerFilterChange,
    onHighlightRange,
    followSignal,
    findInputRef,
    visible,
    readOnly = false,
  } = props;

  const currentIndex = usePlayheadDerived(playhead, (sec) => currentTurnIndex(turns, sec));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Following resumes whenever the page seeks on purpose (followSignal changes), and a
  // new search starts at its first match: both derived during render, not in effects.
  const [followState, setFollowState] = useState({ following: true, signal: followSignal });
  const following = followState.signal === followSignal ? followState.following : true;
  const setFollowing = useCallback(
    (value: boolean) => setFollowState({ following: value, signal: followSignal }),
    [followSignal],
  );
  // The ring starts on the first match at or after the current line (a search result
  // lands on its moment, not on the meeting's first match) and stays where the visitor
  // steps it until the matches change (new term, or a speaker filter).
  const [matchState, setMatchState] = useState<{
    matches: ReadonlyArray<number>;
    index: number;
  } | null>(null);
  const activeMatch =
    matchState?.matches === matches ? matchState.index : firstMatchAtOrAfter(matches, currentIndex);
  const setActiveMatch = (index: number) => setMatchState({ matches, index });
  const [selection, setSelection] = useState<{
    startIndex: number;
    endIndex: number;
    top: number;
    left: number;
  } | null>(null);

  const speakerIndex = useMemo(() => indexSpeakers(speakers), [speakers]);
  const labelOf = useCallback(
    (code: string) => speakers[speakerIndex.get(code) ?? -1]?.label ?? code,
    [speakers, speakerIndex],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!container || !row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = row.offsetTop - container.clientHeight / 3;
    container.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : behavior });
  }, []);

  // Follow the playhead.
  useEffect(() => {
    if (following && currentIndex >= 0) scrollToIndex(currentIndex, playing ? "smooth" : "auto");
  }, [currentIndex, following, playing, scrollToIndex]);

  // Land on the right line on first render (?t= links) and whenever the pane is shown.
  useLayoutEffect(() => {
    if (visible && currentIndex >= 0) scrollToIndex(currentIndex, "auto");
    // only when visibility changes, not on every new line
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const goToMatch = (step: number) => {
    if (matches.length === 0) return;
    const next = (activeMatch + step + matches.length) % matches.length;
    setActiveMatch(next);
    setFollowing(false);
    const index = matches[next];
    if (index !== undefined) scrollToIndex(index);
  };

  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      onQueryChange("");
      event.currentTarget.blur();
    }
  };

  const stopFollowing = () => setFollowing(false);

  const onPointerUp = () => {
    if (readOnly) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !scrollRef.current) {
      setSelection(null);
      return;
    }
    const rowOf = (node: Node | null) =>
      (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-index]");
    const a = rowOf(selected.anchorNode);
    const b = rowOf(selected.focusNode);
    if (!a || !b || !scrollRef.current.contains(a) || !scrollRef.current.contains(b)) return;
    const ai = Number(a.dataset.index);
    const bi = Number(b.dataset.index);
    const rect = selected.getRangeAt(0).getBoundingClientRect();
    const box = scrollRef.current.getBoundingClientRect();
    setSelection({
      startIndex: Math.min(ai, bi),
      endIndex: Math.max(ai, bi),
      top: rect.top - box.top + scrollRef.current.scrollTop - 44,
      left: Math.min(Math.max(rect.left - box.left + rect.width / 2, 80), box.width - 80),
    });
  };

  const highlightSelection = () => {
    if (!selection) return;
    const first = turns[selection.startIndex];
    const last = turns[selection.endIndex];
    if (first && last) onHighlightRange({ startSec: first.startSec, endSec: last.endSec });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const toggleSpeaker = (code: string) => {
    const next = new Set(speakerFilter);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onSpeakerFilterChange(next.size === speakers.length ? new Set() : next);
  };

  const filtering = speakerFilter.size > 0;

  return (
    <section aria-label="Transcript" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <label className="relative flex min-w-0 flex-1 items-center">
            <span className="sr-only">Find in this meeting</span>
            <Search
              className="pointer-events-none absolute left-2.5 size-4 text-fg-subtle"
              aria-hidden
            />
            <input
              ref={findInputRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onFindKeyDown}
              placeholder="Find in this meeting"
              className={inputClass("h-9 pr-24 pl-8")}
            />
            {query && (
              <span className="absolute right-1 flex items-center gap-0.5">
                <span className="px-1 text-xs text-fg-muted tabular-nums" aria-live="polite">
                  {matches.length === 0
                    ? "No matches"
                    : `${Math.min(activeMatch + 1, matches.length)} of ${matches.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => goToMatch(-1)}
                  disabled={matches.length === 0}
                  aria-label="Previous match"
                  className="grid size-7 place-items-center rounded text-fg-muted hover:bg-surface-raised disabled:opacity-30"
                >
                  <ChevronUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => goToMatch(1)}
                  disabled={matches.length === 0}
                  aria-label="Next match"
                  className="grid size-7 place-items-center rounded text-fg-muted hover:bg-surface-raised disabled:opacity-30"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </span>
            )}
          </label>
        </div>
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="group"
          aria-label="Show speakers"
        >
          <button
            type="button"
            onClick={() => onSpeakerFilterChange(new Set())}
            aria-pressed={!filtering}
            className={cn(
              "h-7 shrink-0 rounded-full border px-2.5 text-xs font-medium",
              !filtering
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border text-fg-muted hover:bg-surface-raised",
            )}
          >
            Everyone
          </button>
          {speakers.map((speaker, index) => {
            const on = speakerFilter.has(speaker.code);
            return (
              <button
                key={speaker.code}
                type="button"
                onClick={() => toggleSpeaker(speaker.code)}
                aria-pressed={on}
                style={speakerStyle(index)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-xs font-medium",
                  on
                    ? "border-(--speaker) bg-surface text-fg"
                    : "border-border text-fg-muted hover:bg-surface-raised",
                )}
              >
                <SpeakerMark label={speaker.label} />
                {speaker.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onKeyDown={(event) => {
          if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
            stopFollowing();
        }}
        onPointerUp={onPointerUp}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4"
      >
        {turns.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-fg-muted">
            No speech was transcribed in this meeting.
          </p>
        ) : (
          <ol className="flex flex-col">
            {turns.map((turn, index) => {
              if (filtering && !speakerFilter.has(turn.speaker)) return null;
              const previous = turns[index - 1];
              return (
                <TurnRow
                  key={turn.id}
                  turn={turn}
                  index={index}
                  speakerIdx={speakerIndex.get(turn.speaker) ?? 0}
                  label={labelOf(turn.speaker)}
                  showSpeaker={filtering || !previous || previous.speaker !== turn.speaker}
                  isCurrent={index === currentIndex}
                  query={matchSet.has(index) ? query : ""}
                  isActiveMatch={matches[activeMatch] === index}
                  onSeek={onSeek}
                />
              );
            })}
          </ol>
        )}
        {!readOnly && selection && (
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={highlightSelection}
            className="absolute z-10 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-md bg-fg px-3 text-sm font-medium text-canvas shadow-raised"
            style={{ top: Math.max(0, selection.top), left: selection.left }}
          >
            <Highlighter className="size-4" aria-hidden />
            Highlight selection
          </button>
        )}
      </div>

      {!following && currentIndex >= 0 && (
        <div className="pointer-events-none relative">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setFollowing(true);
              scrollToIndex(currentIndex);
            }}
            className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 shadow-raised"
          >
            <ArrowDownToLine className="size-4" aria-hidden />
            Back to now
          </Button>
        </div>
      )}
    </section>
  );
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TurnRow = memo(function TurnRow({
  turn,
  index,
  speakerIdx,
  label,
  showSpeaker,
  isCurrent,
  query,
  isActiveMatch,
  onSeek,
}: {
  turn: TranscriptTurn;
  index: number;
  speakerIdx: number;
  label: string;
  showSpeaker: boolean;
  isCurrent: boolean;
  query: string;
  isActiveMatch: boolean;
  onSeek: (sec: number) => void;
}) {
  const parts = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [turn.text];
    return turn.text.split(new RegExp(`(${escapeRegExp(needle)})`, "gi"));
  }, [turn.text, query]);

  return (
    <li
      data-index={index}
      style={{
        ...speakerStyle(speakerIdx),
        contentVisibility: "auto",
        containIntrinsicSize: "auto 3.5rem",
      }}
      aria-current={isCurrent ? "true" : undefined}
      onClick={() => {
        if (window.getSelection()?.isCollapsed !== false) onSeek(turn.startSec);
      }}
      className={cn(
        "group relative cursor-pointer rounded-md border-l-[3px] py-1.5 pr-2 pl-3 transition-colors",
        showSpeaker && "mt-2",
        isCurrent ? "border-now-strong bg-now" : "border-transparent hover:bg-surface-raised",
        isActiveMatch && !isCurrent && "ring-2 ring-match",
      )}
    >
      {showSpeaker && (
        <div className="mb-0.5 flex items-center gap-2">
          <SpeakerMark label={label} />
          <span className="text-sm font-semibold text-fg">{label}</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSeek(turn.startSec);
          }}
          aria-label={`Play from ${formatTime(turn.startSec)}, ${label}`}
          className={cn(
            "mt-0.5 w-12 shrink-0 text-left text-xs tabular-nums group-hover:text-accent-strong",
            isCurrent ? "text-fg-muted" : "text-fg-subtle",
          )}
        >
          {formatTime(turn.startSec)}
        </button>
        <p className="min-w-0 flex-1 text-[0.95rem] leading-relaxed text-fg">
          {parts.map((part, i) =>
            i % 2 === 1 ? (
              <mark key={i} className="rounded-[3px] bg-match px-0.5 text-fg">
                {part}
              </mark>
            ) : (
              part
            ),
          )}
        </p>
      </div>
    </li>
  );
});
