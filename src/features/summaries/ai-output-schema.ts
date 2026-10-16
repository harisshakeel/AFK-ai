import { z } from "zod";

/**
 * What the job runner asks Claude for, and what it stores. The model's raw output is
 * validated against these schemas (sent to the API as the output format), then checked
 * against the transcript by grounding.ts before anything is written.
 *
 * Shapes match the database RPCs apply_analysis() and apply_summaries().
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const turnIds = z.array(z.string().min(1).max(100)).min(1).max(6);

export const analysisSchema = z.object({
  headline: text(300).describe("One sentence: what the meeting was about and what came of it."),
  chapters: z
    .array(
      z.object({
        title: text(120),
        firstTurnId: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(16),
  actions: z
    .array(
      z.object({
        text: text(1000),
        ownerSpeaker: z
          .string()
          .max(80)
          .nullable()
          .describe("A speaker label exactly as listed, or null."),
        ownerName: z
          .string()
          .max(80)
          .nullable()
          .describe("A name said in a cited turn when the owner is not a speaker, or null."),
        dueText: z
          .string()
          .max(80)
          .nullable()
          .describe("The deadline words exactly as said in a cited turn, or null."),
        turnIds,
      }),
    )
    .max(30),
  decisions: z.array(z.object({ text: text(1000), turnIds })).max(30),
});

export const summariesSchema = z.object({
  templates: z
    .array(
      z.object({
        key: z.string().min(1).max(30),
        sections: z
          .array(
            z.object({
              heading: text(80),
              points: z.array(z.object({ text: text(1000), turnIds })).max(8),
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .min(1)
    .max(8),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type Summaries = z.infer<typeof summariesSchema>;

/**
 * What the model may send: the shapes above without their counts and lengths, which
 * the descriptions carry as hints instead. The API takes a schema's limits only as hints
 * and the SDK checks them after the call is paid for, so one chapter too many would
 * throw a meeting's notes away; clampAnalysis() and clampSummaries() bring the output
 * inside the stored limits before grounding.
 */
const modelTurnIds = z
  .array(z.string())
  .describe("One to six turn ids exactly as listed, the most telling first.");

export const analysisModelSchema = z.object({
  headline: z
    .string()
    .describe(
      "One sentence: what the meeting was about and what came of it. At most 300 characters.",
    ),
  chapters: z
    .array(z.object({ title: z.string(), firstTurnId: z.string() }))
    .describe("One to sixteen chapters, in order."),
  actions: z
    .array(
      z.object({
        text: z.string(),
        ownerSpeaker: z.string().nullable().describe("A speaker label exactly as listed, or null."),
        ownerName: z
          .string()
          .nullable()
          .describe("A name said in a cited turn when the owner is not a speaker, or null."),
        dueText: z
          .string()
          .nullable()
          .describe("The deadline words exactly as said in a cited turn, or null."),
        turnIds: modelTurnIds,
      }),
    )
    .describe("At most thirty."),
  decisions: z
    .array(z.object({ text: z.string(), turnIds: modelTurnIds }))
    .describe("At most thirty."),
});

export const summariesModelSchema = z.object({
  templates: z
    .array(
      z.object({
        key: z.string(),
        sections: z
          .array(
            z.object({
              heading: z.string(),
              points: z
                .array(z.object({ text: z.string(), turnIds: modelTurnIds }))
                .describe("At most eight."),
            }),
          )
          .describe("One to six sections."),
      }),
    )
    .describe("One per template asked for."),
});

const clip = (value: string, max: number) => value.trim().slice(0, max).trim();
const clipIds = (ids: ReadonlyArray<string>) => ids.filter((id) => id.trim()).slice(0, 6);
const nullable = (value: string | null, max: number) =>
  value === null ? null : clip(value, max) || null;

/** The model's analysis inside the stored limits: lists cut, text clipped, empty items gone. */
export function clampAnalysis(output: z.infer<typeof analysisModelSchema>): Analysis {
  const cited = <T extends { text: string; turnIds: string[] }>(items: T[]) =>
    items.filter((item) => item.text.trim() && clipIds(item.turnIds).length > 0).slice(0, 30);
  return {
    headline: clip(output.headline, 300),
    chapters: output.chapters
      .filter((chapter) => chapter.title.trim() && chapter.firstTurnId.trim())
      .slice(0, 16)
      .map((chapter) => ({ title: clip(chapter.title, 120), firstTurnId: chapter.firstTurnId })),
    actions: cited(output.actions).map((action) => ({
      text: clip(action.text, 1000),
      ownerSpeaker: nullable(action.ownerSpeaker, 80),
      ownerName: nullable(action.ownerName, 80),
      dueText: nullable(action.dueText, 80),
      turnIds: clipIds(action.turnIds),
    })),
    decisions: cited(output.decisions).map((decision) => ({
      text: clip(decision.text, 1000),
      turnIds: clipIds(decision.turnIds),
    })),
  };
}

/** The model's summaries inside the stored limits, as clampAnalysis() does. */
export function clampSummaries(output: z.infer<typeof summariesModelSchema>): Summaries {
  return {
    templates: output.templates.slice(0, 8).map((template) => ({
      key: clip(template.key, 30),
      sections: template.sections.slice(0, 6).map((section) => ({
        heading: clip(section.heading, 80),
        points: section.points
          .filter((point) => point.text.trim() && clipIds(point.turnIds).length > 0)
          .slice(0, 8)
          .map((point) => ({ text: clip(point.text, 1000), turnIds: clipIds(point.turnIds) })),
      })),
    })),
  };
}

/**
 * data/ai/<meeting>/<kind>.json: grounded output for a seed meeting, kept in the repo so a
 * fresh database needs no Claude run. Exactly what was stored (owners are speaker codes).
 */
const generatedBase = {
  meetingId: z.string(),
  transcriptHash: z.string().regex(/^[0-9a-f]{64}$/),
  generatedAt: z.iso.datetime({ offset: true }),
  model: z.string(),
};

export const generatedOutputSchema = z.discriminatedUnion("kind", [
  z.object({ ...generatedBase, kind: z.literal("analyze"), payload: analysisSchema }),
  z.object({ ...generatedBase, kind: z.literal("summarize"), payload: summariesSchema }),
]);

export type GeneratedOutput = z.infer<typeof generatedOutputSchema>;
