import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BrowserContext } from "@playwright/test";

import { transcriptHash } from "../src/features/meetings/transcript-hash";

/**
 * A signed-in browser for the journeys behind sign-in (dashboard, welcome, memory,
 * tasks). It creates a throwaway email-and-password user through Supabase's admin API
 * with the secret key from .env.local, marks Google among its providers (the app treats
 * only an identity with Google as a Google user, isGoogleUser()), signs it in with the
 * password grant, writes the session cookie the way @supabase/ssr does, and deletes the
 * user afterwards. Without .env.local (CI, a clean checkout) the caller skips.
 */
type Env = { url: string; publishableKey: string; secretKey: string };

export function localEnv(): Env | null {
  let text: string;
  try {
    text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1]!, match[2]!.replace(/^["']|["']$/g, ""));
  }
  const url = values.get("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = values.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = values.get("SUPABASE_SECRET_KEY");
  return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : null;
}

export type TestUser = { id: string; email: string; dispose: () => Promise<void> };

function requireEnv(): Env {
  const env = localEnv();
  if (!env) throw new Error("no .env.local: the signed-in journeys need the local keys");
  return env;
}

/** One call with the secret key: the admin auth API, or PostgREST with RLS bypassed. */
async function admin(env: Env, path: string, init: { method: string; json?: unknown }) {
  return fetch(`${env.url}/${path}`, {
    method: init.method,
    headers: {
      apikey: env.secretKey,
      Authorization: `Bearer ${env.secretKey}`,
      "Content-Type": "application/json",
      ...(path.startsWith("rest/") ? { Prefer: "return=minimal" } : {}),
    },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
}

/** The cookie name @supabase/ssr derives from the project reference in the URL. */
function cookieName(url: string) {
  const ref = new URL(url).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

function base64url(text: string) {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Whether an access token's app_metadata names Google among the providers. */
function tokenHasGoogle(token: unknown): boolean {
  if (typeof token !== "string") return false;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      app_metadata?: { providers?: unknown };
    };
    const providers = claims.app_metadata?.providers;
    return Array.isArray(providers) && providers.includes("google");
  } catch {
    return false;
  }
}

/** Users an interrupted run left behind (an hour old or more): removed once per run. */
let swept: Promise<void> | undefined;
function sweepStaleTestUsers(env: Env): Promise<void> {
  swept ??= sweepOnce(env);
  return swept;
}

async function sweepOnce(env: Env): Promise<void> {
  try {
    const listed = await admin(env, "auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
    if (!listed.ok) return;
    const { users } = (await listed.json()) as {
      users: Array<{ id: string; email?: string; created_at: string }>;
    };
    const cutoff = Date.now() - 60 * 60_000;
    const stale = users.filter(
      (user) => /^e2e-.*@afk\.test$/.test(user.email ?? "") && Date.parse(user.created_at) < cutoff,
    );
    await Promise.all(
      stale.map((user) => admin(env, `auth/v1/admin/users/${user.id}`, { method: "DELETE" })),
    );
  } catch {
    // Best effort: a sweep that fails must not fail the journey.
  }
}

export async function signInAsNewUser(context: BrowserContext, baseURL: string): Promise<TestUser> {
  const env = requireEnv();
  await sweepStaleTestUsers(env);
  const email = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@afk.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const created = await admin(env, "auth/v1/admin/users", {
    method: "POST",
    json: { email, password, email_confirm: true, user_metadata: { full_name: "E2E Tester" } },
  });
  if (!created.ok) throw new Error(`could not create the test user (${created.status})`);
  const { id } = (await created.json()) as { id: string };
  const dispose = async () => {
    const deleted = await admin(env, `auth/v1/admin/users/${id}`, { method: "DELETE" });
    if (!deleted.ok) console.warn(`test user ${email} was not deleted (${deleted.status})`);
  };
  // app_metadata is the server's, written only with the secret key: the same field
  // Supabase fills in when someone continues with Google.
  const marked = await admin(env, `auth/v1/admin/users/${id}`, {
    method: "PUT",
    json: { app_metadata: { providers: ["email", "google"] } },
  });
  if (!marked.ok) {
    await dispose();
    throw new Error(`could not mark the test user as a Google user (${marked.status})`);
  }

  const signedIn = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) {
    await dispose();
    throw new Error(`password sign-in failed (${signedIn.status})`);
  }
  const session = (await signedIn.json()) as Record<string, unknown>;
  if (!tokenHasGoogle(session.access_token)) {
    await dispose();
    throw new Error("the test user's token does not name Google among its providers");
  }
  // The same shape auth-js stores: the token response, base64url-encoded, chunked at 3180.
  const value = `base64-${base64url(JSON.stringify(session))}`;
  const name = cookieName(env.url);
  const chunks: Array<{ name: string; value: string }> = [];
  if (value.length <= 3180) chunks.push({ name, value });
  else {
    for (let i = 0, n = 0; i < value.length; i += 3180, n++) {
      chunks.push({ name: `${name}.${n}`, value: value.slice(i, i + 3180) });
    }
  }
  const origin = new URL(baseURL);
  await context.addCookies(
    chunks.map((chunk) => ({
      ...chunk,
      domain: origin.hostname,
      path: "/",
      httpOnly: false,
      secure: origin.protocol === "https:",
      sameSite: "Lax" as const,
    })),
  );
  return { id, email, dispose };
}

/**
 * A ready meeting owned by the test user, with a three-line transcript, no AI output and
 * an audio path with no file behind it. The speakers and turns are written directly rather
 * than through ingest_transcript(), so no job is queued and nothing spends a Claude call
 * on a test. Deleting the user removes it (the owner key cascades).
 */
export async function addOwnedMeeting(
  ownerId: string,
  { stage = "ready" }: { stage?: "ready" | "recording" } = {},
): Promise<string> {
  const env = requireEnv();
  const id = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const row = {
    id,
    owner_id: ownerId,
    title: "Launch planning (test)",
    // "recording": a bot in the call, no transcript yet, so the page shows the steps.
    status: stage === "recording" ? "recording" : "transcribed",
    recorded_at: new Date().toISOString(),
  };
  const created = await admin(env, "rest/v1/meetings", { method: "POST", json: row });
  if (!created.ok) throw new Error(`could not set up the test meeting (${created.status})`);
  if (stage === "recording") return id;
  const speakers = [
    { code: "a", label: "Tess" },
    { code: "b", label: "Sam" },
  ];
  const turns = [
    {
      id: `${id}-0000`,
      speaker: "a",
      startSec: 0,
      endSec: 4,
      text: "Let's settle the launch date today.",
    },
    {
      id: `${id}-0001`,
      speaker: "b",
      startSec: 4,
      endSec: 9,
      text: "I'll send the deck by Friday.",
    },
    {
      id: `${id}-0002`,
      speaker: "a",
      startSec: 9,
      endSec: 12,
      text: "Someone should check the pricing page.",
    },
  ];
  const durationSec = 12;
  const steps: Array<[string, string, unknown]> = [
    [
      "POST",
      "meeting_speakers",
      speakers.map((speaker, idx) => ({ meeting_id: id, ...speaker, idx, is_host: idx === 0 })),
    ],
    [
      "POST",
      "transcript_turns",
      turns.map((turn, idx) => ({
        id: turn.id,
        meeting_id: id,
        idx,
        speaker_code: turn.speaker,
        start_sec: turn.startSec,
        end_sec: turn.endSec,
        text: turn.text,
      })),
    ],
    [
      "PATCH",
      `meetings?id=eq.${id}`,
      {
        status: "ready",
        audio_path: `${id}/v1.m4a`,
        duration_sec: durationSec,
        transcript_hash: transcriptHash({ durationSec, speakers, turns }),
      },
    ],
  ];
  for (const [method, path, json] of steps) {
    const response = await admin(env, `rest/v1/${path}`, { method, json });
    if (!response.ok)
      throw new Error(`could not set up the test meeting: ${path} (${response.status})`);
  }
  return id;
}

/** What the keep-alive's sweep does to a bot that never reported back: failed, with why. */
export async function failMeeting(meetingId: string, detail: string): Promise<void> {
  const response = await admin(requireEnv(), `rest/v1/meetings?id=eq.${meetingId}`, {
    method: "PATCH",
    json: { status: "failed", status_detail: detail },
  });
  if (!response.ok) throw new Error(`could not fail the test meeting (${response.status})`);
}

/**
 * A command waiting for approval on the test user's meeting, as the parser would have
 * left it: proposed, with the names AFK heard. Written directly, so no Claude call runs.
 */
export async function addProposedCommand(
  meetingId: string,
  input: { kind: "email" | "followup" | "slack"; sentence: string; args: Record<string, unknown> },
): Promise<void> {
  const response = await admin(requireEnv(), "rest/v1/meeting_commands", {
    method: "POST",
    json: {
      meeting_id: meetingId,
      source: "typed",
      kind: input.kind,
      sentence: input.sentence,
      status: "proposed",
      needs_approval: true,
      args: input.args,
    },
  });
  if (!response.ok) throw new Error(`could not add the test command (${response.status})`);
}

/** As the notes job leaves a meeting: summarised now, so the wrap-up should pop up. */
export async function markSummarized(meetingId: string, headline: string): Promise<void> {
  const response = await admin(requireEnv(), `rest/v1/meetings?id=eq.${meetingId}`, {
    method: "PATCH",
    json: { summarized_at: new Date().toISOString(), ai_headline: headline },
  });
  if (!response.ok)
    throw new Error(`could not mark the test meeting summarised (${response.status})`);
}

/** Backdates every command of a meeting, so the wrap-up's nudge for stale cards applies. */
export async function ageCommands(meetingId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 86_400_000).toISOString();
  const response = await admin(
    requireEnv(),
    `rest/v1/meeting_commands?meeting_id=eq.${meetingId}`,
    {
      method: "PATCH",
      json: { created_at: at },
    },
  );
  if (!response.ok) throw new Error(`could not age the test commands (${response.status})`);
}
