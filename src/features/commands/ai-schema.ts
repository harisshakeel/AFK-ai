import { z } from "zod";

/**
 * What the job runner asks Claude for when a meeting has commands that need parsing
 * (tasks and email drafts; requirement C2). The model's output is validated against this
 * schema (sent to the API as the output format), then checked by grounding.ts against
 * the sentence and the transcript before anything is written. Decisions, notes and
 * highlights never reach the model: they are applied word for word.
 */

/**
 * The stored arguments' limits. The API takes a schema's lengths, counts and ranges only
 * as hints, and the SDK checks them after the call is paid for, so one recipient too
 * many would throw away every command of the meeting. The parse schema below therefore
 * has none of them (the hints are in the descriptions); groundCommandParse() clamps each
 * value to these before anything is stored.
 */
export const ARG_LIMITS = {
  shortText: 80,
  address: 254,
  recipients: 5,
  attendees: 10,
  title: 120,
  text: 300,
  body: 2000,
  startsAt: 40,
  minDurationMin: 15,
  maxDurationMin: 240,
} as const;

const text = (max: number, description: string) =>
  z.string().describe(`${description} Not empty; at most ${max} characters.`);
const shortText = (description: string) =>
  z.string().nullable().describe(`${description} At most ${ARG_LIMITS.shortText} characters.`);

export const commandParseSchema = z.object({
  commands: z.array(
    z.object({
      id: z.string().describe("The command's id exactly as given."),
      understood: z
        .boolean()
        .describe("False when the sentence is not a usable command of its kind."),
      task: z
        .object({
          text: text(
            ARG_LIMITS.text,
            "The task as a short imperative, keeping the speaker's own words where possible.",
          ),
          ownerSpeaker: shortText(
            "A speaker label exactly as listed, when the sentence makes them the owner; else null.",
          ),
          ownerName: shortText(
            "A person's name said in the sentence when the owner is not a listed speaker; else null.",
          ),
          dueText: shortText("The deadline words exactly as said in the sentence; else null."),
        })
        .nullable(),
      email: z
        .object({
          toNames: z
            .array(z.string())
            .describe(
              `Recipient names exactly as said in the sentence; at most ${ARG_LIMITS.recipients}.`,
            ),
          toAddresses: z
            .array(z.string())
            .describe(
              `Email addresses for those recipients, only when one was said in the transcript or the sentence, written as a normal address ('shumail at example dot com' is shumail@example.com); else empty. At most ${ARG_LIMITS.recipients}.`,
            ),
          subject: text(ARG_LIMITS.title, "The subject."),
          body: text(
            ARG_LIMITS.body,
            "A short draft in the host's voice from what the meeting said; nothing the transcript does not support.",
          ),
        })
        .nullable(),
      followup: z
        .object({
          title: text(
            ARG_LIMITS.title,
            "A short title for the event from what the sentence names, e.g. 'Follow-up: launch plan'.",
          ),
          whenText: shortText(
            "The time words exactly as said in the sentence ('next Tuesday at three'); null when no time was said.",
          ),
          startsAt: z
            .string()
            .nullable()
            .describe(
              "The ISO 8601 date-time with offset those words mean, worked out from the meeting's recorded date and the host's timezone; null when unsure.",
            ),
          durationMin: z
            .number()
            .describe(
              `The length in minutes when one was said, else 30; between ${ARG_LIMITS.minDurationMin} and ${ARG_LIMITS.maxDurationMin}.`,
            ),
          attendeeNames: z
            .array(z.string())
            .describe(
              `People named in the sentence as attendees; empty when none were named. At most ${ARG_LIMITS.attendees}.`,
            ),
        })
        .nullable(),
      remind: z
        .object({
          text: text(ARG_LIMITS.text, "What to be reminded of, in the speaker's words."),
          whenText: shortText(
            "The time words exactly as said ('tomorrow at nine'); null when none.",
          ),
          startsAt: z
            .string()
            .nullable()
            .describe(
              "The ISO 8601 date-time with offset those words mean, from the meeting's recorded date and the host's timezone; null when unsure.",
            ),
        })
        .nullable(),
    }),
  ),
});

export type CommandParse = z.infer<typeof commandParseSchema>;

/** The arguments stored on a command row, by kind. */
export const taskArgsSchema = z.object({
  text: z.string().min(1).max(300),
  ownerSpeaker: z.string().max(80).nullable(),
  ownerName: z.string().max(80).nullable(),
  dueText: z.string().max(80).nullable(),
});
export const emailArgsSchema = z.object({
  toNames: z.array(z.string().max(80)).max(5),
  /** Addresses said in the call or the sentence, grounded against the transcript; older rows have none. */
  toAddresses: z.array(z.string().max(254)).max(5).default([]),
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
});
export const followupArgsSchema = z.object({
  title: z.string().min(1).max(120),
  whenText: z.string().max(80).nullable(),
  startsAt: z.string().max(40).nullable(),
  durationMin: z.number().int().min(15).max(240),
  attendeeNames: z.array(z.string().max(80)).max(10),
});
export const remindArgsSchema = z.object({
  text: z.string().min(1).max(300),
  whenText: z.string().max(80).nullable(),
  startsAt: z.string().max(40).nullable(),
});
export const slackArgsSchema = z.object({ message: z.string().min(1).max(2000) });

export type TaskArgs = z.infer<typeof taskArgsSchema>;
export type EmailArgs = z.infer<typeof emailArgsSchema>;
export type FollowupArgs = z.infer<typeof followupArgsSchema>;
export type RemindArgs = z.infer<typeof remindArgsSchema>;
export type SlackArgs = z.infer<typeof slackArgsSchema>;
