import type { Metadata } from "next";
import Link from "next/link";

import { Chrome } from "@/components/chrome";
import { SendBotLink } from "@/components/site-header";
import { PageTitle } from "@/components/ui/page-title";
import { renderToolsMd } from "@/features/connectors/tools-md";
import { contextTemplate, isMemoryPath, profileFromAnswers } from "@/features/memory/files";
import { ContactsList } from "@/features/memory/contacts-list";
import { MemoryPage } from "@/features/memory/memory-page";
import { listMemoryFiles, type MemoryFileRow } from "@/features/memory/memory-queries";
import { getViewer } from "@/server/auth/viewer";
import { listConnectors, listContacts } from "@/server/connectors/store";

export const metadata: Metadata = {
  title: "Memory",
  description:
    "What AFK knows about you: your profile, your people, projects and words, and what it did.",
  robots: { index: false, follow: false },
};

/**
 * Memory (requirement M6): what AFK knows about you, as files you can read, edit,
 * download and erase. Signed out, a labelled demo shows what it looks like.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MemoryRoute({ searchParams }: Props) {
  const query = await searchParams;
  // A link may open a tab with a field focused: the checklist's "Name in calls".
  const tabParam = typeof query.tab === "string" ? query.tab : "";
  const initialTab = isMemoryPath(tabParam) ? tabParam : "profile.md";
  const focusField = typeof query.field === "string" ? query.field.slice(0, 40) : null;
  const viewer = await getViewer();
  const signedIn = Boolean(viewer.userId && !viewer.isAnonymous);
  const [files, connectors, contacts] = signedIn
    ? await Promise.all([listMemoryFiles(), listConnectors(), listContacts()])
    : [demoFiles(), [], []];
  const toolsMd = renderToolsMd(connectors);
  return (
    <Chrome actions={<SendBotLink />}>
      <>
        <PageTitle
          eyebrow="Memory"
          title="What AFK knows about you"
          lede={
            signedIn ? (
              <>
                Nine Markdown files, yours to read and edit, and a Tools file rendered from your
                connectors: who you are, your people, projects and words, how AFK should write for
                each app, and what it did. AFK reads them before every meeting it works on for you
                and adds what it learns below the rule. Say &ldquo;AFK, remember: &hellip;&rdquo; in
                a call to add a line from there.
              </>
            ) : (
              <>
                A demo of the files AFK keeps for signed-in people.{" "}
                <Link
                  href="/sign-in?next=%2Fmemory"
                  className="font-medium text-accent-strong underline"
                >
                  Sign in
                </Link>{" "}
                to have your own.
              </>
            )
          }
          className="mb-8"
        />
        <MemoryPage
          files={files}
          toolsMd={toolsMd}
          demo={!signedIn}
          initialTab={initialTab}
          focusField={focusField}
        />
        {signedIn && <ContactsList contacts={contacts} />}
      </>
    </Chrome>
  );
}

/** The demo a visitor sees: the templates with an invented, clearly labelled person. */
function demoFiles(): MemoryFileRow[] {
  const at = "2026-10-16T09:00:00.000Z";
  return [
    {
      path: "profile.md",
      content: profileFromAnswers(
        { name: "Demo User", email: "demo@example.com" },
        {
          callMe: "Demo",
          roleAndCompany: "Product lead at Example Co (this is a demo profile)",
          meetingsAre: "Team syncs",
          notesStyle: "Decisions first",
          wantMost: "Catch the action items I'd otherwise forget",
          timezone: "Asia/Karachi",
          language: "en",
        },
      ),
      updatedBy: "you",
      updatedAt: at,
    },
    {
      path: "context/people.md",
      content: contextTemplate("context/people.md"),
      updatedBy: "you",
      updatedAt: at,
    },
    {
      path: "context/projects.md",
      content: contextTemplate("context/projects.md"),
      updatedBy: "you",
      updatedAt: at,
    },
    {
      path: "context/glossary.md",
      content: contextTemplate("context/glossary.md"),
      updatedBy: "you",
      updatedAt: at,
    },
    {
      path: "history/meetings.md",
      content:
        "- [2026-10-16] Example weekly sync: Launch date agreed; deck owner named. (2 open action items)\n",
      updatedBy: "afk",
      updatedAt: at,
    },
    { path: "history/actions.md", content: "", updatedBy: "afk", updatedAt: at },
    ...(["skills/email.md", "skills/slack.md", "skills/calendar.md"] as const).map((path) => ({
      path,
      content: contextTemplate(path),
      updatedBy: "you" as const,
      updatedAt: at,
    })),
  ];
}
