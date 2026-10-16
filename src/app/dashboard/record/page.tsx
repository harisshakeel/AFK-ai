import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import { Reveal } from "@/components/ui/reveal";
import { afkRecord } from "@/features/meetings/afk-record";
import { AfkRecordPanel } from "@/features/meetings/afk-record-panel";
import { dashboardRecordInput } from "@/features/meetings/dashboard-queries";
import { getViewer, viewerFirstName } from "@/server/auth/viewer";

export const metadata: Metadata = {
  title: "Player card",
  robots: { index: false, follow: false },
};

/**
 * The full AFK record on a page of its own, so the dashboard stays about the meetings:
 * the level on its card, twelve weeks of calls, the action ring, the commands, the
 * streak, the longest calls and the badge album, every number counted from the user's
 * own rows (afk-record.ts). For anyone with a workspace, guests included; a visitor
 * without one is sent to the quest log, which says how to start.
 */
export default async function RecordPage() {
  const viewer = await getViewer();
  if (!viewer.userId) redirect("/dashboard");
  const input = await dashboardRecordInput(viewer.userId);
  const firstName = viewerFirstName(viewer);
  return (
    <AppShell
      viewer={viewer}
      actions={
        <Link href="/dashboard" className={buttonClass("secondary", "sm")}>
          <ArrowLeft aria-hidden />
          Quest log
        </Link>
      }
    >
      <Reveal>
        <PageTitle
          eyebrow="Stats"
          title="Player card"
          lede="Counted from your own quests, checkpoints, side quests and spells. Nothing estimated."
        />
      </Reveal>
      <AfkRecordPanel record={afkRecord(input)} input={input} firstName={firstName} />
    </AppShell>
  );
}
