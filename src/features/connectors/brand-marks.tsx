import { cn } from "@/lib/cn";

import type { ConnectorApp } from "./registry";

/**
 * The three apps' own marks, drawn inline so no request leaves for them. These are the
 * one place raw colours are allowed: a brand mark is only itself in its own colours.
 * Each is decorative; the name beside it carries the meaning.
 */
type MarkProps = { className?: string };

/** Gmail's envelope, in its four colours. */
export function GmailMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 52 40" className={cn("shrink-0", className)} aria-hidden>
      <path fill="#4285F4" d="M4 36h8V17L0 11v21a4 4 0 0 0 4 4z" />
      <path fill="#34A853" d="M40 36h8a4 4 0 0 0 4-4V11l-12 6z" />
      <path fill="#FBBC04" d="M40 17l12-6V7.5A4.5 4.5 0 0 0 44.8 4L40 7.7z" />
      <path fill="#C5221F" d="M0 7.5V11l12 6V7.7L7.2 4A4.5 4.5 0 0 0 0 7.5z" />
      <path fill="#EA4335" d="M12 17V7.7L26 18.2 40 7.7V17L26 27.5z" />
    </svg>
  );
}

/** Google Calendar's page, with its coloured edges and the 31. */
export function GoogleCalendarMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden>
      <rect x="8" y="8" width="32" height="32" fill="#FFFFFF" />
      <path fill="#4285F4" d="M8 4h32a4 4 0 0 1 4 4v4H4V8a4 4 0 0 1 4-4z" />
      <path fill="#4285F4" d="M4 12h4v24H4z" />
      <path fill="#FBBC04" d="M40 12h4v24h-4z" />
      <path fill="#34A853" d="M4 36h32v8H8a4 4 0 0 1-4-4z" />
      <path fill="#EA4335" d="M36 44v-8h8z" />
      <path fill="#188038" d="M4 36h4v4H4z" />
      <text
        x="24"
        y="30.5"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#4285F4"
      >
        31
      </text>
    </svg>
  );
}

/** Slack's four-colour mark (geometry from Simple Icons, CC0). */
export function SlackMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden>
      <path
        fill="#E01E5A"
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
      />
      <path
        fill="#36C5F0"
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
      />
      <path
        fill="#2EB67D"
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
      />
      <path
        fill="#ECB22E"
        d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
      />
    </svg>
  );
}

export const BRAND_MARKS: Record<ConnectorApp["id"], (props: MarkProps) => React.JSX.Element> = {
  gmail: GmailMark,
  "google-calendar": GoogleCalendarMark,
  slack: SlackMark,
};
