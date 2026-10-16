import {
  Armchair,
  Check,
  Flame,
  Highlighter,
  ListChecks,
  Lock,
  Mic,
  Receipt,
  Timer,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time-rules";

import { Donut, MiniBars, RankedBars, WeekDots, WeeklyBars } from "./afk-charts";
import type { AfkRecord, RecordInput } from "./afk-record";

export const ICONS: Record<string, LucideIcon> = {
  "first-seat": Armchair,
  marathon: Timer,
  "magic-word": Mic,
  delegator: ListChecks,
  receipts: Receipt,
  "hands-off": Wand2,
  habit: Flame,
  highlighter: Highlighter,
};

const LEVEL_NAMES = [
  "Lurker",
  "Attendee",
  "Delegator",
  "Decision-maker",
  "Chief AFK Officer",
  "AFK Legend",
];

/** The album's uneven shape: how many of six columns each badge takes, by position. */
const BADGE_SPANS = [
  "sm:col-span-2",
  "sm:col-span-1",
  "sm:col-span-1",
  "sm:col-span-2",
  "sm:col-span-1",
  "sm:col-span-2",
  "sm:col-span-2",
  "sm:col-span-1",
];

const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
const levelNameAfter = (index: number) =>
  LEVEL_NAMES[index + 1] ?? LEVEL_NAMES[LEVEL_NAMES.length - 1]!;

const TILE = "relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-xs";
const LABEL = "font-mono text-[0.66rem] font-medium tracking-[0.14em] text-fg-subtle uppercase";

/**
 * The dashboard's record as an uneven bento: the level on a card of ink with one violet
 * glow that follows the pointer, then tiles of different sizes that each draw something
 * real from the user's own rows: twelve weeks of calls as bars, action items as a ring
 * of done against open, commands as bars, the streak as lit weeks, the longest calls
 * ranked. Under them the badges, as an album with tiles of two sizes. Every number is
 * counted (afk-record.ts); nothing is estimated.
 */
export function AfkRecordPanel({
  record,
  input,
  firstName,
}: {
  record: AfkRecord;
  input: RecordInput;
  firstName: string;
}) {
  const { level, xp } = record;
  const toNext = level.nextAt === null ? null : level.nextAt - xp;
  const percent = Math.round(level.progress * 100);
  const openActions = Math.max(0, input.actions - input.doneActions);
  return (
    <section aria-labelledby="afk-record-title" className="mt-10">
      <div className="grid gap-3 lg:grid-cols-4">
        <Reveal className="lg:col-span-2 lg:row-span-2">
          <div
            className="ink-card tilt relative flex h-full flex-col justify-between overflow-hidden rounded-2xl p-6 text-on-ink sm:p-7"
            data-tilt="4"
          >
            <div className="relative">
              <p className={cn(LABEL, "text-on-ink/65")}>Player card</p>
              <h2
                id="afk-record-title"
                className="mt-3 font-display text-3xl tracking-tight text-balance sm:text-[2.5rem]"
              >
                {firstName}, you&apos;re {article(level.name)}{" "}
                <span className="text-signal">{level.name}</span>.
              </h2>
              <p className="mt-2 max-w-md text-sm text-on-ink/75">
                {toNext === null
                  ? "Top of the ladder. There is nothing above this, which is the point."
                  : `${xp} XP. ${toNext} more and you're ${article(levelNameAfter(level.index))} ${levelNameAfter(level.index)}.`}
              </p>
            </div>
            <div className="relative mt-8">
              <div className="flex items-baseline justify-between gap-4">
                <span className={cn(LABEL, "text-on-ink/65")}>{level.name}</span>
                <span className={cn(LABEL, "text-on-ink/65")}>
                  {level.nextAt === null ? "max" : `${percent}% to ${levelNameAfter(level.index)}`}
                </span>
              </div>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-on-ink/12"
                role="progressbar"
                aria-label={`Progress through ${level.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="h-full rounded-full bg-signal shadow-glow-signal transition-[width] duration-700"
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08} className="lg:col-span-2">
          <div className={cn(TILE, "tilt h-full")} data-tilt="3">
            <div className="flex items-baseline justify-between gap-4">
              <p className={LABEL}>Twelve weeks</p>
              <p className="font-mono text-xs text-fg-muted tabular-nums">
                <CountUp value={input.meetings} /> {input.meetings === 1 ? "quest" : "quests"} ·{" "}
                {record.recordedSec > 0 ? formatDuration(record.recordedSec) : "0 min"} recorded
              </p>
            </div>
            <div className="mt-4">
              <WeeklyBars weekly={record.weekly} />
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.14}>
          <div className={cn(TILE, "tilt flex h-full items-center gap-4")} data-tilt="6">
            <Donut done={input.doneActions} total={input.actions} label="side quests" />
            <div className="min-w-0">
              <p className={LABEL}>Side quests</p>
              <p className="mt-1 font-display text-3xl tabular-nums">
                <CountUp value={openActions} />
              </p>
              <p className="text-xs text-fg-muted">
                open · <CountUp value={input.doneActions} /> done
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <Link
            href="/tasks"
            className={cn(
              TILE,
              "tilt group block h-full transition-[border-color] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none",
            )}
            data-tilt="6"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className={LABEL}>Spells</p>
              {input.awaitingApproval > 0 && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.62rem] tracking-[0.1em] text-accent-strong uppercase">
                  {input.awaitingApproval} waiting
                </span>
              )}
            </div>
            <div className="mt-4">
              <MiniBars
                rows={[
                  { label: "Spoken", value: input.spokenCommands },
                  { label: "Typed", value: input.typedCommands },
                  { label: "Cast", value: input.doneCommands },
                ]}
              />
            </div>
          </Link>
        </Reveal>

        <Reveal delay={0.26}>
          <div className={cn(TILE, "tilt h-full")} data-tilt="6">
            <p className={LABEL}>Streak</p>
            <p className="mt-1 font-display text-3xl tabular-nums">
              {record.streakWeeks} {record.streakWeeks === 1 ? "week" : "weeks"}
            </p>
            <div className="mt-4">
              <WeekDots weeks={record.recentWeeks} />
            </div>
            <p className="mt-2 text-xs text-fg-muted">The last eight weeks, this one ringed.</p>
          </div>
        </Reveal>

        <Reveal delay={0.32} className="lg:col-span-2">
          <div className={cn(TILE, "tilt h-full")} data-tilt="3">
            <div className="flex items-baseline justify-between gap-4">
              <p className={LABEL}>Longest quests</p>
              <p className="font-mono text-xs text-fg-muted tabular-nums">
                {record.recordedSec > 0
                  ? `${formatDuration(record.recordedSec)} sat through for you`
                  : "0 min sat through, so far"}
              </p>
            </div>
            <div className="mt-4">
              {record.longest.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Nothing yet. Summon AFK to a call and the longest one lands here.
                </p>
              ) : (
                <RankedBars calls={record.longest} />
              )}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.38}>
          <div className={cn(TILE, "tilt h-full")} data-tilt="6">
            <p className={LABEL}>Scoreboard</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                ["Checkpoints", input.decisions],
                ["Replays", input.highlights],
                ["Achievements", record.unlocked],
                ["XP", record.xp],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-fg-muted">{label}</dt>
                  <dd className="font-display text-2xl tabular-nums">
                    <CountUp value={Number(value)} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-6" aria-label="Achievements">
        {record.badges.map((badge, index) => {
          const Icon = ICONS[badge.id] ?? Armchair;
          const wide = BADGE_SPANS[index] === "sm:col-span-2";
          return (
            <Reveal
              key={badge.id}
              as="li"
              delay={0.1 + index * 0.05}
              className={cn(
                "group tilt relative overflow-hidden rounded-2xl p-4",
                BADGE_SPANS[index],
                badge.unlocked
                  ? "border border-transparent bg-[linear-gradient(var(--color-surface),var(--color-surface))_padding-box,linear-gradient(135deg,var(--color-accent),var(--color-signal))_border-box] shadow-raised"
                  : "border border-dashed border-border-strong bg-transparent",
              )}
            >
              <div className={cn("flex gap-3", wide ? "items-center" : "flex-col")}>
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full",
                    badge.unlocked
                      ? "coin bg-[conic-gradient(from_210deg,var(--color-accent),var(--color-signal),var(--color-accent-strong),var(--color-accent))] text-on-accent shadow-coin"
                      : "bg-surface-raised text-fg-subtle",
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-semibold tracking-tight",
                      !badge.unlocked && "text-fg-muted",
                    )}
                  >
                    <span className="truncate">{badge.name}</span>
                    {badge.unlocked ? (
                      <Check className="size-3.5 shrink-0 text-accent-strong" aria-hidden />
                    ) : (
                      <Lock className="size-3 shrink-0 text-fg-subtle" aria-hidden />
                    )}
                    <span className="sr-only">{badge.unlocked ? ", unlocked" : ", locked"}</span>
                  </p>
                  {wide && (
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{badge.how}</p>
                  )}
                  {!badge.unlocked && (
                    <p className="mt-1 font-mono text-[0.62rem] tracking-[0.12em] text-fg-subtle uppercase">
                      {badge.id === "marathon"
                        ? `${Math.floor(badge.have / 60)} min of 60 min`
                        : `${Math.min(badge.have, badge.need)} of ${badge.need}`}
                    </p>
                  )}
                </div>
              </div>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}
