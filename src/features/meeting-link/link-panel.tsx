"use client";

import { Check, ClipboardCopy, Link2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { visitorFetch } from "@/lib/visitor-api";

import { linkMessage, linkUrl, type OwnerLink } from "./link-code";

/**
 * The owner's view of a meeting's address (2026-10-16): the link and its PIN, both to
 * copy, a switch to turn the link off and on, and a new link when the old one has gone
 * too far. Only the owner ever sees the PIN.
 */
export function LinkPanel({ meetingId, link }: { meetingId: string; link: OwnerLink }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const url = linkUrl(origin, link.code);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.", "error");
    }
  };

  const act = async (action: "rotate" | "on" | "off") => {
    if (
      action === "rotate" &&
      !window.confirm("Make a new link and PIN? The old ones stop working.")
    ) {
      return;
    }
    setBusy(true);
    try {
      await visitorFetch(`/api/meetings/${meetingId}/link`, { method: "POST", body: { action } });
      toast(
        action === "rotate" ? "New link and PIN" : action === "on" ? "Link is on" : "Link is off",
      );
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't save.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group relative">
      <summary
        className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg [&::-webkit-details-marker]:hidden"
        aria-label="Share this meeting"
      >
        <Link2 className="size-4" aria-hidden />
        Share
        <span
          className={cn("size-2 rounded-full", link.enabled ? "bg-success-strong" : "bg-fg-subtle")}
          aria-hidden
        />
      </summary>
      <div className="fixed inset-x-4 top-16 z-20 rounded-xl border border-border bg-surface p-4 shadow-md sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96">
        <p className="text-sm font-medium">Anyone with the link and the PIN</p>
        <p className="mt-1 text-xs text-fg-muted">
          They see the recording, the transcript and the summary, read-only. Tasks, approvals, email
          and calendar actions, your memory files and your connected apps are yours alone and never
          reachable from the link.
        </p>
        <label
          className="mt-3 block text-xs font-medium text-fg-muted"
          htmlFor={`link-${link.code}`}
        >
          Link
        </label>
        <input
          id={`link-${link.code}`}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-1 h-9 w-full rounded-md border border-border bg-canvas px-2.5 font-mono text-xs"
        />
        <p className="mt-3 text-xs font-medium text-fg-muted">PIN</p>
        <p className="mt-1 font-mono text-2xl tracking-[0.3em]" aria-label={`PIN ${link.pin}`}>
          {link.pin}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void copy(url, "Link")}>
            <ClipboardCopy aria-hidden />
            Copy link
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copy(linkMessage(url, link.pin), "Link and PIN")}
          >
            <Check aria-hidden />
            Copy link and PIN
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void act(link.enabled ? "off" : "on")}
            disabled={busy}
          >
            {link.enabled ? "Turn the link off" : "Turn the link on"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void act("rotate")} disabled={busy}>
            <RefreshCw aria-hidden />
            New link and PIN
          </Button>
        </div>
      </div>
    </details>
  );
}
