import { describe, expect, it } from "vitest";

import { mp3DurationSec } from "./mp3-duration";

/** MPEG 1 Layer III, 128 kbps, 44.1 kHz, joint stereo, no padding: FF FB 90 60. */
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x60];
/** floor(144 × 128000 / 44100): the bytes from one such header to the next. */
const FRAME_LENGTH = 417;

/** One frame of the right length: the header, the given bytes, zeros to the end. */
function frame(body: number[] = []): number[] {
  const bytes = [...FRAME_HEADER, ...body];
  return [...bytes, ...new Array<number>(FRAME_LENGTH - bytes.length).fill(0)];
}

function id3Tag(bodySize: number): number[] {
  const size = [
    (bodySize >> 21) & 0x7f,
    (bodySize >> 14) & 0x7f,
    (bodySize >> 7) & 0x7f,
    bodySize & 0x7f,
  ];
  return [0x49, 0x44, 0x33, 4, 0, 0, ...size, ...new Array<number>(bodySize).fill(0)];
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

describe("mp3DurationSec", () => {
  it("reads the frame count from a Xing header, past an ID3 tag", () => {
    // MPEG 1 stereo: 32 bytes of side info between the header and the Xing tag.
    const xingFrame = frame([
      ...new Array<number>(32).fill(0),
      ...[0x58, 0x69, 0x6e, 0x67], // "Xing"
      ...uint32(0x0f), // flags: frames, bytes, toc, quality
      ...uint32(1000), // frames
    ]);
    const bytes = Uint8Array.from([...id3Tag(100), ...xingFrame, ...frame(), ...frame()]);
    // 1000 frames of 1152 samples at 44.1 kHz.
    expect(mp3DurationSec(bytes)).toBe(26.122);
  });

  it("falls back to size over bitrate for a constant-bitrate file", () => {
    // 128 kbps: 16,000 bytes a second, so 48,000 bytes of audio is three seconds.
    const frames = [...frame(), ...frame(), ...frame()];
    const bytes = Uint8Array.from([
      ...frames,
      ...new Array<number>(48_000 - frames.length).fill(0),
    ]);
    expect(mp3DurationSec(bytes)).toBe(3);
  });

  it("uses the whole file's size when only the head is given", () => {
    const head = Uint8Array.from([...frame(), ...frame()]);
    // 160,000 bytes at 128 kbps: ten seconds, though only two frames were read.
    expect(mp3DurationSec(head, 160_000)).toBe(10);
  });

  it("skips bytes that only look like a header", () => {
    // 0xFF 0xFF with a reserved version is not a frame; the real frames follow.
    const frames = [...frame(), ...frame()];
    const bytes = Uint8Array.from([
      0xff,
      0xef,
      0x00,
      0x00,
      ...frames,
      ...new Array<number>(16_000 - 4 - frames.length).fill(0),
    ]);
    expect(mp3DurationSec(bytes)).toBe(1);
  });

  it("rejects a sync word that is not followed by another frame", () => {
    // A lone header in a file of something else: not MP3.
    const bytes = Uint8Array.from([...FRAME_HEADER, ...new Array<number>(2000).fill(0)]);
    expect(mp3DurationSec(bytes)).toBeNull();
  });

  it("answers null for a file with no frame", () => {
    expect(mp3DurationSec(Uint8Array.from(new Array<number>(2000).fill(0)))).toBeNull();
    expect(mp3DurationSec(Uint8Array.from([]))).toBeNull();
  });
});
