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
