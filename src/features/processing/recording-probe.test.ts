import { describe, expect, it } from "vitest";

import { probeRecording, PROBE_WINDOW_BYTES, RecordingReadError } from "./recording-probe";

/**
 * A server holding one file. With `ranges` it answers a Range header with 206 and the
 * bytes asked for, as S3 does; without, it answers 200 with the whole file, which the
 * probe must not read to the end.
 */
/** A fresh copy on its own buffer, the shape a Response body wants. */
const copy = (part: Uint8Array) => new Uint8Array(part);

function server(file: Uint8Array, { ranges = true, status = 200 } = {}) {
  const requests: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range") ?? "";
    requests.push(range);
    if (status !== 200) return new Response(null, { status });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (ranges && match) {
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), file.length - 1);
      return new Response(copy(file.slice(start, end + 1)), {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${file.length}` },
      });
    }
    return new Response(copy(file), {
      status: 200,
      headers: { "content-length": String(file.length) },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const uint32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const box = (type: string, body: number[]) =>
  Uint8Array.from([...uint32(8 + body.length), ...ascii(type), ...body]);
const concat = (...parts: Uint8Array[]) => {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};

/** An MP4 whose moov (version 0 mvhd, 1000 ticks a second) follows a 200 KB mdat. */
function mp4(durationMs: number): Uint8Array {
  const mvhd = box("mvhd", [
    0,
    0,
    0,
    0,
    ...uint32(0),
    ...uint32(0),
    ...uint32(1000),
    ...uint32(durationMs),
    ...new Array<number>(80).fill(0),
  ]);
  return concat(
    box("ftyp", [...ascii("isom"), ...uint32(512), ...ascii("isomiso2mp41")]),
    box("mdat", new Array<number>(200 * 1024).fill(0)),
    box("moov", [...mvhd]),
  );
}

/** A constant-bitrate MP3: MPEG 1 Layer III, 128 kbps, 44.1 kHz frames of 417 bytes. */
function mp3(frames: number): Uint8Array {
  const frame = [0xff, 0xfb, 0x90, 0x60, ...new Array<number>(413).fill(0)];
  return Uint8Array.from(new Array<number[]>(frames).fill(frame).flat());
}

describe("probeRecording", () => {
  it("reads an MP4's length through a few small range requests, never the media", async () => {
    const file = mp4(3_725_500);
    const { fetchImpl, requests } = server(file);
    const probe = await probeRecording("https://files.example/rec.mp4", { fetchImpl });
    expect(probe).toEqual({ bytes: file.length, durationSec: 3725.5, lengthFrom: "mp4" });
    expect(requests[0]).toBe(`bytes=0-${PROBE_WINDOW_BYTES - 1}`);
    expect(requests.length).toBeLessThanOrEqual(4);
    // No request reaches into the media box's body.
    for (const range of requests) {
      const [start, end] = range.replace("bytes=", "").split("-").map(Number);
      expect(end! - start!).toBeLessThan(PROBE_WINDOW_BYTES);
    }
  });

  it("reads an MP3's length from its first frames and the file size", async () => {
    const file = mp3(1000);
    const { fetchImpl, requests } = server(file);
    const probe = await probeRecording("https://files.example/rec.mp3", { fetchImpl });
    // 417,000 bytes at 128 kbps.
    expect(probe).toEqual({ bytes: file.length, durationSec: 26.063, lengthFrom: "mp3" });
    expect(requests).toHaveLength(1);
  });

  it("gives up on the length, not the recording, when the server ignores ranges", async () => {
    const file = mp4(60_000);
    const { fetchImpl, requests } = server(file, { ranges: false });
    const probe = await probeRecording("https://files.example/rec.mp4", { fetchImpl });
    expect(probe).toEqual({ bytes: file.length, durationSec: null, lengthFrom: null });
    expect(requests).toHaveLength(1);
  });

  it("is null for a file of neither kind, and throws when the first request fails", async () => {
    const { fetchImpl } = server(Uint8Array.from(new Array<number>(100).fill(7)));
    expect(await probeRecording("https://files.example/rec.bin", { fetchImpl })).toEqual({
      bytes: 100,
      durationSec: null,
      lengthFrom: null,
    });
    const refused = server(mp4(1000), { status: 403 });
    await expect(
      probeRecording("https://files.example/rec.mp4", { fetchImpl: refused.fetchImpl }),
    ).rejects.toThrow("recording read failed (403)");
  });

  it("says whether a failed read can mend: a refusal cannot, an outage or a rate limit can", async () => {
    const cases: Array<[number, boolean]> = [
      [403, true],
      [404, true],
      [410, true],
      [408, false],
      [429, false],
      [500, false],
      [503, false],
    ];
    for (const [status, permanent] of cases) {
      const { fetchImpl } = server(mp4(1000), { status });
      const error = await probeRecording("https://files.example/rec.mp4", { fetchImpl }).catch(
        (caught: unknown) => caught,
      );
      expect(error, String(status)).toBeInstanceOf(RecordingReadError);
      expect((error as RecordingReadError).permanent, String(status)).toBe(permanent);
    }
    // A server that cannot say the file's size will not say it on a retry either.
    const sizeless = (async () =>
      new Response(copy(mp4(1000)), { status: 200 })) as unknown as typeof fetch;
    const error = await probeRecording("https://files.example/rec.mp4", {
      fetchImpl: sizeless,
    }).catch((caught: unknown) => caught);
    expect((error as RecordingReadError).permanent).toBe(true);
  });
});
