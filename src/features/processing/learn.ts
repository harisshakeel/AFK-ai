import { contextTemplate, learnedLine } from "../memory/files.ts";
import { groundLearned, learnInstruction, learnSchema, type LearnFile } from "../memory/learn.ts";
import type { Json } from "../../lib/database.types.ts";
import type { ProcessingDeps } from "./config.ts";
import {
  type Job,
  type JobResult,
  loadMeeting,
  loadTranscript,
  runReport,
  transcriptPrompt,
} from "./jobs.ts";
import { loadMemory } from "./memory.ts";

/**
 * learn (requirement M3): the chain's last link for a Google user's meeting (the
 * database queues none for a guest). One Claude call proposes at most ten learned lines
 * for the context files; each must cite a turn and quote it, or it is dropped and
 * reported. What survives is written by apply_learned() through append_memory_lines(),
 * under "Learned by AFK", never above the user's rule.
 */
export async function runLearn(
  deps: ProcessingDeps,
  job: Job,
  options: { timeoutMs?: number } = {},
): Promise<JobResult | null> {
  const { db, claude } = deps;
  const meeting = await loadMeeting(db, job.meeting_id);
  if (!meeting || !meeting.owner_id || meeting.transcript_hash === null) return null;
  const transcript = await loadTranscript(db, meeting.id);
  if (transcript.turns.length === 0) {
    return { payload: { files: [] }, report: { turns: 0, note: "nothing was said" } };
  }

  const memory = await loadMemory(db, meeting.owner_id);
  const { data, run } = await claude.runStructured({
    name: "learn",
    data: transcriptPrompt(meeting, transcript),
    extra: memory.block,
    instruction: learnInstruction(),
    schema: learnSchema,
    timeoutMs: options.timeoutMs,
  });
  const { kept, dropped } = groundLearned(data.lines, transcript.turns);

  const date = (meeting.recorded_at ?? new Date().toISOString()).slice(0, 10);
  const byFile = new Map<LearnFile, string[]>();
  for (const line of kept) {
    const lines = byFile.get(line.file) ?? [];
    lines.push(learnedLine(date, line.text, meeting.title, line.startSec));
    byFile.set(line.file, lines);
  }
  const files = [...byFile.entries()].map(([path, lines]) => ({
    path,
    lines,
    template: contextTemplate(path),
  }));
  return {
    payload: { files } as unknown as Json,
    report: {
      ...runReport(run),
      turns: transcript.turns.length,
      proposed: data.lines.length,
      kept: kept.length,
      dropped,
    },
  };
}
