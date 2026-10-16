import { SUMMARY_TEMPLATES, type SummaryTemplate } from "./templates.ts";

/**
 * A summary as the page shows it: the templates the meeting has, the one chosen (or the
 * first), and its points grouped under their section headings in order. Shared by the
 * notes panel and the shared meeting page. No I/O here.
 */
export type SummaryPoint = {
  id: string;
  kind: string;
  templateKey: string | null;
  sectionIdx: number | null;
  section: string | null;
  text: string;
  turnIds: string[];
};

export type SummarySection<T extends SummaryPoint> = { heading: string; points: T[] };

export function summaryFor<T extends SummaryPoint>(
  items: ReadonlyArray<T>,
  template: string | null,
): {
  available: SummaryTemplate[];
  current: SummaryTemplate | undefined;
  sections: SummarySection<T>[];
  notes: T[];
} {
  const points = items.filter((item) => item.kind === "point");
  const notes = items.filter((item) => item.kind === "note");
  const available = SUMMARY_TEMPLATES.filter((definition) =>
    points.some((point) => point.templateKey === definition.key),
  );
  const current = available.find((definition) => definition.key === template) ?? available[0];
  const bySection = new Map<number, SummarySection<T>>();
  for (const point of points) {
    if (point.templateKey !== current?.key) continue;
    const index = point.sectionIdx ?? 0;
    const entry = bySection.get(index) ?? { heading: point.section ?? "", points: [] };
    entry.points.push(point);
    bySection.set(index, entry);
  }
  const sections = [...bySection.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  return { available, current, sections, notes };
}
