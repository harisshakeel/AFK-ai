/**
 * Seed import (requirement F0). Loads data/meetings/*.json into Supabase:
 *
 *   1. validate the file (meetingFileSchema), refusing the whole meeting on any problem
 *   2. upsert the meeting row (title, date, provenance; never its status)
 *   3. ingest_transcript(): one transaction; an unchanged transcript is skipped
 *   4. upload data/audio/<id>.m4a to the private "audio" bucket under a content-hashed
 *      path, then mark the meeting ready
 *   5. load AI output exported earlier to data/ai/<id>/<kind>.json if it was generated
 *      from this exact transcript; otherwise the queued jobs run the first time the
 *      meeting is opened (the app runs them, with ANTHROPIC_API_KEY set)
 *
 * Safe to re-run: nothing is duplicated, and unchanged meetings are left alone.
 *
 * Usage: pnpm import:seed [meeting-id ...]
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (.env.local).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  generatedOutputSchema,
  type GeneratedOutput,
} from "../src/features/summaries/ai-output-schema.ts";
import { groundAnalysis, groundSummaries } from "../src/features/summaries/grounding.ts";
import { meetingFileSchema } from "../src/features/meetings/meeting-file-schema.ts";
import { createAdminClient } from "../src/lib/supabase-admin-client.ts";
import { transcriptHash } from "../src/features/meetings/transcript-hash.ts";

const DATA = join(import.meta.dirname, "..", "data");
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

const supabase = createAdminClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SECRET_KEY"),
);

async function importMeeting(id: string): Promise<string> {
  const raw = JSON.parse(readFileSync(join(DATA, "meetings", `${id}.json`), "utf8")) as unknown;
  const parsed = meetingFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`invalid meeting file: ${first.join("; ")}`);
  }
  const meeting = parsed.data;
  const notes: string[] = [];

  // The audio must exist before anything is written, or a fresh clone would be left with
  // half-imported meetings (transcribed, no audio, jobs queued).
  const audioFile = join(DATA, "audio", `${meeting.id}.m4a`);
  if (!existsSync(audioFile)) {
    throw new Error(
      `missing ${audioFile}: data/audio/ is not in the repository. data/README.md says where the corpus comes from; tools/icsi/encode_audio.sh encodes it`,
    );
  }
  const audio = readFileSync(audioFile);
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error(
      `${audioFile} is ${(audio.length / 1e6).toFixed(1)} MB; the bucket allows 50 MB`,
    );
  }

  // Exported AI output is checked against the transcript before it is trusted, with the
  // same grounding rules the job runner applies. Output made from another version of the
  // transcript is left aside (the notes are generated afresh when the meeting is opened),
  // not held against the import.
  const hash = transcriptHash(meeting);
  const exports = new Map<"analyze" | "summarize", GeneratedOutput>();
  for (const kind of ["analyze", "summarize"] as const) {
    const aiFile = join(DATA, "ai", meeting.id, `${kind}.json`);
    if (!existsSync(aiFile)) continue;
    const generated = generatedOutputSchema.parse(JSON.parse(readFileSync(aiFile, "utf8")));
    if (generated.kind !== kind) throw new Error(`${aiFile} holds ${generated.kind} output`);
    if (generated.transcriptHash !== hash) continue;
    const report =
      generated.kind === "analyze"
        ? groundAnalysis(generated.payload, meeting).report
        : groundSummaries(generated.payload, meeting).report;
    const problems = [...report.dropped, ...report.cleared];
    if (problems.length > 0) {
      throw new Error(`${aiFile} is not grounded in the transcript: ${problems.join("; ")}`);
    }
    exports.set(kind, generated);
  }

  // 2. The row. Status is only ever moved forward by the steps below.
  const { data: existing, error: readError } = await supabase
    .from("meetings")
    .select("id, status, audio_path")
    .eq("id", meeting.id)
    .maybeSingle();
  if (readError) throw readError;
  const row = {
    id: meeting.id,
    title: meeting.title,
    recorded_at: meeting.recordedAt ?? null,
    source: meeting.source,
  };
  const { error: writeError } = existing
    ? await supabase.from("meetings").update(row).eq("id", meeting.id)
    : await supabase.from("meetings").insert({ ...row, status: "transcribed" });
  if (writeError) throw writeError;

  // 3. Transcript.
  const { data: changed, error: ingestError } = await supabase.rpc("ingest_transcript", {
    p_meeting_id: meeting.id,
    p_duration_sec: meeting.durationSec,
    p_speakers: meeting.speakers,
    p_turns: meeting.turns,
    p_hash: hash,
  });
  if (ingestError) throw ingestError;
  notes.push(changed ? `${meeting.turns.length} turns loaded` : "transcript unchanged");

  // 4. Audio, under a content-addressed path so a re-encode never serves a stale file.
  const audioPath = `${meeting.id}/${createHash("sha256").update(audio).digest("hex").slice(0, 16)}.m4a`;
  if (existing?.audio_path !== audioPath) {
    const { error: uploadError } = await supabase.storage.from("audio").upload(audioPath, audio, {
      contentType: "audio/mp4",
      upsert: true,
      cacheControl: "31536000",
    });
    if (uploadError) throw uploadError;
    notes.push(`audio uploaded (${(audio.length / 1e6).toFixed(1)} MB)`);
  }
  const { error: readyError } = await supabase
    .from("meetings")
    .update({ audio_path: audioPath, status: "ready", status_detail: null })
    .eq("id", meeting.id);
  if (readyError) throw readyError;
  if (existing?.audio_path && existing.audio_path !== audioPath) {
    const { error: removeError } = await supabase.storage
      .from("audio")
      .remove([existing.audio_path]);
    if (removeError)
      notes.push(`old audio not removed (${existing.audio_path}): ${removeError.message}`);
  }

  // 5. AI output generated earlier from this exact transcript. The database loads it only
  //    while a job is waiting for it, so a re-run never replaces items (and so never
  //    loses visitors' ticks on them).
  for (const kind of ["analyze", "summarize"] as const) {
    const generated = exports.get(kind);
    if (!generated) {
      notes.push(`no ${kind} output in data/ai yet (generated when the meeting is first opened)`);
      continue;
    }
    if (generated.transcriptHash !== hash) {
      notes.push(
        `data/ai ${kind} output is for another transcript (regenerated when the meeting is first opened)`,
      );
      continue;
    }
    const { data: applied, error } = await supabase.rpc("import_generated", {
      p_meeting_id: meeting.id,
      p_transcript_hash: hash,
      p_kind: kind,
      p_payload: generated.payload,
    });
    if (error) throw error;
    notes.push(applied ? `${kind} output loaded from data/ai` : `${kind} output already in place`);
  }
  return notes.join(", ");
}

const requested = process.argv.slice(2);
const ids =
  requested.length > 0
    ? requested
    : readdirSync(join(DATA, "meetings"))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.replace(/\.json$/, ""));

let failed = 0;
for (const id of ids) {
  try {
    console.log(`${id}: ${await importMeeting(id)}`);
  } catch (error) {
    failed++;
    console.error(`${id}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`${ids.length - failed}/${ids.length} meetings imported`);
process.exitCode = failed > 0 ? 1 : 0;
