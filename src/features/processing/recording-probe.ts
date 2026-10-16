import { mp3DurationSec } from "./mp3-duration.ts";
import { type ByteSource, isMp4, mp4DurationSec } from "./mp4-duration.ts";

/**
 * A bot recording's size and length without downloading it. The file stays at Attendee,
 * where the page plays it from, and a Vercel function has neither the memory for an
 * hour of video nor the time to fetch it. The first 64 KB come by one range request,
 * which Attendee's storage honours; an MP4's length is then read by walking its boxes
 * (two or three more small ranges when `moov` follows the media), an MP3's from its
 * first frames. `durationSec` is null for a file of neither kind, one whose header is
 * unreadable, or one whose server ignores ranges past the first; the caller then falls
 * back to the transcript. Only the first request's failure throws.
 */
export const PROBE_WINDOW_BYTES = 64 * 1024;

/**
 * The first request failed with an answer from the server. `permanent` when no retry
 * will change it: a refusal (403, 404, 410) or a file whose size the server will not
 * say. An outage, a timeout of the server's own (408) or a rate limit (429) may mend.
 * A request that got no answer at all (a lost connection, our own timeout) throws
 * fetch's own error instead.
 */
export class RecordingReadError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "RecordingReadError";
    this.permanent = permanent;
  }
}

export type RecordingProbe = {
  bytes: number;
  durationSec: number | null;
  lengthFrom: "mp4" | "mp3" | null;
};

export async function probeRecording(
  url: string,
  { fetchImpl = fetch, signal }: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RecordingProbe> {
  const head = await readRange(url, 0, PROBE_WINDOW_BYTES, fetchImpl, signal);
  const source: ByteSource = {
    size: head.total,
    read: async (start, length) => {
      const end = Math.min(start + length, head.total);
      if (end <= head.bytes.length) return head.bytes.subarray(start, end);
      if (!head.ranged) throw new Error("the recording's server ignores range requests");
      return (await readRange(url, start, end, fetchImpl, signal)).bytes;
    },
  };
  if (isMp4(head.bytes)) {
    const durationSec = await mp4DurationSec(source).catch(() => null);
    return { bytes: head.total, durationSec, lengthFrom: durationSec === null ? null : "mp4" };
  }
  const durationSec = mp3DurationSec(head.bytes, head.total);
  return { bytes: head.total, durationSec, lengthFrom: durationSec === null ? null : "mp3" };
}

/** Bytes [start, end) of the file and the file's size, by one range request. */
async function readRange(
  url: string,
  start: number,
  end: number,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<{ bytes: Uint8Array; total: number; ranged: boolean }> {
  const response = await fetchImpl(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
    signal,
  });
  if (!response.ok) {
    const { status } = response;
    const mends = status >= 500 || status === 408 || status === 429;
    throw new RecordingReadError(`recording read failed (${status})`, !mends);
  }
  // 206 carries the range asked for and "bytes 0-65535/<size>"; a server that ignores
  // the header answers 200 with the whole file, of which only the window is read.
  const ranged = response.status === 206;
  const total = Number(
    ranged
      ? response.headers.get("content-range")?.split("/")[1]
      : response.headers.get("content-length"),
  );
  if (!Number.isFinite(total) || total <= 0) {
    throw new RecordingReadError("the recording's size is unknown", true);
  }
  return { bytes: await readUpTo(response, end - start), total, ranged };
}

/** At most `max` bytes of the body; the rest is cancelled, never held. */
async function readUpTo(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const chunks: Uint8Array[] = [];
  let collected = 0;
  while (collected < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    collected += value.length;
  }
  if (collected >= max) await reader.cancel();
  const joined = new Uint8Array(Math.min(collected, max));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, joined.length - offset);
    joined.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= joined.length) break;
  }
  return joined;
}
