"use client";

import { CircleAlert, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

import { cleanPin } from "./link-code";

/**
 * The PIN a link holder types once (2026-10-16). A right PIN sets a grant cookie for
 * this link and the page reloads with the meeting; a wrong one says how many tries are
 * left, and five wrong ones lock this link for this visitor for fifteen minutes.
 */
export function PinForm({ code }: { code: string }) {
  const router = useRouter();
  const id = useId();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const digits = cleanPin(pin);
    if (!digits) {
      setError("The PIN is four digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/m/${code}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: digits }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That didn't work. Try again.");
    } catch {
      setError("Couldn't reach AFK. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xs"
    >
      <KeyRound className="size-6 text-accent" aria-hidden />
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
        A meeting shared with you
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Enter the four-digit PIN that came with the link to see the recording, the transcript and
        the summary. Everything else, from tasks and approvals to the host&apos;s notes and
        connected apps, stays with the host.
      </p>
      <label htmlFor={id} className="mt-5 block text-sm font-medium">
        PIN
      </label>
      <input
        id={id}
        value={pin}
        onChange={(event) => setPin(event.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={4}
        placeholder="1234"
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass("mt-1.5 h-11 font-mono text-lg tracking-[0.3em]")}
        autoFocus
      />
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 flex items-center gap-2 text-sm text-danger"
        >
          <CircleAlert className="size-4" aria-hidden />
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="mt-5 w-full" loading={busy}>
        Open the meeting
      </Button>
    </form>
  );
}
