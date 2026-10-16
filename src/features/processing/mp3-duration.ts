/**
 * The length of an MP3 file, read from the file itself, for a bot recording stored as
 * Attendee delivered it (there is no ffmpeg in a Vercel function). Three sources, in
 * order: a Xing/Info header (the frame count a variable-bitrate encoder writes), a VBRI
 * header, else the file size over the first frame's bitrate (constant bitrate). The
 * first 64 KB are scanned for a frame header, and a header counts only when the frame
 * it describes is followed by another valid header (or by the end of the bytes given):
 * two bytes that merely look like a sync word, in a file that is not MP3 at all, are
 * then not mistaken for one. Null when no such frame is found.
 *
 * `totalBytes` is the whole file's size when only its head is passed in (the caller may
 * stop downloading a recording it will not keep); it feeds the constant-bitrate estimate.
 */
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_L2_BITRATES = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const MPEG1_L1_BITRATES = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const MPEG2_L1_BITRATES = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};
export const MP3_HEAD_BYTES = 64 * 1024;

type FrameHeader = {
  offset: number;
  version: 0 | 2 | 3;
  layer: 1 | 2 | 3;
  bitrateKbps: number;
  sampleRate: number;
  samplesPerFrame: number;
  /** Bytes from this header to the next frame's. */
  frameLength: number;
  mono: boolean;
};

function readHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (bytes[offset] !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined) {
    return null;
  }
  if ((b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  if (versionBits === 1 || layerBits === 0) return null;
  const version = versionBits as 0 | 2 | 3;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const bitrateIndex = (b2 >> 4) & 0xf;
  const sampleRateIndex = (b2 >> 2) & 3;
  const padding = (b2 >> 1) & 1;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const mpeg1 = version === 3;
  const table =
    layer === 3
      ? mpeg1
        ? MPEG1_L3_BITRATES
        : MPEG2_L3_BITRATES
      : layer === 2
        ? mpeg1
          ? MPEG1_L2_BITRATES
          : MPEG2_L3_BITRATES
        : mpeg1
          ? MPEG1_L1_BITRATES
          : MPEG2_L1_BITRATES;
  const bitrateKbps = table[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version]?.[sampleRateIndex];
  if (!bitrateKbps || !sampleRate) return null;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : mpeg1 ? 1152 : 576;
  const bitrate = bitrateKbps * 1000;
  const frameLength =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((layer === 3 && !mpeg1 ? 72 : 144) * bitrate) / sampleRate) + padding;
  return {
    offset,
    version,
    layer,
    bitrateKbps,
    sampleRate,
    samplesPerFrame,
    frameLength,
    mono: ((b3 >> 6) & 3) === 3,
  };
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i += 1) {
    if (bytes[offset + i] !== tag.charCodeAt(i)) return false;
  }
  return true;
}

/** Where the audio starts: after an ID3v2 tag, if there is one. */
function audioStart(bytes: Uint8Array): number {
  if (!tagAt(bytes, 0, "ID3") || bytes.length < 10) return 0;
  const flags = bytes[5] ?? 0;
  const size =
    ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
  return 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);
}

export function mp3DurationSec(bytes: Uint8Array, totalBytes = bytes.length): number | null {
  const start = audioStart(bytes);
  const limit = Math.min(bytes.length - 4, start + MP3_HEAD_BYTES);
  for (let offset = start; offset <= limit; offset += 1) {
    const header = readHeader(bytes, offset);
    if (!header) continue;
    // A real frame is followed by another; a chance sync word is not.
    const next = header.offset + header.frameLength;
    if (next + 4 <= bytes.length && !readHeader(bytes, next)) continue;
    const sideInfo = header.version === 3 ? (header.mono ? 17 : 32) : header.mono ? 9 : 17;
    const xing = header.offset + 4 + sideInfo;
    let frames: number | null = null;
    if (tagAt(bytes, xing, "Xing") || tagAt(bytes, xing, "Info")) {
      const flags = readUint32(bytes, xing + 4) ?? 0;
      if (flags & 1) frames = readUint32(bytes, xing + 8);
    } else if (tagAt(bytes, header.offset + 4 + 32, "VBRI")) {
      frames = readUint32(bytes, header.offset + 4 + 32 + 14);
    }
    const seconds =
      frames !== null && frames > 0
        ? (frames * header.samplesPerFrame) / header.sampleRate
        : ((totalBytes - header.offset) * 8) / (header.bitrateKbps * 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * 1000) / 1000;
  }
  return null;
}
