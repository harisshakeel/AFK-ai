import "server-only";

import { logLine, type LogFields } from "@/lib/log-line";

/**
 * Structured server logging. One JSON line per event so Vercel's log search works.
 *
 * Rule: log identifiers and counts, never content. No transcript text, no audio paths
 * with tokens, no credentials, no personal data. Pass only the fields a reader needs
 * to find the request and the record involved.
 */
export const log = {
  info: (event: string, fields?: LogFields) => logLine("info", event, fields),
  warn: (event: string, fields?: LogFields) => logLine("warn", event, fields),
  /** Pass the error separately; only its message and name are recorded. */
  error: (event: string, error: unknown, fields?: LogFields) =>
    logLine("error", event, {
      ...fields,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    }),
};
