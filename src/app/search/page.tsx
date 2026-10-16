import { FileText, ListChecks, MessageSquareText, Scale, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Chrome } from "@/components/chrome";
import { SendBotLink } from "@/components/site-header";
import { Eyebrow } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { formatMeetingDate } from "@/lib/format-date";
import { pickHits } from "@/features/search/pick-hits";
import { SEARCH_LIMIT, searchMeetings, type SearchHit } from "@/features/search/search-queries";
import { formatTime } from "@/lib/time-rules";
import { getViewer } from "@/server/auth/viewer";

/** Search across meetings (requirement F8). The query lives in the URL (?q=). */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = readQuery(await searchParams);
  // Result pages are per query and per viewer: nothing for a crawler to keep.
  return { title: q ? `Search: ${q}` : "Search", robots: { index: false, follow: false } };
}

const SUGGESTIONS = ["seat number", "close-talking microphones", "overlap", "digits"];
const HITS_PER_MEETING = 5;

function readQuery(params: Record<string, string | string[] | undefined>) {
  const value = Array.isArray(params.q) ? params.q[0] : params.q;
  return (value ?? "").trim().slice(0, 200);
}

export default async function SearchPage({ searchParams }: Props) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()]);
  const q = readQuery(params);
  // Signed in, you search your own meetings, as the list shows only those.
  const ownOnly = Boolean(viewer.userId && !viewer.isGuest);
  const groups = q ? await searchMeetings(q, { ownOnly }) : [];
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0);
  // The RPC stops at SEARCH_LIMIT hits, so that number is a floor, not a count.
  const totalLabel = total >= SEARCH_LIMIT ? `${SEARCH_LIMIT}+` : String(total);

  return (
    <Chrome query={q} actions={<SendBotLink />} width="narrow">
      <>
        {!q ? (
          <Prompt />
        ) : groups.length === 0 ? (
          <NoResults query={q} />
        ) : (
          <>
            <Eyebrow>Search</Eyebrow>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {totalLabel} {total === 1 ? "match" : "matches"} for &ldquo;{q}&rdquo;
            </h1>
            <p className="mt-1.5 text-sm text-fg-muted">
              in {groups.length} {groups.length === 1 ? "meeting" : "meetings"}; each result opens
              at the moment it was said.
            </p>
            <ol className="mt-8 flex flex-col gap-5">
              {groups.map((group) => {
                // The best hits of each kind (the RPC ranks them), shown in meeting order.
                const hits = pickHits(group.hits, HITS_PER_MEETING).sort(
                  (a, b) => (a.startSec ?? -1) - (b.startSec ?? -1),
                );
                const more = group.hits.length - hits.length;
                const meetingHref = `/meetings/${group.meetingId}?q=${encodeURIComponent(q)}`;
                return (
                  <li key={group.meetingId} className={cardClass({ extra: "p-4 sm:p-5" })}>
                    <h2 className="text-[1.05rem] font-semibold tracking-tight">
                      <Link href={meetingHref} className="hover:text-accent-strong">
                        {group.title}
                      </Link>
                    </h2>
                    {group.recordedAt && (
                      <p className="mt-0.5 font-mono text-[0.72rem] text-fg-muted">
                        {formatMeetingDate(group.recordedAt)}
                      </p>
                    )}
                    <ul className="mt-3 flex flex-col gap-0.5">
                      {hits.map((hit) => (
                        <li key={`${hit.kind}:${hit.refId}`}>
                          <HitLink hit={hit} meetingId={group.meetingId} query={q} />
                        </li>
                      ))}
                    </ul>
                    {more > 0 && (
                      <Link
                        href={meetingHref}
                        className="mt-2 inline-block text-sm font-medium text-accent-strong hover:underline"
                      >
                        {more} more {more === 1 ? "match" : "matches"} in this meeting
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </>
    </Chrome>
  );
}

const KIND: Record<SearchHit["kind"], { label: string; Icon: typeof FileText; tab?: string }> = {
  turn: { label: "Transcript", Icon: MessageSquareText },
  point: { label: "Summary", Icon: FileText, tab: "summary" },
  action: { label: "Action item", Icon: ListChecks, tab: "actions" },
  decision: { label: "Decision", Icon: Scale, tab: "decisions" },
  note: { label: "Note from the call", Icon: FileText, tab: "summary" },
  title: { label: "Title", Icon: FileText },
};

function HitLink({ hit, meetingId, query }: { hit: SearchHit; meetingId: string; query: string }) {
  const { label, Icon, tab } = KIND[hit.kind];
  const params = new URLSearchParams({ q: query });
  // The exact start: a floored value would open on the line before the match.
  if (hit.startSec !== null) params.set("t", String(hit.startSec));
  if (tab) params.set("tab", tab);
  return (
    <Link
      href={`/meetings/${meetingId}?${params.toString()}`}
      className="flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-raised"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span className="font-medium">
            {hit.kind === "turn" ? (hit.speakerLabel ?? label) : label}
          </span>
          {hit.startSec !== null && (
            <span className="font-mono text-[0.7rem] text-accent-strong tabular-nums">
              {formatTime(hit.startSec)}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[0.95rem] leading-relaxed">
          <Snippet text={hit.snippet} />
        </span>
      </span>
    </Link>
  );
}

/** Postgres marks matches with ⟦ ⟧; render them as <mark>, as text, never as HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/⟦|⟧/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-[3px] bg-match px-0.5 text-fg">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function Prompt() {
  return (
    <div>
      <Eyebrow>Search</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Search every meeting
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Find where something was said, decided or assigned. Results open at the moment.
      </p>
      <Suggestions />
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong p-8 text-center">
      <SearchX className="mx-auto size-8 text-fg-subtle" aria-hidden />
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
        Nothing matched &ldquo;{query}&rdquo;
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Try fewer or different words; search matches word forms, so &ldquo;decide&rdquo; also finds
        &ldquo;decided&rdquo;. Or{" "}
        <Link href="/samples" className="font-medium text-accent-strong underline">
          browse the meetings
        </Link>
        .
      </p>
      <Suggestions />
    </div>
  );
}

function Suggestions() {
  return (
    <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm sm:justify-start">
      <span className="text-fg-muted">Try</span>
      {SUGGESTIONS.map((suggestion) => (
        <Link
          key={suggestion}
          href={`/search?q=${encodeURIComponent(suggestion)}`}
          className="rounded-full border border-border bg-surface px-3 py-1 shadow-xs transition-colors hover:border-accent hover:text-accent-strong"
        >
          {suggestion}
        </Link>
      ))}
    </p>
  );
}
