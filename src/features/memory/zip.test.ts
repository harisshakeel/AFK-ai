import { describe, expect, it } from "vitest";

import { buildZip, crc32 } from "./zip";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer).getUint32(at, true);
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer).getUint16(at, true);

describe("zip writer", () => {
  it("computes the CRC-32 readers check", () => {
    // The reference value for "123456789" from the CRC catalogue.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes a stored archive with a local header, central directory and end record", () => {
    const zip = buildZip([
      { name: "profile.md", content: "# Profile\n", modifiedAt: new Date("2026-10-20T10:00:00Z") },
      { name: "context/people.md", content: "# People\n- Ü\n" },
    ]);
    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(text(zip.subarray(30, 40))).toBe("profile.md");
    expect(text(zip.subarray(40, 50))).toBe("# Profile\n");
    // End of central directory: two entries, and the directory starts where the locals end.
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(u16(zip, end + 10)).toBe(2);
    const centralOffset = u32(zip, end + 16);
    expect(u32(zip, centralOffset)).toBe(0x02014b50);
    expect(u32(zip, centralOffset + 42)).toBe(0); // first entry at offset 0
    // The second entry's name is UTF-8 and its length counts bytes, not characters.
    const second = centralOffset + 46 + "profile.md".length;
    expect(u32(zip, second)).toBe(0x02014b50);
    expect(u32(zip, second + 20)).toBe(new TextEncoder().encode("# People\n- Ü\n").length);
    expect(text(zip.subarray(second + 46, second + 46 + 17))).toBe("context/people.md");
  });
});
