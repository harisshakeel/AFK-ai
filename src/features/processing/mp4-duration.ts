/**
 * The length of an MP4 file, read from its header without the file: the caller hands
 * in a source that reads a range of bytes (recording-probe.ts fetches them with HTTP
 * range requests), and the top-level boxes are walked from the front by their declared
 * sizes, `ftyp`, `free`, the `mdat` holding the media, until `moov`, whose child
 * `mvhd` carries the movie's timescale and duration. The walk works whether the
 * encoder wrote `moov` before the media (faststart) or after it, and reads at most
 * 64 KB of any box. Null when the file is not an MP4, a box is malformed, or there is
 * no `mvhd`.
 */
export type ByteSource = {
  size: number;
  /** The bytes from `start`, at most `length` of them (fewer at the end of the file). */
  read(start: number, length: number): Promise<Uint8Array>;
};

const WINDOW_BYTES = 64 * 1024;
const MAX_BOXES = 64;
/** The longest meeting the product is built for is three hours; a day is the sanity bound. */
const MAX_SECONDS = 24 * 60 * 60;

/** An MP4 (or MOV) starts with its `ftyp` box. */
export function isMp4(head: Uint8Array): boolean {
  return typeAt(head, 4) === "ftyp";
}

export async function mp4DurationSec(source: ByteSource): Promise<number | null> {
  let offset = 0;
  for (let boxes = 0; boxes < MAX_BOXES && offset + 8 <= source.size; boxes += 1) {
    const header = await source.read(offset, 16);
    const size32 = readUint32(header, 0);
    const type = typeAt(header, 4);
    if (size32 === null || type === "") return null;
    // Size 1: a 64-bit size follows the type. Size 0: the box runs to the end of the file.
    const boxSize =
      size32 === 1 ? readUint64(header, 8) : size32 === 0 ? source.size - offset : size32;
    if (boxSize === null || boxSize < 8 || offset + boxSize > source.size) return null;
    if (type === "moov") {
      return readMvhd(await source.read(offset + 8, Math.min(boxSize - 8, WINDOW_BYTES)));
    }
    offset += boxSize;
  }
  return null;
}

/** The duration from the `mvhd` child of a `moov` box body: duration over timescale. */
function readMvhd(moov: Uint8Array): number | null {
  let offset = 0;
  while (offset + 8 <= moov.length) {
    const size = readUint32(moov, offset);
    if (size === null || size < 8) return null;
    if (typeAt(moov, offset + 4) === "mvhd") {
      // After the 8-byte box header: version (1), flags (3), then the creation and
      // modification times, 4 bytes each in version 0 and 8 each in version 1.
      const version = moov[offset + 8];
      const timescale = readUint32(moov, offset + (version === 1 ? 28 : 20));
      const duration =
        version === 1 ? readUint64(moov, offset + 32) : readUint32(moov, offset + 24);
      if (!timescale || !duration) return null;
      const seconds = duration / timescale;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) return null;
      return Math.round(seconds * 1000) / 1000;
    }
    offset += size;
  }
  return null;
}

function typeAt(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readUint64(bytes: Uint8Array, offset: number): number | null {
  const high = readUint32(bytes, offset);
  const low = readUint32(bytes, offset + 4);
  if (high === null || low === null) return null;
  return high * 2 ** 32 + low;
}
