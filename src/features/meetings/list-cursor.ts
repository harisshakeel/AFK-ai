import { z } from "zod";
import { MEETING_ID } from "@/features/meetings/meeting-file-schema";

/**
 * The meetings list's page cursor: the sort key of the last row shown (recorded_at,
 * created_at, id), carried in the URL as ?after=. Opaque to the browser and validated on
 * the way back in; anything malformed means the first page.
 */
export type ListCursor = { recordedAt: string | null; createdAt: string; id: string };

const cursorSchema = z.object({
  recordedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.string().regex(MEETING_ID),
});

const MAX_LENGTH = 300;

export function encodeCursor(cursor: ListCursor): string {
  // The fields are ASCII (ISO dates and a restricted id), so btoa is safe.
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(text: string | string[] | undefined): ListCursor | null {
  const value = Array.isArray(text) ? text[0] : text;
  if (!value || value.length > MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const json = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = cursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
