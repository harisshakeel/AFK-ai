import type { Metadata } from "next";
import Link from "next/link";

import { LandingFooter } from "@/features/landing/landing-footer";
import { LandingNav } from "@/features/landing/landing-nav";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What AFK.ai stores, who can see it, and how long it is kept.",
  alternates: { canonical: "/privacy" },
};

/**
 * The privacy policy, in plain words, matching what the code does. Google's OAuth brand
 * verification requires one linked from the home page and the consent screen.
 */
const SECTIONS: ReadonlyArray<{ title: string; body: ReadonlyArray<string> }> = [
  {
    title: "What AFK.ai is",
    body: [
      "AFK.ai is a meeting notetaker: a bot joins a video call you send it to, records the call, and writes a transcript, a summary, decisions and action items. This page says what is stored, who can see it, and for how long. It was written to match the code, not the other way round.",
    ],
  },
  {
    title: "What is collected",
    body: [
      "You do not need an account. Your first highlight, tick or bot creates an anonymous identity in this browser (a guest workspace) so your meetings, highlights and tasks can be kept; it holds no personal data. Continuing with Google links that same identity to your Google account and gives AFK.ai your name and email address, nothing else.",
      "When you send the bot to a call, the video recording (kept by the bot provider, Attendee, and played from there through short-lived links), the transcript, the speakers' names as the platform shows them, and the notes written from them are stored for you. While the call is on, the bot's live transcript is kept only until the final transcript arrives, and for at most a day.",
      "The memory files on your Memory page hold what you write there and the lines AFK learns from your meetings. If you connect Gmail, Google Calendar or Slack, the access token is stored sealed with a key the database cannot read, and is deleted when you disconnect.",
    ],
  },
  {
    title: "Who can see it",
    body: [
      "Your meetings are private to you. A share link shows one clip and its lines, nothing else from the meeting, and you can turn it off at any time. Recordings are served only through short-lived links. The sample meetings are public recordings used with permission, credited on each page.",
      "Nothing leaves your accounts without your approval: an email, a calendar invite or a Slack post waits on the Tasks tab until you approve it, then goes out from your own account, once.",
    ],
  },
  {
    title: "Who processes it",
    body: [
      "The site runs on Vercel; the database and files on Supabase; the meeting bot is provided by Attendee, which joins the call, records it, keeps the recording and transcribes it; the notes are written by Claude, a model made by Anthropic, from the transcript and your memory files. Gmail, Google Calendar and Slack see only what you approve to send. There is no advertising and no third-party analytics.",
      "Google user data obtained through the Gmail and Calendar permissions is used only to send the emails and create the events you approve. It is not sold, not used for advertising, and not shared beyond the services named above. AFK.ai's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
    ],
  },
  {
    title: "How long it is kept, and how to delete it",
    body: [
      "A meeting and everything written from it is kept until you delete it from its page, which also tells Attendee to delete the call's recording and transcript. A guest workspace that never continued with Google is deleted thirty days after it was created, with its meetings, recordings, highlights and tasks. Memory files are kept until you edit or erase them; the Memory page's \"Forget everything\" erases all of them at once. Disconnecting an app on the Connectors page deletes its token. Live transcripts go when the final transcript arrives, or after a day.",
    ],
  },
  {
    title: "Contact",
    body: [
      "AFK.ai is built and run by Haris Shakeel. Questions about this policy reach the maintainer through harisshakeel.site.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <LandingNav />
      <main className="mx-auto max-w-3xl px-4 pt-14 pb-20 sm:px-6">
        <p className="font-mono text-[0.7rem] font-medium tracking-[0.14em] text-accent-strong uppercase">
          Privacy
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          What is kept, who sees it,{" "}
          <span className="font-sans font-semibold tracking-tight text-fg-muted">
            and for how long.
          </span>
        </h1>
        <p className="mt-4 text-sm text-fg-subtle">Last updated 16 October 2026.</p>
        <div className="mt-10 flex flex-col gap-10">
          {SECTIONS.map((section, index) => (
            // An id is one token: a title with spaces would name no element.
            <section key={section.title} aria-labelledby={`privacy-${index}`}>
              <h2 id={`privacy-${index}`} className="text-[1.15rem] font-semibold tracking-tight">
                {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-[0.95rem] leading-relaxed text-fg-muted">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-12 text-sm text-fg-muted">
          <Link href="/" className="font-medium text-accent-strong underline underline-offset-4">
            Back to the front page
          </Link>
        </p>
      </main>
      <LandingFooter />
    </>
  );
}
