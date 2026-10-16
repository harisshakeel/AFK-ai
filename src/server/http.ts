import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { z } from "zod";

import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/db/supabase-server";
import { log } from "@/server/log";

/**
 * Helpers for route handlers. Every visitor write goes through one of these routes:
 * validate the body with Zod, act as the visitor (RLS applies), answer with a short,
 * safe message. Database errors are logged by code and never echoed to the browser.
 */
export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "The request body must be JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, "Some of the values sent were not valid.") };
  }
  return { ok: true, data: parsed.data };
}

/**
 * The visitor's client and id, or a 401 when there is no session yet, or a 429 past 60
 * writes a minute (NFR Limits). Only write routes call this.
 */
export async function requireVisitor({ countWrite = true }: { countWrite?: boolean } = {}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) {
    return {
      ok: false as const,
      response: jsonError(401, "Your visitor session has expired. Reload the page."),
    };
  }
  // Every route that calls this writes something: count it against the visitor's limit.
  // Routes that write highlights, share links or ticks pass countWrite: false, because
  // the database counts those writes itself (a trigger), whichever way they arrive.
  if (countWrite) {
    const { data: allowed, error: limitError } = await supabase.rpc("note_visitor_write");
    if (limitError) {
      // Fail closed: no limit check, no write.
      log.error("rate_limit.check_failed", new Error(limitError.code ?? "db_error"));
      return {
        ok: false as const,
        response: jsonError(503, "AFK can't save changes right now. Try again in a moment."),
      };
    }
    if (allowed !== true) {
      return {
        ok: false as const,
        response: jsonError(429, "That's a lot of changes at once. Wait a minute and try again."),
      };
    }
  }
  const meta = (data.claims.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return {
    ok: true as const,
    supabase,
    userId,
    /** The Google name, as getViewer() reads it; routes that act in a call need it. */
    name: name?.trim() ?? null,
    isAnonymous: data.claims.is_anonymous === true,
  };
}

/**
 * A signed-in user, never an anonymous visitor: the routes for the bot, commands, memory
 * and connectors. `message` is the 403's text; the 401 and 429 are requireVisitor()'s.
 */
export async function requireUser(message: string, options: { countWrite?: boolean } = {}) {
  const visitor = await requireVisitor(options);
  if (!visitor.ok) return visitor;
  if (visitor.isAnonymous) return { ok: false as const, response: jsonError(403, message) };
  return visitor;
}

/**
 * Our own scheduled callers (Vercel Cron, the kick chain, a pinger) carry the cron
 * secret as a bearer token. Compared in constant time over byte lengths; a 401 when it
 * is missing, wrong, or not configured at all (loud in the log, because a missing
 * secret would silently let the project pause and the chain stop).
 */
export function requireCronSecret(request: Request): Response | null {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) {
    log.error("cron.unconfigured", new Error("CRON_SECRET is not set"));
    return jsonError(401, "Not allowed.");
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  // Byte lengths, not character counts: timingSafeEqual throws on unequal buffers.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return jsonError(401, "Not allowed.");
  }
  return null;
}

export function dbFailure(event: string, error: { code?: string; message: string }) {
  log.error(event, new Error(error.code ?? "db_error"));
  if (error.code === "42501") return jsonError(403, "You can't change that.");
  if (error.code === "P0005")
    return jsonError(429, "That's a lot of changes at once. Wait a minute and try again.");
  if (error.code === "23514" || error.code === "22P02")
    return jsonError(400, "Those values aren't allowed.");
  return jsonError(500, "Something went wrong saving that. Try again.");
}

export const uuidSchemaMessage = "Not found.";
