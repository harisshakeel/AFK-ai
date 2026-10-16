import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time-rules";

import type { Call, WeekPoint } from "./afk-record";

/**
 * The dashboard's charts, drawn as SVG on the server from the user's own rows: no
 * library, no script, each with a sentence for assistive tech. Violet is the data
 * colour; `signal` marks the current week and what is done.
 */
const shortWeek = (week: string) => `W${week.split("-W")[1]}`;

/** Twelve weeks of recorded minutes, the current week in the signal colour. */
export function WeeklyBars({ weekly }: { weekly: WeekPoint[] }) {
  const max = Math.max(60, ...weekly.map((point) => point.sec));
  const width = 240;
  const height = 72;
  const gap = 6;
  const bar = (width - gap * (weekly.length - 1)) / weekly.length;
  const total = weekly.reduce((sum, point) => sum + point.calls, 0);
  const summary =
    total === 0
      ? "No quests in the last twelve weeks."
      : `${total} quests in the last twelve weeks: ${weekly
          .filter((point) => point.calls > 0)
          .map((point) => `${shortWeek(point.week)} ${formatDuration(point.sec)}`)
          .join(", ")}.`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 14}`}
      className="h-auto w-full"
      role="img"
      aria-label={summary}
    >
      {weekly.map((point, index) => {
        const x = index * (bar + gap);
        const h = point.sec === 0 ? 2 : Math.max(4, (point.sec / max) * height);
        return (
          <g key={point.week}>
            <rect
              x={x}
              y={height - h}
              width={bar}
              height={h}
              rx={2}
              className={cn(
                point.sec === 0
                  ? "fill-border-strong/60"
                  : point.current
                    ? "fill-signal"
                    : "fill-accent/80",
              )}
            >
              {/* One string: React 19 hydrates a title with several text pieces differently. */}
              <title>{`${shortWeek(point.week)}: ${point.calls} quests, ${formatDuration(point.sec)}`}</title>
            </rect>
            {(index === 0 || index === weekly.length - 1) && (
              <text
                x={x + bar / 2}
                y={height + 11}
                textAnchor="middle"
                className="fill-fg-subtle font-mono text-[7px] tracking-[0.08em]"
              >
                {shortWeek(point.week)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A ring of done against open, with the share done in the middle. */
export function Donut({
  done,
  total,
  label,
  className = "size-24",
}: {
  done: number;
  total: number;
  label: string;
  className?: string;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const share = total === 0 ? 0 : done / total;
  const percent = Math.round(share * 100);
  return (
    <svg
      viewBox="0 0 88 88"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={
        total === 0 ? `No ${label} yet.` : `${done} of ${total} ${label} done, ${percent} percent.`
      }
    >
      <circle
        cx="44"
        cy="44"
        r={radius}
        className="fill-none stroke-border-strong/50"
        strokeWidth="8"
      />
      {total > 0 && (
        <circle
          cx="44"
          cy="44"
          r={radius}
          className="fill-none stroke-signal transition-[stroke-dasharray] duration-700"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform="rotate(-90 44 44)"
        />
      )}
      <text
        x="44"
        y="44"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-fg font-display text-[22px]"
      >
        {total === 0 ? "—" : `${percent}%`}
      </text>
    </svg>
  );
}

/** Three horizontal bars with their counts, relative to the biggest. */
export function MiniBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <dl
      className="flex flex-col gap-2.5"
      aria-label={rows.map((row) => `${row.label} ${row.value}`).join(", ")}
    >
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3">
          <dt className="truncate font-mono text-[0.62rem] tracking-[0.1em] text-fg-subtle uppercase">
            {row.label}
          </dt>
          <dd className="h-2 overflow-hidden rounded-full bg-border-strong/40" aria-hidden>
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${Math.max(row.value === 0 ? 0 : 6, (row.value / max) * 100)}%` }}
            />
          </dd>
          <dd className="text-right font-mono text-xs tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Eight dots for the last eight weeks, lit where there was a call. */
export function WeekDots({ weeks }: { weeks: boolean[] }) {
  const lit = weeks.filter(Boolean).length;
  return (
    <div
      className="flex items-center gap-1.5"
      role="img"
      aria-label={`${lit} of the last ${weeks.length} weeks had a call.`}
    >
      {weeks.map((on, index) => (
        <span
          key={index}
          className={cn(
            "size-2.5 rounded-full",
            on ? "bg-signal shadow-glow-signal" : "bg-border-strong/60",
            index === weeks.length - 1 && "ring-2 ring-fg/20",
          )}
        />
      ))}
    </div>
  );
}

/** The longest calls as proportional bars, each a link to its meeting. */
export function RankedBars({ calls }: { calls: Call[] }) {
  const max = Math.max(1, ...calls.map((call) => call.sec));
  return (
    <ol className="flex flex-col gap-2.5">
      {calls.map((call) => (
        <li key={call.id}>
          <a href={`/meetings/${call.id}`} className="group block">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium group-hover:text-accent-strong">
                {call.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
                {formatDuration(call.sec)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border-strong/40">
              <div
                className="h-full rounded-full bg-accent/80"
                style={{ width: `${Math.max(4, (call.sec / max) * 100)}%` }}
              />
            </div>
          </a>
        </li>
      ))}
    </ol>
  );
}
