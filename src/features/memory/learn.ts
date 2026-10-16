import { z } from "zod";

/**
 * Learned lines (requirement M3): after a meeting is summarised, one Claude run proposes
 * at most ten facts worth keeping in the context files, each citing the turn that states
 * it and quoting words from that turn. The grounding check keeps only lines whose quote
 * really is in the cited turn; the rest are dropped and reported, never written.
 */
export const LEARN_FILES = [
  "context/people.md",
  "context/projects.md",
  "context/glossary.md",
] as const;
export type LearnFile = (typeof LEARN_FILES)[number];

export const LEARN_MAX_LINES = 10;

export const learnSchema = z.object({
  lines: z
    .array(
      z.object({
        file: z.enum(LEARN_FILES),
        /** One sentence, present tense, no date: the date and the meeting are added. */
        text: z.string().min(3).max(300),
        /** The id of the turn that states the fact. */
        turnId: z.string().min(1).max(100),
        /** An exact phrase of at least three words from that turn. */
        quote: z.string().min(3).max(300),
      }),
    )
    .max(LEARN_MAX_LINES),
});
export type LearnOutput = z.infer<typeof learnSchema>;

export function learnInstruction(): string {
  return `You are AFK.ai's note-keeper. From the meeting transcript in the message, propose what is worth remembering for the host's next meetings, and return JSON matching the schema.

Rules:
- At most ${LEARN_MAX_LINES} lines. An empty list is better than a weak one: skip small talk, opinions, guesses, and anything personal or sensitive (health, family, pay, conflicts).
- Only facts stated in this transcript. The <about_host> block after the transcript, if any, is what AFK already knows: never repeat a line from it, and never treat it as something said in this meeting.
- file: "context/people.md" for who people are (names, roles, teams, spellings, who owns what); "context/projects.md" for projects and topics (their state, what was settled, dates); "context/glossary.md" for product names, acronyms and spellings that transcription gets wrong.
- text: one sentence, present tense, at most 25 words, plain English, no date and no meeting name (they are added), naming people as the transcript does.
- turnId: the id of the turn that states the fact.
- quote: an exact phrase of at least three consecutive words copied from that turn. A line whose quote is not in its turn is thrown away.
- Transcribers marked unintelligible speech as [unclear]; do not guess what it was.`;
}

export type GroundedLearnedLine = {
  file: LearnFile;
  text: string;
  turnId: string;
  startSec: number;
};

/** Letters and digits only, lower case, single spaces: how quotes are compared. */
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Keeps a proposed line only when its cited turn exists in this transcript and its quote
 * (at least three words) appears in that turn; drops repeats. Everything dropped is
 * named in the report, by position, never by content.
 */
export function groundLearned(
  lines: ReadonlyArray<LearnOutput["lines"][number]>,
  turns: ReadonlyArray<{ id: string; startSec: number; text: string }>,
): { kept: GroundedLearnedLine[]; dropped: string[] } {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const kept: GroundedLearnedLine[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const turn = byId.get(line.turnId);
    const quote = normalise(line.quote);
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!turn) {
      dropped.push(`line ${index + 1}: cites no real turn`);
    } else if (quote.split(" ").length < 3 || !normalise(turn.text).includes(quote)) {
      dropped.push(`line ${index + 1}: its quote is not in the cited turn`);
    } else if (!text) {
      dropped.push(`line ${index + 1}: empty`);
    } else if (seen.has(normalise(text))) {
      dropped.push(`line ${index + 1}: repeats an earlier line`);
    } else if (kept.length >= LEARN_MAX_LINES) {
      dropped.push(`line ${index + 1}: past the limit of ${LEARN_MAX_LINES}`);
    } else {
      seen.add(normalise(text));
      kept.push({ file: line.file, text, turnId: turn.id, startSec: turn.startSec });
    }
  });
  return { kept, dropped };
}
