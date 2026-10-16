import type { Analysis, Summaries } from "./ai-output-schema.ts";
import { SUMMARY_TEMPLATES } from "./templates.ts";

/**
 * Grounding checks (NFRs AI grounding, No invented owners or dates). Run on every model
 * output before it is stored. Nothing here trusts the model:
 *   - a citation must name a turn of this meeting; items left with none are dropped
 *   - an owner must be a speaker of this meeting, or a name said in a cited turn
 *   - a due date must be words said in a cited turn
 *   - chapters must start at real turns, in meeting order
 *   - summary points must belong to a known template and section
 * Every change is listed in the report so the job runner can record what was dropped. Report
 * lines name positions, never content, so they are safe to store and log.
 */
export type TranscriptForGrounding = {
  speakers: ReadonlyArray<{ code: string; label: string }>;
  turns: ReadonlyArray<{ id: string; text: string }>;
};

/** The payload apply_analysis() stores: owners are speaker codes, not labels. */
export type AnalysisPayload = Omit<Analysis, "actions"> & {
  actions: Array<{
    text: string;
    ownerSpeaker: string | null;
    ownerName: string | null;
    dueText: string | null;
    turnIds: string[];
  }>;
};

export type GroundingReport = { dropped: string[]; cleared: string[] };

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function saidIn(phrase: string, texts: string[]): boolean {
  const needle = normalise(phrase);
  return needle.length > 0 && texts.some((text) => ` ${normalise(text)} `.includes(` ${needle} `));
}

function indexTurns(transcript: TranscriptForGrounding) {
  const order = new Map<string, number>();
  const textById = new Map<string, string>();
  transcript.turns.forEach((turn, index) => {
    order.set(turn.id, index);
    textById.set(turn.id, turn.text);
  });
  return { order, textById };
}

function validCitations(turnIds: readonly string[], order: Map<string, number>): string[] {
  return [...new Set(turnIds)]
    .filter((id) => order.has(id))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export function groundAnalysis(
  analysis: Analysis,
  transcript: TranscriptForGrounding,
): { payload: AnalysisPayload; report: GroundingReport } {
  const report: GroundingReport = { dropped: [], cleared: [] };
  const { order, textById } = indexTurns(transcript);
  const codeByLabel = new Map(
    transcript.speakers.map((speaker) => [normalise(speaker.label), speaker.code]),
  );
  const codes = new Set(transcript.speakers.map((speaker) => speaker.code));

  const chapterStarts = new Set<string>();
  const chapters = analysis.chapters
    .filter((chapter, index) => {
      if (!order.has(chapter.firstTurnId)) {
        report.dropped.push(`chapter ${index + 1}: starts at an unknown turn`);
        return false;
      }
      if (chapterStarts.has(chapter.firstTurnId)) return false;
      chapterStarts.add(chapter.firstTurnId);
      return true;
    })
    .sort((a, b) => (order.get(a.firstTurnId) ?? 0) - (order.get(b.firstTurnId) ?? 0));
  // Chapters cover the whole meeting: the first one starts at the first turn.
  const firstTurn = transcript.turns[0];
  if (chapters[0] && firstTurn && chapters[0].firstTurnId !== firstTurn.id) {
    chapters[0] = { ...chapters[0], firstTurnId: firstTurn.id };
  }

  const actions: AnalysisPayload["actions"] = [];
  analysis.actions.forEach((action, index) => {
    const turnIds = validCitations(action.turnIds, order);
    if (turnIds.length === 0) {
      report.dropped.push(`action ${index + 1}: cites no real turn`);
      return;
    }
    const cited = turnIds.map((id) => textById.get(id) ?? "");

    let ownerSpeaker: string | null = null;
    if (action.ownerSpeaker) {
      const code =
        codeByLabel.get(normalise(action.ownerSpeaker)) ??
        (codes.has(action.ownerSpeaker) ? action.ownerSpeaker : undefined);
      if (code) ownerSpeaker = code;
      else report.cleared.push(`action ${index + 1}: owner is not a speaker`);
    }
    let ownerName: string | null = null;
    if (!ownerSpeaker && action.ownerName) {
      if (saidIn(action.ownerName, cited)) ownerName = action.ownerName.trim();
      else report.cleared.push(`action ${index + 1}: owner name not said in its cited turns`);
    }
    let dueText: string | null = null;
    if (action.dueText) {
      if (saidIn(action.dueText, cited)) dueText = action.dueText.trim();
      else report.cleared.push(`action ${index + 1}: due date not said in its cited turns`);
    }
    actions.push({ text: action.text, ownerSpeaker, ownerName, dueText, turnIds });
  });

  const decisions: AnalysisPayload["decisions"] = [];
  analysis.decisions.forEach((decision, index) => {
    const turnIds = validCitations(decision.turnIds, order);
    if (turnIds.length === 0) {
      report.dropped.push(`decision ${index + 1}: cites no real turn`);
      return;
    }
    decisions.push({ text: decision.text, turnIds });
  });

  return {
    payload: { headline: analysis.headline, chapters, actions, decisions },
    report,
  };
}

export function groundSummaries(
  summaries: Summaries,
  transcript: TranscriptForGrounding,
): { payload: Summaries; report: GroundingReport } {
  const report: GroundingReport = { dropped: [], cleared: [] };
  const { order } = indexTurns(transcript);
  const templates: Summaries["templates"] = [];

  for (const definition of SUMMARY_TEMPLATES) {
    const generated = summaries.templates.find((template) => template.key === definition.key);
    if (!generated) {
      report.dropped.push(`template ${definition.key}: missing from the output`);
      continue;
    }
    const sections: Summaries["templates"][number]["sections"] = [];
    for (const { heading } of definition.sections) {
      const section = generated.sections.find(
        (candidate) => normalise(candidate.heading) === normalise(heading),
      );
      const points = (section?.points ?? [])
        .map((point, index) => {
          const turnIds = validCitations(point.turnIds, order);
          if (turnIds.length === 0) {
            report.dropped.push(
              `${definition.key} / ${heading} point ${index + 1}: cites no real turn`,
            );
            return null;
          }
          return { text: point.text, turnIds };
        })
        .filter((point) => point !== null)
        .slice(0, definition.pointsPerSection.max);
      if (points.length > 0) sections.push({ heading, points });
    }
    if (sections.length === 0) {
      report.dropped.push(`template ${definition.key}: no grounded points`);
      continue;
    }
    templates.push({ key: definition.key, sections });
  }
  return { payload: { templates }, report };
}
