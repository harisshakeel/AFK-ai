"use client";

import { WaveLoader } from "@/components/ui/wave-loader";
import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { cn } from "@/lib/cn";
import { visitorFetch } from "@/lib/visitor-api";

/**
 * The third thing to do on the landing: leave the Gmail you would sign in with, so the
 * owner can add you to the Google test users (the only people who can sign in while the
 * app is in Testing, see docs/going-live.md). One pill holds the field and its button on
 * a laptop; on a phone they stack. The write goes through the visitor route, which gives
 * the browser an anonymous identity on this first write, not on page load.
 */
type State =
  { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "failed"; message: string };

export function TestUserForm({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const sending = state.kind === "sending";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      await visitorFetch("/api/access-requests", {
        method: "POST",
        body: { email: email.trim() },
      });
      setState({ kind: "done" });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : "Something went wrong. Try again.",
      });
    }
  }

  if (state.kind === "done") {
    return (
      <p
        role="status"
        className={cn(
          "rounded-full border border-accent/30 bg-accent-soft/60 px-5 py-3 text-sm text-fg",
          className,
        )}
      >
        <span className="font-semibold tracking-tight">You&apos;re on the list.</span> Test users
        are added by hand, so give it a day, then sign in with that Gmail.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-2.5", className)}>
      <label htmlFor="test-user-email" className="sr-only">
        The Gmail you would sign in with
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:rounded-full sm:border sm:border-border sm:bg-surface sm:p-1.5 sm:pl-4 sm:shadow-keycap sm:transition-[border-color,box-shadow] sm:duration-150 sm:focus-within:border-accent sm:focus-within:ring-3 sm:focus-within:ring-accent/20">
        <Mail aria-hidden className="hidden size-4 shrink-0 text-fg-subtle sm:block" />
        <input
          id="test-user-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@gmail.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={sending}
          aria-invalid={state.kind === "failed" || undefined}
          aria-describedby="test-user-hint"
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-5 text-base text-fg shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-50 sm:border-0 sm:bg-transparent sm:px-2 sm:shadow-none sm:focus-visible:ring-0"
        />
        <button
          type="submit"
          disabled={sending}
          aria-busy={sending || undefined}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold tracking-tight whitespace-nowrap text-on-ink transition-[background-color,scale] duration-200 hover:bg-accent-strong focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.98] disabled:cursor-progress disabled:opacity-60"
        >
          {sending && <WaveLoader className="h-4" label={null} />}
          Get added to test users
        </button>
      </div>
      <p id="test-user-hint" className="text-sm text-fg-muted">
        Google only lets listed test users sign in for now. Leave the Gmail you&apos;d use and you
        get added.
      </p>
      {state.kind === "failed" && (
        <p role="alert" className="text-sm text-danger-strong">
          {state.message}
        </p>
      )}
    </form>
  );
}
