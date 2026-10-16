"use client";

import { Check, ExternalLink, Info, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TimestampButton } from "@/components/ui/timestamp-button";
import { useToast } from "@/components/ui/toast";
import type { AddressEntry } from "@/features/connectors/address-book";
import { isApprovableKind } from "@/features/connectors/approve-args";
import { appForKind, canApproveWith, type ConnectorView } from "@/features/connectors/registry";
import type { SkillSettings } from "@/features/memory/files";
import { cn } from "@/lib/cn";
import type { Playhead } from "@/lib/playhead";
import { formatTime } from "@/lib/time-rules";
import { visitorFetch } from "@/lib/visitor-api";

import {
  asString,
  asStrings,
  canRewrite,
  cardError,
  COMMAND_STATUS_LABEL,
  resultLink,
  resultSummary,
  type CommandView,
  type HostNote,
} from "./command-view";
import { DEMO_COMMANDS } from "./demo-cards";
import { commandSpec } from "./registry";
import { ApprovalForm } from "./approval-form";
import { EmailActions, isModelDraft, RewriteControl } from "./card-actions";
import { TypedCommandForm, WhatYouCanSay } from "./typed-command-form";

/**
 * The Tasks tab (requirements C4-C8): every command AFK heard or was typed, as a card
 * with the quoted sentence, its moment, what it did, and for the kinds that leave the
 * room a form to confirm the exact details (addresses, the time, the message) and
 * approve once. Visitors on a sample meeting see labelled example cards; nothing runs.
 */
type Props = {
  meetingId: string;
  isOwn: boolean;
  commands: ReadonlyArray<CommandView>;
  host: HostNote;
  speakers: ReadonlyArray<{ code: string; label: string }>;
  turnStart: ReadonlyMap<string, number>;
  onSeek: (sec: number) => void;
  playhead: Playhead;
  /** The owner's connected apps; empty for visitors. */
  connectors: ReadonlyArray<ConnectorView>;
  /** The owner's people file and learned contacts, to pre-fill recipients with a reason. */
  addressBook: ReadonlyArray<AddressEntry>;
  /** How the owner wants AFK to write for each app: copy, invite, length, channels. */
  skills: SkillSettings;
};

export function TasksTab(props: Props) {
  const { isOwn, host } = props;
  const commands = isOwn ? props.commands : DEMO_COMMANDS;
  const visible = commands.filter((command) => command.status !== "dismissed");

  return (
    <div className="flex flex-col gap-4">
      {!isOwn && (
        <p
          role="status"
          className="flex gap-2 rounded-md bg-accent-soft px-3 py-2.5 text-sm text-fg-muted"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
          <span>
            <span className="font-medium text-fg">Examples:</span> this is what AFK&apos;s cards
            look like. On your own meetings, say &ldquo;AFK, …&rdquo; during the call and the real
            ones appear here.
          </span>
        </p>
      )}
      {isOwn && <HostLine host={host} />}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong p-6 text-center">
          <Sparkles className="mx-auto size-5 text-fg-subtle" aria-hidden />
          <p className="mt-2 font-medium">No commands in this meeting</p>
          <p className="mt-1 text-sm text-fg-muted">
            Say &ldquo;AFK, decision: …&rdquo; or &ldquo;AFK, highlight that&rdquo; in the call, or
            type one below.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {visible.map((command) => (
            <CommandCard key={command.id} command={command} {...props} />
          ))}
        </ol>
      )}
      {isOwn && <TypedCommandForm meetingId={props.meetingId} playhead={props.playhead} />}
      <WhatYouCanSay />
    </div>
  );
}

function HostLine({ host }: { host: HostNote }) {
  if (!host.detectedBy) {
    return (
      <p className="text-xs text-fg-muted">
        AFK couldn&apos;t tell which speaker was you, so no spoken commands were taken. Typed ones
        still work, and{" "}
        <Link
          href="/memory?tab=profile.md&field=Name%20in%20calls"
          className="font-medium text-accent-strong underline decoration-accent/40 underline-offset-4"
        >
          your name in calls
        </Link>{" "}
        on your profile fixes this for next time.
      </p>
    );
  }
  return (
    <p className="text-xs text-fg-muted">
      Spoken commands were taken from <span className="font-medium text-fg">{host.label}</span>
      {host.detectedBy === "only" ? ", the only person who spoke." : ", matched to your name."}
    </p>
  );
}

const RETRY_SAFE_KINDS = new Set(["followup", "remind"]);

export function CommandCard({ command, ...props }: Props & { command: CommandView }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const label = command.kind === "unknown" ? "Not a command" : commandSpec(command.kind).label;
  const sec = command.turnId ? props.turnStart.get(command.turnId) : undefined;
  const warn = command.status === "unparsed" || command.status === "failed";
  const external = command.needsApproval && isApprovableKind(command.kind);
  const app = appForKind(command.kind);
  const ready = app ? canApproveWith(app, props.connectors) : true;
  const canRetry =
    command.status === "failed" &&
    external &&
    (command.executedAt === null || RETRY_SAFE_KINDS.has(command.kind));
  const canDismiss = !["done", "running", "dismissed"].includes(command.status);

  const change = async (action: "approve" | "dismiss") => {
    if (!props.isOwn) return;
    setBusy(action);
    try {
      await visitorFetch(`/api/commands/${command.id}`, { method: "POST", body: { action } });
      toast(action === "approve" ? "Approved" : "Dismissed");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't save.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-strong">
          {label}
        </span>
        <span className={cn("text-fg-muted", warn && "text-warning-strong")}>
          {COMMAND_STATUS_LABEL[command.status]}
        </span>
        {command.source === "typed" && <span className="text-fg-subtle">· typed</span>}
      </div>
      <p className="mt-2 text-[0.95rem] leading-snug">
        &ldquo;{command.sentence}&rdquo;
        {sec !== undefined && (
          <TimestampButton sec={sec} onSeek={props.onSeek} className="ml-1.5 align-[1px]" />
        )}
      </p>

      {external && command.status === "proposed" && isApprovableKind(command.kind) ? (
        <ApprovalForm
          command={command}
          kind={command.kind}
          isOwn={props.isOwn}
          ready={ready}
          appName={app?.name ?? ""}
          connectors={props.connectors}
          addressBook={props.addressBook}
          skills={props.skills}
          speakers={props.speakers}
          hostLabel={props.host.label}
          busy={busy !== null}
        />
      ) : (
        <CommandDetail command={command} speakers={props.speakers} />
      )}
      {command.status === "unparsed" &&
        isModelDraft(command.kind) &&
        props.isOwn &&
        canRewrite(command) && (
          <RewriteControl
            command={command}
            label="Add the details and let AFK try again"
            placeholder="e.g. to Sam Lee, about the launch plan, next Tuesday at three"
          />
        )}

      {cardError(command) && (
        <p className="mt-2 text-sm text-warning-strong">{cardError(command)}</p>
      )}
      {command.status === "failed" && external && !canRetry && (
        <p className="mt-1 text-xs text-fg-muted">
          This one isn&apos;t safe to run again on its own. Check the app, then type it again if it
          didn&apos;t happen.
        </p>
      )}

      {(canRetry || canDismiss) && command.status !== "proposed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canRetry && (
            <Button
              variant="primary"
              size="sm"
              loading={busy === "approve"}
              disabled={!props.isOwn || busy !== null || !ready}
              onClick={() => void change("approve")}
            >
              {busy !== "approve" && <RotateCcw aria-hidden />}
              Try again
            </Button>
          )}
          {command.kind === "email" && command.status === "approved" && (
            <EmailActions command={command} />
          )}
          {canDismiss && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy === "dismiss"}
              disabled={!props.isOwn || busy !== null}
              onClick={() => void change("dismiss")}
            >
              {busy !== "dismiss" && <X aria-hidden />}
              Dismiss
            </Button>
          )}
        </div>
      )}
      {command.status === "proposed" && canDismiss && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "dismiss"}
            disabled={!props.isOwn || busy !== null}
            onClick={() => void change("dismiss")}
            className="-ml-3"
          >
            {busy !== "dismiss" && <X aria-hidden />}
            Dismiss
          </Button>
        </div>
      )}
    </li>
  );
}

const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

function CommandDetail({
  command,
  speakers,
}: {
  command: CommandView;
  speakers: ReadonlyArray<{ code: string; label: string }>;
}) {
  const { args } = command;
  if (command.kind === "task" && command.status === "applied") {
    const ownerCode = asString(args.ownerSpeaker);
    const owner =
      (ownerCode && speakers.find((speaker) => speaker.code === ownerCode)?.label) ??
      asString(args.ownerName);
    return (
      <p className="mt-2 text-sm text-fg-muted">
        Task: <span className="text-fg">{asString(args.text)}</span>
        {" · "}
        {owner ? `owner ${owner}` : "no owner mentioned"}
        {asString(args.dueText) && ` · due ${asString(args.dueText)}`}
      </p>
    );
  }
  if ((command.kind === "decision" || command.kind === "note") && command.status === "applied") {
    return (
      <p className="mt-2 text-sm text-fg-muted">
        {command.kind === "decision" ? "Decision" : "Note"}:{" "}
        <span className="text-fg">{asString(args.text)}</span>
      </p>
    );
  }
  if (command.kind === "remember" && command.status === "applied") {
    return (
      <p className="mt-2 text-sm text-fg-muted">
        Remembered in <span className="text-fg">{asString(args.path) ?? "your memory"}</span>.
      </p>
    );
  }
  if (command.kind === "highlight" && command.status === "applied") {
    const start = asNumber(args.startSec);
    const end = asNumber(args.endSec);
    return (
      <p className="mt-2 text-sm text-fg-muted">
        Clip {start !== null && end !== null ? `${formatTime(start)} to ${formatTime(end)}` : ""},
        in the Highlights tab.
      </p>
    );
  }
  if (command.status === "done") {
    const summary = resultSummary(command.result);
    const link = resultLink(command.result);
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <Check className="size-4 text-success-strong" aria-hidden />
        <span className="text-fg">{summary ?? "Done"}</span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent-strong underline"
          >
            Open
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </p>
    );
  }
  if (
    command.approvedArgs &&
    (command.status === "approved" || command.status === "running" || command.status === "failed")
  ) {
    return <ApprovedSummary kind={command.kind} args={command.approvedArgs} />;
  }
  return null;
}

/** What was confirmed, read-only, while it runs or after it failed. */
function ApprovedSummary({ kind, args }: { kind: string; args: Record<string, unknown> }) {
  const when = asString(args.startsAt)?.replace("T", " ").slice(0, 16);
  return (
    <div className="mt-2 rounded-md bg-surface-raised p-3 text-sm text-fg-muted">
      {kind === "email" && (
        <>
          <p>
            To: <span className="text-fg">{asStrings(args.to).join(", ")}</span>
          </p>
          <p>
            Subject: <span className="text-fg">{asString(args.subject)}</span>
          </p>
        </>
      )}
      {kind === "followup" && (
        <p>
          <span className="text-fg">{asString(args.title)}</span> · {when} ·{" "}
          {asStrings(args.attendees).length} invited
        </p>
      )}
      {kind === "remind" && (
        <p>
          <span className="text-fg">{asString(args.text)}</span> · {when}
        </p>
      )}
      {kind === "slack" && (
        <p>
          #{asString(args.channelName)}: <span className="text-fg">{asString(args.message)}</span>
        </p>
      )}
    </div>
  );
}
