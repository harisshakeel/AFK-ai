"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { usePlayheadTime, type Playhead } from "@/lib/playhead";
import { formatTime } from "@/lib/time-rules";
import { visitorFetch } from "@/lib/visitor-api";

import { COMMANDS, isActive } from "./registry";

export function TypedCommandForm({
  meetingId,
  playhead,
}: {
  meetingId: string;
  playhead: Playhead;
}) {
  const router = useRouter();
  const toast = useToast();
  const sec = usePlayheadTime(playhead);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await visitorFetch<{ status: string }>(`/api/meetings/${meetingId}/commands`, {
        method: "POST",
        body: { text: text.trim(), atSec: sec },
      });
      setText("");
      toast(
        result.status === "detected"
          ? "AFK is drafting it; the card appears once it has been parsed"
          : result.status === "proposed"
            ? "Ready for your approval above"
            : "Added",
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Type a command">
      <label htmlFor="typed-command" className="text-sm font-medium">
        Didn&apos;t catch a command? Type it
      </label>
      <div className="flex gap-2">
        <input
          id="typed-command"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="/task for Sam: send the deck by Friday"
          maxLength={1000}
          autoComplete="off"
          aria-describedby="typed-command-help"
          aria-invalid={error !== null}
          className={inputClass("min-w-0 flex-1")}
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!text.trim()}>
          Add
        </Button>
      </div>
      <p id="typed-command-help" className={cn("text-xs", error ? "text-danger" : "text-fg-muted")}>
        {error ?? `Cited to the moment at ${formatTime(sec)}.`}
      </p>
    </form>
  );
}

export function WhatYouCanSay() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="-ml-3 text-accent-strong hover:text-accent-strong"
      >
        What you can say
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 text-fg-muted">
          {COMMANDS.filter(isActive).map((command) => (
            <li key={command.kind}>
              <span className="text-fg">&ldquo;{command.example}&rdquo;</span> {command.help}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
