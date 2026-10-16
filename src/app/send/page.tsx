import type { Metadata } from "next";

import { Chrome } from "@/components/chrome";
import { Eyebrow } from "@/components/ui/badge";
import { PageTitle } from "@/components/ui/page-title";
import { SendBotForm } from "@/features/capture/send-bot-form";
import { COMMANDS, isActive } from "@/features/commands/registry";
import { serverEnv } from "@/lib/env";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { getViewer } from "@/server/auth/viewer";

export const metadata: Metadata = {
  title: "Send AFK to a meeting",
  description:
    "Paste a Zoom, Google Meet or Teams link. AFK joins, records the call, and has the summary, action items and transcript ready shortly after it ends.",
  alternates: { canonical: "/send" },
};

/**
 * Send AFK to a meeting (requirement F9). Anyone sends the real bot (guest mode):
 * a guest's first send creates their workspace, and the meeting is private
 * to it. A labelled demo of the steps is one button away for anyone who wants to look
 * before sending. On a wide screen the form sits on the left and what you can say in
 * the call on the right; on a phone they stack.
 */
export default async function SendPage() {
  const [viewer, signInEnabled] = await Promise.all([getViewer(), isGoogleSignInEnabled()]);
  const env = serverEnv();
  const botConfigured = Boolean(env.ATTENDEE_API_KEY && env.ATTENDEE_WEBHOOK_SECRET);
  const mode = botConfigured ? "live" : "unconfigured";
  const guest = viewer.isAnonymous;

  return (
    <Chrome>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <PageTitle
            eyebrow="Send"
            title="Send AFK to a meeting"
            lede="Paste a Zoom, Google Meet or Teams link. AFK joins as “AFK.ai Notetaker”, records the call, and has the summary, action items and transcript ready shortly after it ends."
          />
          <SendBotForm mode={mode} guest={guest} signInAvailable={signInEnabled} />
        </div>
        <section aria-labelledby="what-you-can-say" className="lg:pt-1">
          <Eyebrow>In the call</Eyebrow>
          <h2 id="what-you-can-say" className="mt-2 font-display text-2xl tracking-tight">
            What you can say in the call
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            AFK listens for its name. Start a sentence with &ldquo;AFK&rdquo; and it does the rest
            after the call: explicit items go straight into the notes, and anything that would leave
            the meeting waits for your approval on the Tasks tab. Only the words of the person who
            sent it count.
          </p>
          <ul className="mt-5 flex flex-col gap-2">
            {COMMANDS.filter(isActive).map((command) => (
              <li
                key={command.kind}
                className="flex gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-xs"
              >
                <span className="mt-0.5 shrink-0 font-mono text-[0.72rem] text-accent-strong">
                  {command.slash}
                </span>
                <div>
                  <p className="font-medium">&ldquo;{command.example}&rdquo;</p>
                  <p className="mt-0.5 text-fg-muted">
                    {command.help}
                    {command.needsApproval && " Nothing is sent until you approve it."}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Chrome>
  );
}
