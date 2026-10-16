"use client";

import { Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { visitorFetch } from "@/lib/visitor-api";

/** One email card to everyone on the call, from the stored notes, approved on the Tasks tab. */
export function ShareNotesButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      await visitorFetch(`/api/meetings/${meetingId}/share-notes`, { method: "POST" });
      toast("The notes are drafted as an email. Check the addresses and approve.");
      // The server renders the new card; the view follows ?tab= to the Tasks tab.
      router.push(`/meetings/${meetingId}?tab=tasks`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={() => void share()}>
      {!busy && <Share2 aria-hidden />}
      <span className="hidden sm:inline">Email the notes</span>
      <span className="sm:hidden">Email notes</span>
    </Button>
  );
}
