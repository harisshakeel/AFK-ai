/**
 * One JSON line per event, the shape Vercel's log search reads. The rule everywhere:
 * identifiers and counts, never content (src/server/log.ts and its test own the
 * allowlist of field names).
 */
export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logLine(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
