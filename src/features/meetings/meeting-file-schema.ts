import { z } from "zod";

/**
 * The meeting file format produced by the import tools (data/meetings/<id>.json).
 * This is the contract between tools/ and the app: anything loaded from disk is
 * validated against it before it reaches the database.
 *
 * Units: all times are seconds from the start of the recording (`*Sec`).
 * Time rules (docs/requirements.md F0): no negative or inverted times, nothing past
 * `durationSec`, every turn by a known speaker, unique ids, turns ordered by
 * (startSec, endSec). Overlapping speech is allowed: real meetings have crosstalk.
 */
export const speakerSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});

export const turnSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    speaker: z.string().min(1).max(40),
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    text: z.string().min(1).max(4000),
  })
  .refine((turn) => turn.endSec >= turn.startSec, { message: "turn ends before it starts" });

/** A meeting id: lower-case, digits and dashes, as the seed files and the bot route mint them. */
export const MEETING_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const meetingFileSchema = z
  .object({
    id: z.string().regex(MEETING_ID),
    title: z.string().min(1).max(200),
    source: z.object({
      corpus: z.string(),
      session: z.string(),
      licence: z.string(),
      url: z.url(),
      modified: z.string(),
      notes: z.string().optional().default(""),
    }),
    recordedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    durationSec: z.number().positive(),
    speakers: z.array(speakerSchema).min(1),
    turns: z.array(turnSchema).min(1),
  })
  .superRefine((meeting, ctx) => {
    const codes = new Set<string>();
    const labels = new Set<string>();
    meeting.speakers.forEach((speaker, index) => {
      if (codes.has(speaker.code)) {
        ctx.addIssue({ code: "custom", path: ["speakers", index], message: "duplicate speaker" });
      }
      // The grounding maps an owner's label back to a code: two speakers with one label
      // would attribute every such item to the later one.
      if (labels.has(speaker.label)) {
        ctx.addIssue({
          code: "custom",
          path: ["speakers", index],
          message: "duplicate speaker label",
        });
      }
      codes.add(speaker.code);
      labels.add(speaker.label);
    });
    const ids = new Set<string>();
    meeting.turns.forEach((turn, index) => {
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["turns", index], message });
      if (!codes.has(turn.speaker)) issue("unknown speaker");
      if (ids.has(turn.id)) issue("duplicate turn id");
      ids.add(turn.id);
      if (turn.endSec > meeting.durationSec) issue("turn ends after the meeting");
      const previous = meeting.turns[index - 1];
      if (
        previous &&
        (turn.startSec < previous.startSec ||
          (turn.startSec === previous.startSec && turn.endSec < previous.endSec))
      ) {
        issue("turns are not ordered by start time");
      }
    });
  });

export type MeetingFile = z.infer<typeof meetingFileSchema>;
export type MeetingFileTurn = z.infer<typeof turnSchema>;
