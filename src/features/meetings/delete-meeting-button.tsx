"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { visitorFetch } from "@/lib/visitor-api";

/** Delete one of your own meetings, after a confirmation. Works mid-recording too. */
export function DeleteMeetingButton({ meetingId, title }: { meetingId: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${title}"? The recording, transcript, notes and every share link go with it.`,
      )
    )
      return;
    setBusy(true);
    try {
      await visitorFetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      toast("Meeting deleted");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setBusy(false);
      toast(error instanceof Error ? error.message : "The meeting couldn't be deleted.", "error");
    }
  };

  return (
    <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
      <Trash2 className="size-4" aria-hidden />
      Delete
    </Button>
  );
}
