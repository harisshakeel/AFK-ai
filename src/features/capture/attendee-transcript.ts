import type { AttendeeUtterance } from "./attendee.ts";
import { hasWakeWord } from "../commands/detect.ts";
import { clampTime, round3 } from "../../lib/time-rules.ts";

/**
 * Turns an Attendee transcript into AFK's meeting format (the same shape as the seed
 * files): speakers in order of first appearance, turns in seconds from the start of the
 * recording, ordered by (startSec, endSec), clamped to the recording's length.
 *
 * Attendee's timestamp_ms is Unix epoch milliseconds; the recording starts at
 * start_timestamp_ms. Values below 10^12 are treated as already relative (defensive: the
 * caption path is not confirmed to use epoch time).
 */
export type ConvertedTranscript = {
  /** isHost: the platform marked this person as the host (their words can be commands). */
  speakers: Array<{ code: string; label: string; isHost: boolean }>;
  turns: Array<{ id: string; speaker: string; startSec: number; endSec: number; text: string }>;
};

const EPOCH_THRESHOLD_MS = 1e12;
const MERGE_GAP_SEC = 1.5;
const MERGE_MAX_CHARS = 600;

function utteranceText(utterance: AttendeeUtterance): string {
  const raw =
    typeof utterance.transcription === "string"
      ? utterance.transcription
      : (utterance.transcription?.transcript ?? "");
  return raw.replace(/\s+/g, " ").trim();
}

type Session = {
  uuid: string;
  name: string;
  userUuid: string | null;
  isHost: boolean;
  firstStartSec: number;
  lastEndSec: number;
};

const UNNAMED = "Unknown speaker";
const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which participant sessions are the same person. Meeting platforms give each join a new
 * participant id, so someone who drops and rejoins arrives as a second participant with
 * the same name. Sessions are one person when:
 *   - the platform's account id (speaker_user_uuid) matches, when it gives one; or
 *   - without one, the display names match and the sessions never overlap: a rejoin
 *     starts after the earlier session's last words. Two people with the same name who
 *     talk back and forth stay separate. Unnamed participants are never merged.
 * Returns each session's person code: the participant id of that person's first session.
 */
function resolvePeople(sessions: ReadonlyArray<Session>): Map<string, string> {
  const personOf = new Map<string, string>();
  const byAccount = new Map<string, string>();
  const byName = new Map<string, Array<{ code: string; lastEndSec: number }>>();
  const ordered = [...sessions].sort((a, b) => a.firstStartSec - b.firstStartSec);
  for (const session of ordered) {
    if (session.userUuid) {
      const code = byAccount.get(session.userUuid) ?? session.uuid;
      byAccount.set(session.userUuid, code);
      personOf.set(session.uuid, code);
      continue;
    }
    if (session.name === UNNAMED) {
      personOf.set(session.uuid, session.uuid);
      continue;
    }
    const people = byName.get(nameKey(session.name)) ?? [];
    const earlier = people.find((person) => person.lastEndSec <= session.firstStartSec);
    if (earlier) {
      earlier.lastEndSec = Math.max(earlier.lastEndSec, session.lastEndSec);
      personOf.set(session.uuid, earlier.code);
    } else {
      people.push({ code: session.uuid, lastEndSec: session.lastEndSec });
      personOf.set(session.uuid, session.uuid);
    }
    byName.set(nameKey(session.name), people);
  }
  return personOf;
}

export function convertAttendeeTranscript(
  meetingId: string,
  utterances: ReadonlyArray<AttendeeUtterance>,
  recordingStartMs: number | null | undefined,
  durationSec: number,
): ConvertedTranscript {
  const sessions = new Map<string, Session>();
  const raw: ConvertedTranscript["turns"] = [];

  for (const utterance of utterances) {
    const text = utteranceText(utterance);
    if (!text) continue;
    const name = (utterance.speaker_name?.trim() || UNNAMED).slice(0, 80);
    const uuid = (utterance.speaker_uuid?.trim() || name).slice(0, 80);
    if (utterance.timestamp_ms >= EPOCH_THRESHOLD_MS && !recordingStartMs) {
      // Clamping would put every line at the end of the timeline and look "ready".
      throw new Error("the transcript has absolute timestamps but the recording has no start time");
    }
    const offsetMs =
      utterance.timestamp_ms >= EPOCH_THRESHOLD_MS && recordingStartMs
        ? utterance.timestamp_ms - recordingStartMs
        : utterance.timestamp_ms;
    const startSec = round3(clampTime(offsetMs / 1000, durationSec));
    const endSec = round3(
      Math.min(Math.max(startSec, startSec + utterance.duration_ms / 1000), durationSec),
    );
    const session = sessions.get(uuid);
    if (session) {
      session.firstStartSec = Math.min(session.firstStartSec, startSec);
      session.lastEndSec = Math.max(session.lastEndSec, endSec);
      session.isHost ||= utterance.speaker_is_host === true;
    } else {
      sessions.set(uuid, {
        uuid,
        name,
        userUuid: utterance.speaker_user_uuid?.trim() || null,
        isHost: utterance.speaker_is_host === true,
        firstStartSec: startSec,
        lastEndSec: endSec,
      });
    }
    raw.push({ id: "", speaker: uuid, startSec, endSec, text });
  }

  // One speaker per person, not per join. A person is the host if any of their sessions was.
  const personOf = resolvePeople([...sessions.values()]);
  const speakers = new Map<string, { name: string; isHost: boolean }>();
  for (const session of sessions.values()) {
    const code = personOf.get(session.uuid) ?? session.uuid;
    const person = speakers.get(code) ?? {
      name: sessions.get(code)?.name ?? session.name,
      isHost: false,
    };
    person.isHost ||= session.isHost;
    speakers.set(code, person);
  }
  for (const turn of raw) turn.speaker = personOf.get(turn.speaker) ?? turn.speaker;

  raw.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const merged: ConvertedTranscript["turns"] = [];
  for (const turn of raw) {
    const last = merged.at(-1);
    if (
      last &&
      last.speaker === turn.speaker &&
      turn.startSec - last.endSec <= MERGE_GAP_SEC &&
      last.text.length + turn.text.length < MERGE_MAX_CHARS &&
      // A command to AFK starts its own turn: the detector reads the wake word at the start.
      !hasWakeWord(turn.text)
    ) {
      last.endSec = Math.max(last.endSec, turn.endSec);
      last.text = `${last.text} ${turn.text}`;
    } else {
      merged.push({ ...turn });
    }
  }
  merged.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  merged.forEach((turn, index) => {
    turn.id = `${meetingId}-${String(index).padStart(4, "0")}`;
  });

  // Labels in order of first appearance; duplicate display names get a number.
  const seen = new Map<string, number>();
  const ordered = [...new Set(merged.map((turn) => turn.speaker))].map((code) => {
    const person = speakers.get(code);
    const name = person?.name ?? code;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return {
      code,
      label: count > 1 ? `${name} (${count})` : name,
      isHost: person?.isHost ?? false,
    };
  });

  return { speakers: ordered, turns: merged };
}
