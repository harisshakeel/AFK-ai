import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Chrome } from "@/components/chrome";
import { SendBotLink } from "@/components/site-header";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import { ConnectorsPanel } from "@/features/connectors/connectors-panel";
import { CONNECTOR_APPS } from "@/features/connectors/registry";
import { isGoogleSignInEnabled } from "@/server/auth/providers";
import { connectorSetup } from "@/server/connectors/config";
import { listConnectors } from "@/server/connectors/store";
import { getViewer } from "@/server/auth/viewer";

export const metadata: Metadata = {
  title: "Connectors",
  description: "The apps AFK may act through on your behalf: Gmail, Google Calendar and Slack.",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Connectors (requirements-v2 X1, X2, M8): the three apps AFK can act through, what
 * each may do, who it is connected as, and the way to connect or disconnect. A
 * connector belongs to a Google account: a guest sees the page locked, with the one
 * way to unlock it (guest mode). The database refuses them the rows too.
 */
export default async function ConnectorsPage({ searchParams }: Props) {
  const viewer = await getViewer();
  if (!viewer.userId || viewer.isAnonymous) {
    const signInEnabled = await isGoogleSignInEnabled();
    return (
      <Chrome actions={<SendBotLink />}>
        <>
          <PageTitle
            eyebrow="Connectors"
            title="What AFK may act through"
            lede="Gmail, Google Calendar and Slack: the apps AFK sends through once you approve a command. They connect to a Google account, so this page unlocks when you continue with Google."
            className="mb-8"
          />
          <section
            aria-label="Locked"
            className="rounded-2xl border border-dashed border-border-strong p-8 text-center"
          >
            <Lock className="mx-auto size-6 text-fg-subtle" aria-hidden />
            <p className="mt-3 font-display text-2xl font-medium tracking-tight">
              Connectors are for Google accounts
            </p>
            <p className="mx-auto mt-2 max-w-prose text-sm text-fg-muted">
              {CONNECTOR_APPS.map((app) => app.name).join(", ")} hold tokens for your own accounts,
              which a guest workspace cannot keep. Everything else works as a guest: the bot, the
              notes, the tasks, the clips.
            </p>
            {signInEnabled ? (
              <Link
                href="/sign-in?next=%2Fconnectors"
                className={buttonClass("primary", "md", "mt-6")}
              >
                Continue with Google
              </Link>
            ) : (
              <p className="mt-6 text-sm text-fg-subtle">
                Google sign-in isn&apos;t switched on for this deployment yet.
              </p>
            )}
          </section>
        </>
      </Chrome>
    );
  }
  const query = await searchParams;
  const [connectors, setup] = await Promise.all([
    listConnectors(),
    Promise.resolve(connectorSetup()),
  ]);
  return (
    <Chrome actions={<SendBotLink />}>
      <>
        <PageTitle
          eyebrow="Connectors"
          title="What AFK may act through"
          lede="Connect an app once. AFK uses it only for a command you approved on a meeting's Tasks tab, with the details you confirmed, and writes a line in your history file each time."
          className="mb-8"
        />
        <ConnectorsPanel
          connectors={connectors}
          configured={{
            google: Boolean(setup.google && setup.tokenKey),
            slack: Boolean(setup.slack && setup.tokenKey),
          }}
          notice={{
            connected: first(query.connected) ?? null,
            error: first(query.error) ?? null,
            partial: first(query.partial) === "1",
          }}
        />
      </>
    </Chrome>
  );
}
