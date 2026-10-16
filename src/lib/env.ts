import { z } from "zod";

/**
 * Validated environment. Import `publicEnv` anywhere; import `serverEnv` only from
 * server code (it throws if read in the browser). Missing or malformed values fail at
 * startup with the variable's name, never silently at request time.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  /** Vercel Cron sends it as a bearer token to /api/cron/keepalive. */
  CRON_SECRET: z.string().min(16).optional(),
  /** The meeting bot (F9). Without these the bot is shown as not configured. */
  ATTENDEE_API_KEY: z.string().min(10).optional(),
  /** Base64, as Attendee shows it; a mis-pasted value would silently fail every delivery. */
  ATTENDEE_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9+/]{16,}={0,2}$/, "ATTENDEE_WEBHOOK_SECRET must be the base64 secret")
    .optional(),
  ATTENDEE_API_URL: z.url().optional(),
  /**
   * Where the bot's transcript comes from. "captions": the platform's own live captions,
   * free, no extra key, but they drop words. "deepgram": Deepgram through Attendee, streamed
   * during the call and far more accurate; needs a Deepgram key saved in the Attendee
   * project (docs/going-live.md).
   */
  ATTENDEE_TRANSCRIPTION: z.enum(["captions", "deepgram"]).default("captions"),
  /** Deepgram's language: multilingual by default, so Urdu spoken in an English call is not lost. */
  ATTENDEE_DEEPGRAM_LANGUAGE: z.enum(["en", "multi"]).default("multi"),
  /** Connectors: 32 random bytes, base64; seals every token. */
  CONNECTOR_TOKEN_KEY: z.string().min(40).optional(),
  /** Google OAuth client (Gmail, Calendar); the same client as sign-in. */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  /** Slack app credentials (api.slack.com/apps). */
  SLACK_CLIENT_ID: z.string().min(5).optional(),
  SLACK_CLIENT_SECRET: z.string().min(10).optional(),
  /** The Claude API key that writes the notes. Without it, AI jobs wait and the page says so. */
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  /** The model every Claude call uses; the owner's choice is Sonnet 5.5. */
  CLAUDE_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
});

function parse<T extends z.ZodType>(
  schema: T,
  values: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(values);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}. See .env.example.`);
  }
  return result.data;
}

// Next.js inlines NEXT_PUBLIC_* only when referenced by full name, so list them explicitly.
export const publicEnv = parse(publicSchema, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

/** A production build (next build), whatever the deployment: Secure cookies, for one. */
export const isProductionBuild = process.env.NODE_ENV === "production";

export type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser");
  }
  // The site URL defaults to localhost for development. A production deployment without
  // it would send OAuth callbacks and share links to localhost, so it fails here instead.
  if (process.env.VERCEL_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be set on the production deployment");
  }
  cachedServerEnv ??= parse(serverSchema, {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    ATTENDEE_API_KEY: process.env.ATTENDEE_API_KEY || undefined,
    ATTENDEE_WEBHOOK_SECRET: process.env.ATTENDEE_WEBHOOK_SECRET || undefined,
    ATTENDEE_API_URL: process.env.ATTENDEE_API_URL || undefined,
    ATTENDEE_TRANSCRIPTION: process.env.ATTENDEE_TRANSCRIPTION || undefined,
    ATTENDEE_DEEPGRAM_LANGUAGE: process.env.ATTENDEE_DEEPGRAM_LANGUAGE || undefined,
    CONNECTOR_TOKEN_KEY: process.env.CONNECTOR_TOKEN_KEY || undefined,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || undefined,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID || undefined,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET || undefined,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    CLAUDE_MODEL: process.env.CLAUDE_MODEL || undefined,
  });
  return cachedServerEnv;
}

/**
 * Where the production site answers: the address Vercel assigns the production
 * deployment, else the configured site URL. The bot's webhook and the processing chain
 * both post here; never a preview deployment's own address, which Vercel's protection
 * answers with a login page before any route runs.
 */
export function productionOrigin(): string {
  const assigned = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return assigned ? `https://${assigned}` : new URL(publicEnv.NEXT_PUBLIC_SITE_URL).origin;
}
