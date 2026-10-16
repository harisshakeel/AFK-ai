import { describe, expect, it } from "vitest";

import { type ByteSource, isMp4, mp4DurationSec } from "./mp4-duration";

/** A box: 32-bit size, four-character type, body. */
function box(type: string, body: number[] | Uint8Array): Uint8Array {
  const size = 8 + body.length;
  return Uint8Array.from([...uint32(size), ...ascii(type), ...body]);
}

/** A box with a 64-bit size (size field 1, then the real size after the type). */
function largeBox(type: string, body: Uint8Array): Uint8Array {
  const size = 16 + body.length;
  return Uint8Array.from([
    ...uint32(1),
    ...ascii(type),
    ...uint32(Math.floor(size / 2 ** 32)),
    ...uint32(size % 2 ** 32),
    ...body,
  ]);
}

function mvhd({
  version,
  timescale,
  duration,
}: {
  version: 0 | 1;
  timescale: number;
  duration: number;
}): Uint8Array {
  const times = version === 1 ? 16 : 8; // creation and modification times
  const body = [
    version,
    0,
    0,
    0,
    ...new Array<number>(times).fill(0),
    ...uint32(timescale),
    ...(version === 1 ? [...uint32(0), ...uint32(duration)] : uint32(duration)),
    ...new Array<number>(80).fill(0), // rate, volume, matrix, next track id
  ];
  return box("mvhd", body);
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const uint32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const concat = (...parts: Uint8Array[]) => {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};
const ftyp = () => box("ftyp", [...ascii("isom"), ...uint32(512), ...ascii("isomiso2mp41")]);

/** A source over bytes in memory that records how much each read asked for. */
function source(bytes: Uint8Array): ByteSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    size: bytes.length,
    reads,
    read: async (start, length) => {
      reads.push(length);
      return bytes.subarray(start, start + length);
    },
  };
}

describe("mp4DurationSec", () => {
  it("reads the duration from a version 0 mvhd written before the media (faststart)", async () => {
    const file = concat(
      ftyp(),
      box("moov", mvhd({ version: 0, timescale: 1000, duration: 65_432 })),
      box("mdat", new Array<number>(5000).fill(0)),
    );
    expect(isMp4(file)).toBe(true);
    expect(await mp4DurationSec(source(file))).toBe(65.432);
  });

  it("walks past a large 64-bit mdat to a moov written after the media, in small reads", async () => {
    const media = largeBox("mdat", new Uint8Array(3 * 1024 * 1024));
    const file = concat(
      ftyp(),
      box("free", []),
      media,
      box(
        "moov",
        concat(
          box("iods", [0, 0, 0, 0]),
          mvhd({ version: 1, timescale: 90_000, duration: 90_000 * 3725 }),
        ),
      ),
    );
    const bytes = source(file);
    expect(await mp4DurationSec(bytes)).toBe(3725);
    // Four box headers and one moov body: nothing like the three megabytes of media.
    expect(bytes.reads.length).toBeLessThanOrEqual(5);
    expect(bytes.reads.reduce((total, read) => total + read, 0)).toBeLessThan(1024);
  });

  it("is null for a file that is not an MP4, a moov without mvhd, or a truncated box", async () => {
    const noise = Uint8Array.from([...ascii("ID3"), 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb]);
    expect(isMp4(noise)).toBe(false);
    expect(await mp4DurationSec(source(noise))).toBeNull();
    expect(
      await mp4DurationSec(source(concat(ftyp(), box("moov", box("iods", [0, 0, 0, 0]))))),
    ).toBeNull();
    // The mdat claims more bytes than the file has.
    const truncated = concat(ftyp(), box("mdat", new Array<number>(100).fill(0))).subarray(0, 60);
    expect(await mp4DurationSec(source(truncated))).toBeNull();
  });

  it("refuses a zero or absurd duration rather than publishing it", async () => {
    const zero = concat(ftyp(), box("moov", mvhd({ version: 0, timescale: 1000, duration: 0 })));
    expect(await mp4DurationSec(source(zero))).toBeNull();
    const week = concat(
      ftyp(),
      box("moov", mvhd({ version: 0, timescale: 1, duration: 7 * 24 * 60 * 60 })),
    );
    expect(await mp4DurationSec(source(week))).toBeNull();
  });
});
