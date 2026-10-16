import { Armchair, ArrowRight } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/cn";

import { Donut, WeekDots, WeeklyBars } from "./afk-charts";
import { type AfkRecord, LEVELS, type RecordInput } from "./afk-record";
import { ICONS } from "./afk-record-panel";

const LABEL = "font-mono text-[0.62rem] font-medium tracking-[0.14em] text-fg-subtle uppercase";
const TILE = "rounded-2xl border border-border bg-surface p-4 shadow-xs";

/**
 * The player card beside the quest log: the level and the progress to the next on a card
 * of ink, twelve weeks of quests, the side quests as a ring, the streak as lit weeks, the
 * achievements as a row of coins, and the way to the full card (/dashboard/record). It
 * is sized to sit beside the list within the viewport, so the dashboard never scrolls as
 * a page. Every number is counted (afk-record.ts); nothing is estimated.
 */
export function AfkPlayerCard({ record, input }: { record: AfkRecord; input: RecordInput }) {
  const { level, xp } = record;
  const next = LEVELS[level.index + 1]?.name ?? null;
  const toNext = level.nextAt === null ? null : level.nextAt - xp;
  const percent = Math.round(level.progress * 100);
  const openActions = Math.max(0, input.actions - input.doneActions);
  return (
    <aside aria-label="Player card" className="flex flex-col gap-3">
      <Reveal>
        <div className="ink-card relative overflow-hidden rounded-2xl p-5 text-on-ink">
          <div className="relative flex items-baseline justify-between gap-3">
            <p className={cn(LABEL, "text-on-ink/65")}>Level</p>
            <p className="font-mono text-[0.68rem] text-on-ink/65 tabular-nums">{xp} XP</p>
          </div>
          <p className="relative mt-1 font-display text-2xl tracking-tight text-signal">
            {level.name}
          </p>
          <div
            className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-on-ink/12"
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
          <p className="relative mt-2 text-xs text-on-ink/75">
            {toNext === null || next === null ? "Top of the ladder." : `${toNext} XP to ${next}.`}
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.06} className={TILE}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={LABEL}>Twelve weeks</p>
          <p className="font-mono text-[0.68rem] text-fg-muted tabular-nums">
            {input.meetings} {input.meetings === 1 ? "quest" : "quests"}
          </p>
        </div>
        <div className="mx-auto mt-2 max-w-56">
          <WeeklyBars weekly={record.weekly} />
        </div>
      </Reveal>

      <div className="grid grid-cols-2 gap-3">
        <Reveal delay={0.1} className={cn(TILE, "flex items-center gap-3")}>
          <Donut
            done={input.doneActions}
            total={input.actions}
            label="side quests"
            className="size-11"
          />
          <div className="min-w-0">
            <p className={LABEL}>Side quests</p>
            <p className="font-display text-xl tabular-nums">{openActions}</p>
            <p className="text-[0.7rem] text-fg-muted">open</p>
            <p className="text-[0.7rem] text-fg-muted">{input.doneActions} done</p>
          </div>
        </Reveal>
        <Reveal delay={0.14} className={TILE}>
          <p className={LABEL}>Streak</p>
          <p className="mt-1 font-display text-xl tabular-nums">
            {record.streakWeeks === 0
              ? "No streak yet"
              : `${record.streakWeeks} ${record.streakWeeks === 1 ? "week" : "weeks"}`}
          </p>
          <div className="mt-2">
            <WeekDots weeks={record.recentWeeks} />
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.18} className={cn(TILE, "flex items-center gap-3")}>
        <ul className="flex flex-1 flex-wrap gap-1.5" aria-label="Achievements">
          {record.badges.map((badge) => {
            const Icon = ICONS[badge.id] ?? Armchair;
            return (
              <li
                key={badge.id}
                title={`${badge.name}${badge.unlocked ? "" : ", locked"}`}
                className={cn(
                  "grid size-8 place-items-center rounded-full",
                  badge.unlocked
                    ? "coin bg-[conic-gradient(from_210deg,var(--color-accent),var(--color-signal),var(--color-accent-strong),var(--color-accent))] text-on-accent shadow-coin"
                    : "bg-surface-raised text-fg-subtle",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                <span className="sr-only">
                  {badge.name}
                  {badge.unlocked ? ", unlocked" : ", locked"}
                </span>
              </li>
            );
          })}
        </ul>
        <Link href="/dashboard/record" className={buttonClass("secondary", "sm", "shrink-0")}>
          Player card
          <ArrowRight aria-hidden />
        </Link>
      </Reveal>
    </aside>
  );
}
