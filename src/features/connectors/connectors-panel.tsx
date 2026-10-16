"use client";

import { Check, CircleAlert, Gamepad2, Info, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatMeetingDate } from "@/lib/format-date";
import { visitorFetch } from "@/lib/visitor-api";

import { BRAND_MARKS } from "./brand-marks";
import {
  appReady,
  CONNECTOR_APPS,
  contactsAccess,
  type ConnectorApp,
  type ConnectorView,
} from "./registry";
import type { SlackChannel } from "./slack";

/**
 * The three app cards (requirements X1, X2): state, what AFK may do, connect or
 * disconnect, and for Slack the channel to post to. Gmail and Google Calendar share one
 * Google connection; each card says whether its own permission was granted.
 */
const ICONS = BRAND_MARKS;

const ERRORS: Record<string, string> = {
  denied: "You cancelled on the provider's screen. Nothing was connected.",
  state: "That connection attempt didn't start here, or took too long. Try again.",
  exchange: "The provider didn't finish the connection. Try again in a moment.",
  no_refresh: "Google sent no long-lived access. Try again and keep every box ticked.",
  scopes: "Google connected without Gmail or Calendar access. Reconnect and allow at least one.",
  setup: "This deployment hasn't been set up for that app yet.",
  provider: "Unknown app.",
};

export function ConnectorsPanel({
  connectors,
  configured,
  notice,
}: {
  connectors: ConnectorView[];
  configured: Record<"google" | "slack", boolean>;
  notice: { connected: string | null; error: string | null; partial: boolean };
}) {
  return (
    <div className="flex flex-col gap-6">
      {notice.connected && (
        <p role="status" className="flex gap-2 rounded-lg bg-success/12 px-3 py-2.5 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden />
          <span>
            {notice.connected === "google" ? "Google" : "Slack"} is connected.
            {notice.partial &&
              " Only one of Gmail and Calendar was allowed; reconnect to add the other."}
            {notice.connected === "slack" && " Choose the channel AFK should post to."}
          </span>
        </p>
      )}
      {notice.error && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger-strong"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{ERRORS[notice.error] ?? "Something went wrong connecting."}</span>
        </p>
      )}
      <ul className="grid gap-4 md:grid-cols-3">
        {CONNECTOR_APPS.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            connector={connectors.find((candidate) => candidate.provider === app.provider) ?? null}
            ready={appReady(app, connectors)}
            configured={configured[app.provider]}
          />
        ))}
      </ul>
      <p className="flex gap-2 text-xs leading-relaxed text-fg-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          AFK keeps one sealed token per app; the database alone cannot read it. Disconnect revokes
          it at the provider and deletes it. Nothing is sent, created or posted without your
          approval on the meeting&apos;s Tasks tab. While AFK&apos;s Google app is in testing,
          Google access lasts seven days before you reconnect.
        </span>
      </p>
    </div>
  );
}

function AppCard({
  app,
  connector,
  ready,
  configured,
}: {
  app: ConnectorApp;
  connector: ConnectorView | null;
  ready: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[app.id];
  const connected = connector?.status === "connected";
  const granted = connected && (app.provider === "slack" || connector.scopes.includes(app.scope));

  const disconnect = async () => {
    if (!connector) return;
    if (
      !confirm(
        `Disconnect ${app.provider === "google" ? "Google (Gmail and Calendar)" : app.name}? AFK will revoke its access.`,
      )
    )
      return;
    setBusy(true);
    try {
      await visitorFetch(`/api/connectors/${app.provider}`, { method: "DELETE" });
      toast("Disconnected");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={cardClass({ extra: "flex flex-col p-5" })}>
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-11 place-items-center rounded-xl border border-border bg-surface shadow-xs">
          <Icon className="size-6" />
        </span>
        {ready ? (
          <span
            className="grid size-8 place-items-center rounded-full bg-success/12 text-success-strong"
            title="Ready"
          >
            <Gamepad2 className="size-4" aria-hidden />
            <span className="sr-only">Ready</span>
          </span>
        ) : connector?.status === "expired" ? (
          <Badge tone="warning">Reconnect</Badge>
        ) : connected ? (
          <Badge tone="warning">
            {app.provider === "slack" ? "Choose a channel" : "Not allowed"}
          </Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">{app.name}</h2>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-fg-muted">{app.does}</p>
      <p className="mt-3 font-mono text-[0.7rem] text-fg-subtle">
        {app.commands.map((kind) => `/${kind}`).join("  ")}
      </p>

      {connector && connected && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-fg-muted">
          <dt>As</dt>
          <dd className="truncate text-fg" title={connector.account}>
            {connector.account}
          </dd>
          <dt>Since</dt>
          <dd className="text-fg">{formatMeetingDate(connector.connectedAt)}</dd>
          {connector.expiresHintAt && (
            <>
              <dt>Reconnect by</dt>
              <dd className="text-fg">{formatMeetingDate(connector.expiresHintAt)}</dd>
            </>
          )}
          {connector.lastUsedAt && (
            <>
              <dt>Last used</dt>
              <dd className="text-fg">{formatMeetingDate(connector.lastUsedAt)}</dd>
            </>
          )}
        </dl>
      )}
      {connected && !granted && app.provider === "google" && (
        <p className="mt-3 text-xs text-warning">
          Google is connected but {app.name} wasn&apos;t allowed. Reconnect and tick it.
        </p>
      )}
      {connector?.status === "expired" && (
        <p className="mt-3 text-xs text-warning">
          Google no longer accepts AFK&apos;s access. Reconnect.
        </p>
      )}

      {app.provider === "slack" && connected && connector && (
        <ChannelPicker connector={connector} />
      )}
      {app.id === "gmail" && connected && connector && <ContactsImport connector={connector} />}

      <div className="mt-5 flex flex-wrap gap-2">
        {!configured ? (
          <p className="text-xs text-fg-subtle">
            Not set up on this deployment yet: the owner adds the{" "}
            {app.provider === "google" ? "Google" : "Slack"} OAuth client.
          </p>
        ) : (
          <>
            <a
              href={`/connectors/${app.provider}/start`}
              className={buttonClass(
                "secondary",
                "sm",
                connected
                  ? "border-warning/60 bg-warning/15 text-fg hover:border-warning"
                  : "border-success/50 bg-success/12 text-success-strong hover:border-success",
              )}
            >
              {connected
                ? "Reconnect"
                : `Connect ${app.provider === "google" ? "Google" : "Slack"}`}
            </a>
            {connector && (
              <Button
                variant="outline-danger"
                size="sm"
                loading={busy}
                onClick={() => void disconnect()}
              >
                {!busy && <Unplug aria-hidden />}
                Disconnect
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The people AFK may learn from Google: the saved contacts and the people the host
 * writes to, imported on request once the connection allows it (two more boxes on the
 * consent screen); an older connection is told to reconnect.
 */
function ContactsImport({ connector }: { connector: ConnectorView }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const access = contactsAccess([connector]);
  if (!access.saved && !access.others) {
    return (
      <p className="mt-3 text-xs text-fg-muted">
        Reconnect Google and tick the two contacts boxes, and AFK can import the people you write
        to.
      </p>
    );
  }
  const run = async () => {
    setBusy(true);
    try {
      const counts = await visitorFetch<{ saved: number; others: number }>(
        "/api/connectors/google/contacts",
        { method: "POST" },
      );
      const total = counts.saved + counts.others;
      toast(
        total === 0
          ? "Google had nobody new for AFK to learn."
          : `AFK now knows ${total} ${total === 1 ? "person" : "people"} from Google.`,
      );
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void run()}>
        Import Google contacts
      </Button>
      <p className="mt-1.5 text-xs text-fg-subtle">
        Names and addresses only, read once; they fill in the To field as a best guess with the
        reason shown. Manage them on the Memory page.
      </p>
    </div>
  );
}

function ChannelPicker({ connector }: { connector: ConnectorView }) {
  const router = useRouter();
  const toast = useToast();
  const current = typeof connector.config.channelId === "string" ? connector.config.channelId : "";
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    visitorFetch<{ channels: SlackChannel[] }>("/api/connectors/slack/channels", { method: "GET" })
      .then((result) => {
        if (!cancelled) setChannels(result.channels);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const channel = channels?.find((candidate) => candidate.id === choice);
    if (!channel) return;
    setSaving(true);
    try {
      await visitorFetch("/api/connectors/slack", {
        method: "PATCH",
        body: { channelId: channel.id, channelName: channel.name },
      });
      toast(`AFK posts to #${channel.name}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't save.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4">
      <label htmlFor="slack-channel" className="text-xs font-medium">
        Channel AFK posts to
      </label>
      <div className="mt-1.5 flex gap-2">
        <select
          id="slack-channel"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={channels === null}
          className={cn(
            "h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm shadow-key focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60",
          )}
        >
          <option value="">
            {channels === null
              ? failed
                ? "Couldn't list channels"
                : "Loading…"
              : "Pick a channel"}
          </option>
          {(channels ?? []).map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={!choice || choice === current}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
