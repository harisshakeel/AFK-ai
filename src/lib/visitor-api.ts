"use client";

/**
 * Visitor writes (highlights, share links, ticks) go through our route handlers, which
 * validate the input and act as the visitor under Row Level Security. A visitor without
 * a session gets an anonymous Supabase identity on their first write, not on page load,
 * so reading never creates users.
 *
 * The Supabase client is imported on that first write, not with the page: it is the
 * largest script the meeting page would otherwise load, and reading needs none of it.
 */
let sessionReady: Promise<void> | null = null;

export function ensureVisitorSession(): Promise<void> {
  sessionReady ??= (async () => {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error("Couldn't start a visitor session. Try again in a moment.");
  })().catch((error: unknown) => {
    sessionReady = null;
    throw error;
  });
  return sessionReady;
}

export class ApiError extends Error {
  readonly status: number;
  /** Where the route says to go to put it right ("/connectors", "/sign-in"), when it says. */
  readonly connect: string | null;
  constructor(message: string, status: number, connect: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.connect = connect;
  }
}

export async function visitorFetch<T>(
  path: string,
  init: { method: "POST" | "PATCH" | "PUT" | "DELETE" | "GET"; body?: unknown },
): Promise<T> {
  await ensureVisitorSession();
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    // The browser's own wording ("Failed to fetch", "Load failed") means no connection.
    throw new ApiError("You seem to be offline. Check the connection and try again.", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    connect?: unknown;
  } & T;
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? "Something went wrong. Try again.",
      response.status,
      typeof payload.connect === "string" ? payload.connect : null,
    );
  }
  return payload;
}
