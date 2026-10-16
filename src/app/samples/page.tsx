import type { Metadata } from "next";
import Link from "next/link";

import { Chrome } from "@/components/chrome";
import { SendBotLink } from "@/components/site-header";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import { MeetingList, SeedAttribution } from "@/features/meetings/meeting-list";
import { listMeetings } from "@/features/meetings/meeting-queries";

export const metadata: Metadata = {
  title: "Sample meetings",
  description:
    "Real recorded meetings, public for anyone to try AFK with: an hour-long call with eight people among them.",
  alternates: { canonical: "/samples" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The public sample meetings, for anyone: signed-out visitors reach them from the landing
 * page, and signed-in users, whose dashboard shows only their own meetings, find them here.
 */
export default async function SamplesPage({ searchParams }: Props) {
  const { after } = await searchParams;
  const { meetings, nextCursor } = await listMeetings("seed", { after });
  return (
    <Chrome actions={<SendBotLink />}>
      <PageTitle
        eyebrow="Samples"
        title="Sample meetings"
        lede="Real recorded meetings, public for anyone to try AFK with: an hour-long call with eight people among them."
        className="mb-8"
      />
      {meetings.length === 0 && !after ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <p className="font-medium">No sample meetings here yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            They&apos;re being loaded. Meanwhile, AFK can sit in one of your own calls.
          </p>
          <Link href="/send" className={buttonClass("primary", "sm", "mt-4")}>
            Send AFK to a meeting
          </Link>
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <p className="font-medium">No older meetings</p>
          <Link href="/samples" className={buttonClass("secondary", "md", "mt-5")}>
            Back to the newest
          </Link>
        </div>
      ) : (
        <MeetingList
          meetings={meetings}
          nextHref={nextCursor ? `/samples?after=${nextCursor}` : null}
        />
      )}
      <SeedAttribution />
    </Chrome>
  );
}
