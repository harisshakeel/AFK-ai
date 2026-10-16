"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { visitorFetch } from "@/lib/visitor-api";

/** One email card to everyone on the call, from the stored notes, approved on the Tasks tab. */
export function ShareNotesButton({ meetingId }: { meetingId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      await visitorFetch(`/api/meetings/${meetingId}/share-notes`, { method: "POST" });
      toast("The notes are drafted as an email. Check the addresses and approve.");
      // A full load: the view keeps its tab in state, so only a fresh page opens on Tasks
      // with the new card in it.
      window.location.assign(`/meetings/${meetingId}?tab=tasks`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={() => void share()}>
      {!busy && <Share2 aria-hidden />}
      <span className="hidden sm:inline">Share the notes</span>
      <span className="sm:hidden">Share</span>
    </Button>
  );
}
