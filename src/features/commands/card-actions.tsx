"use client";

import { ClipboardCopy, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { visitorFetch } from "@/lib/visitor-api";

import { asString, type CommandView } from "./command-view";

/** The kinds the model drafts, so a draft can be sent back with a note. */
export function isModelDraft(kind: string): boolean {
  return kind === "email" || kind === "followup" || kind === "remind";
}

/** A draft sent back to AFK with a note; the card returns rewritten after the parse. */
export function RewriteControl({
  command,
  label,
  placeholder,
}: {
  command: CommandView;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await visitorFetch(`/api/commands/${command.id}/rewrite`, {
        method: "POST",
        body: { note: note.trim() },
      });
      toast("AFK is writing it again. The card comes back in a moment.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't send.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-accent-strong underline decoration-accent/40 underline-offset-2"
        >
          {label}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends the note back. It stops here: this field sits inside the approval
          // form, where Cmd/Ctrl+Enter would approve and send the draft being rewritten.
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          void send();
        }}
        placeholder={placeholder}
        maxLength={300}
        aria-label="What should change"
        className={inputClass("h-9 min-w-0 flex-1")}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={() => void send()}
      >
        Send back
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

export function EmailActions({
  command,
  subject,
  body,
}: {
  command: CommandView;
  subject?: string;
  body?: string;
}) {
  const toast = useToast();
  const source = command.approvedArgs ?? command.args;
  const finalSubject = subject ?? asString(source.subject) ?? "";
  const finalBody = body ?? asString(source.body) ?? "";
  const mailto = `mailto:?subject=${encodeURIComponent(finalSubject)}&body=${encodeURIComponent(finalBody)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${finalSubject}\n\n${finalBody}`);
      toast("Draft copied");
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", "error");
    }
  };
  return (
    <>
      <a href={mailto} className={buttonClass("secondary", "sm")}>
        <Mail aria-hidden />
        Open in Mail
      </a>
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        <ClipboardCopy aria-hidden />
        Copy draft
      </Button>
    </>
  );
}
