"use client";

import {
  Check,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  Info,
  Mail,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { TimestampButton } from "@/components/ui/timestamp-button";
import { useToast } from "@/components/ui/toast";
import type { AddressEntry } from "@/features/connectors/address-book";
import {
  expandEveryone,
  suggestedAddresses,
  suggestRecipients,
  withSaidAddresses,
} from "@/features/connectors/address-book";
import {
  APPROVED_SCHEMAS,
  browserOffset,
  inputValueToIso,
  isApprovableKind,
  isoToInputValue,
  offsetOf,
  splitAddresses,
  type ApprovableKind,
} from "@/features/connectors/approve-args";
import { appForKind, appReady, type ConnectorView } from "@/features/connectors/registry";
import type { SlackChannel } from "@/features/connectors/slack";
import { channelForTopic, type SkillSettings } from "@/features/memory/files";
import { cn } from "@/lib/cn";
import { usePlayheadTime, type Playhead } from "@/lib/playhead";
import { formatTime } from "@/lib/time-rules";
import { ApiError, visitorFetch } from "@/lib/visitor-api";

import {
  COMMAND_STATUS_LABEL,
  resultLink,
  resultSummary,
  type CommandView,
  type HostNote,
} from "./command-view";
import { DEMO_COMMANDS } from "./demo-cards";
import { COMMANDS, commandSpec, isActive } from "./registry";

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
  const ready = app ? appReady(app, props.connectors) : true;
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
        <span className={cn("text-fg-muted", warn && "text-warning")}>
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
      {command.status === "unparsed" && isModelDraft(command.kind) && props.isOwn && (
        <RewriteControl
          command={command}
          label="Add the details and let AFK try again"
          placeholder="e.g. to Sam Lee, about the launch plan, next Tuesday at three"
        />
      )}

      {command.error && <p className="mt-2 text-sm text-warning">{command.error}</p>}
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

const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);
const asStrings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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

const fieldLabel = "text-xs font-medium text-fg-muted";

/**
 * The details an adapter will run with, pre-filled from what AFK heard, the owner's
 * people file and learned contacts (each with its reason), and the owner's skills
 * (who to copy or invite, the default length, the channel), checked by the kind's
 * schema before they are sent. Nothing is filled silently: a guessed address shows
 * why, the other matches are one click away, an unknown name says so.
 */
function ApprovalForm({
  command,
  kind,
  isOwn,
  ready,
  appName,
  connectors,
  addressBook,
  skills,
  speakers,
  hostLabel,
  busy,
}: {
  command: CommandView;
  kind: ApprovableKind;
  isOwn: boolean;
  ready: boolean;
  appName: string;
  connectors: ReadonlyArray<ConnectorView>;
  addressBook: ReadonlyArray<AddressEntry>;
  skills: SkillSettings;
  speakers: ReadonlyArray<{ code: string; label: string }>;
  hostLabel: string | null;
  busy: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { args } = command;
  const heardNames = expandEveryone(
    command.sentence,
    asStrings(kind === "followup" ? args.attendeeNames : args.toNames),
    speakers.map((speaker) => speaker.label),
    hostLabel,
  );
  // An address said in the call, grounded against the transcript, comes before any guess.
  const said = kind === "email" ? asStrings(args.toAddresses) : [];
  const suggestions = withSaidAddresses(suggestRecipients(heardNames, addressBook), said);
  const slack = connectors.find((connector) => connector.provider === "slack");
  const defaultChannelId = asString(slack?.config.channelId);
  const defaultChannelName = asString(slack?.config.channelName);
  const alwaysInvite = splitAddresses(skills.calendar["always invite"] ?? "");
  const skillMinutes = minutesIn(skills.calendar["default length"]);

  const [to, setTo] = useState(() =>
    [...suggestedAddresses(suggestions), ...(kind === "followup" ? alwaysInvite : [])]
      .filter((email, index, all) => all.indexOf(email) === index)
      .join(", "),
  );
  const [cc, setCc] = useState(() => splitAddresses(skills.email["always copy"] ?? "").join(", "));
  const [subject, setSubject] = useState(asString(args.subject) ?? "");
  const [body, setBody] = useState(asString(args.body) ?? "");
  const [title, setTitle] = useState(asString(args.title) ?? "");
  const [when, setWhen] = useState(() => isoToInputValue(asString(args.startsAt)));
  const [duration, setDuration] = useState(
    String(asNumber(args.durationMin) ?? skillMinutes ?? 30),
  );
  const [text, setText] = useState(asString(args.text) ?? "");
  const [message, setMessage] = useState(asString(args.message) ?? "");
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [channel, setChannel] = useState<{ id: string; name: string } | null>(() =>
    defaultChannelId && defaultChannelName
      ? { id: defaultChannelId, name: defaultChannelName }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [needsConnect, setNeedsConnect] = useState(false);

  // A Slack card lists the workspace's channels once, so the topic can pick one; the
  // skill's "topic: #channel" lines decide, else the channel chosen on Connectors.
  useEffect(() => {
    if (kind !== "slack" || !isOwn || !slack || slack.status !== "connected") return;
    let cancelled = false;
    visitorFetch<{ channels: SlackChannel[] }>("/api/connectors/slack/channels", { method: "GET" })
      .then((result) => {
        if (cancelled) return;
        setChannels(result.channels);
        const wanted = channelForTopic(message, skills.slack);
        const found = wanted
          ? result.channels.find((candidate) => candidate.name.toLowerCase() === wanted)
          : undefined;
        if (found) setChannel({ id: found.id, name: found.name });
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      });
    return () => {
      cancelled = true;
    };
    // The suggestion is made once, from the draft as it arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isOwn, slack?.status]);

  // Unique per instance: the same card can show on the page and in the wrap-up at once.
  const uid = useId();
  const idFor = (field: string) => `cmd${uid}${field}`;
  const whenHint = asString(args.whenText);
  const durations = [15, 30, 45, 60, 90, 120];
  if (skillMinutes && !durations.includes(skillMinutes)) durations.push(skillMinutes);
  durations.sort((a, b) => a - b);

  const pickAddress = (name: string, email: string) => {
    const current = splitAddresses(to);
    const own = suggestions.find((suggestion) => suggestion.name === name);
    const without = current.filter(
      (address) =>
        address !== own?.email && !own?.alternatives.some((alt) => alt.email === address),
    );
    setTo([...without, email].join(", "));
  };

  const build = (): unknown => {
    const offset = offsetOf(asString(args.startsAt)) ?? browserOffset();
    switch (kind) {
      case "email":
        return { to: splitAddresses(to), cc: splitAddresses(cc), subject, body };
      case "followup":
        return {
          title,
          startsAt: inputValueToIso(when, offset) ?? "",
          durationMin: Number(duration),
          attendees: splitAddresses(to),
          description: null,
        };
      case "remind":
        return { text, startsAt: inputValueToIso(when, offset) ?? "" };
      case "slack":
        return { channelId: channel?.id ?? "", channelName: channel?.name ?? "", message };
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isOwn || sending) return;
    const parsed = APPROVED_SCHEMAS[kind].safeParse(build());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0];
      setError(
        field === "to" || field === "attendees"
          ? "Add at least one valid email address."
          : field === "cc"
            ? "Check the addresses to copy."
            : field === "startsAt"
              ? "Pick a date and time."
              : field === "channelId"
                ? "Pick a channel."
                : (issue?.message ?? "Check the details."),
      );
      return;
    }
    setError(null);
    setSending(true);
    try {
      await visitorFetch(`/api/commands/${command.id}`, {
        method: "POST",
        body: { action: "approve", args: parsed.data },
      });
      toast("Approved. AFK runs it next.");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && /connect/i.test(caught.message)) {
        setNeedsConnect(true);
      }
      setError(caught instanceof Error ? caught.message : "That didn't save.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-md bg-surface-raised p-3">
      {(kind === "email" || kind === "followup") && (
        <div>
          <label htmlFor={idFor("to")} className={fieldLabel}>
            {kind === "email" ? "To" : "Invite"}
          </label>
          {suggestions.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 text-xs" aria-label="Who AFK heard">
              {suggestions.map((suggestion) => (
                <li key={suggestion.name} className="flex flex-wrap items-center gap-x-1.5">
                  <span className="font-medium text-fg">{suggestion.name}</span>
                  {suggestion.email ? (
                    <>
                      <span className="text-fg-muted">→ {suggestion.email}</span>
                      <span className="text-fg-subtle">({suggestion.reason})</span>
                      {suggestion.alternatives.map((alternative) => (
                        <button
                          key={alternative.email}
                          type="button"
                          onClick={() => pickAddress(suggestion.name, alternative.email)}
                          className="text-accent-strong underline decoration-accent/40 underline-offset-2"
                          title={alternative.reason}
                        >
                          or {alternative.email}
                        </button>
                      ))}
                    </>
                  ) : (
                    <span className="text-fg-subtle">no address yet, add it below</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            id={idFor("to")}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder={
              kind === "email"
                ? "name@example.com, other@example.com"
                : "Addresses, comma separated (optional)"
            }
            autoComplete="off"
            className={inputClass("mt-1 h-9")}
            disabled={!isOwn}
          />
          {kind === "email" && to.trim() === "" && suggestions.length === 0 && (
            <p className="mt-1 text-xs text-fg-subtle">
              Add the address. AFK remembers it for next time once you approve.
            </p>
          )}
        </div>
      )}
      {kind === "email" && (
        <>
          <div>
            <label htmlFor={idFor("cc")} className={fieldLabel}>
              Copy
              {skills.email["always copy"] && (
                <span className="font-normal text-fg-subtle"> · from your email skill</span>
              )}
            </label>
            <input
              id={idFor("cc")}
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              placeholder="Addresses to copy, comma separated (optional)"
              autoComplete="off"
              className={inputClass("mt-1 h-9")}
              disabled={!isOwn}
            />
          </div>
          <div>
            <label htmlFor={idFor("subject")} className={fieldLabel}>
              Subject
            </label>
            <input
              id={idFor("subject")}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={120}
              className={inputClass("mt-1 h-9")}
              disabled={!isOwn}
            />
          </div>
          <div>
            <label htmlFor={idFor("body")} className={fieldLabel}>
              Message
            </label>
            <textarea
              id={idFor("body")}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              onKeyDown={submitOnCommandEnter}
              maxLength={5000}
              className={inputClass("mt-1 h-auto resize-y rounded-xl py-2 leading-relaxed")}
              disabled={!isOwn}
            />
          </div>
        </>
      )}
      {kind === "followup" && (
        <div>
          <label htmlFor={idFor("title")} className={fieldLabel}>
            Title
          </label>
          <input
            id={idFor("title")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            className={inputClass("mt-1 h-9")}
            disabled={!isOwn}
          />
        </div>
      )}
      {kind === "remind" && (
        <div>
          <label htmlFor={idFor("text")} className={fieldLabel}>
            Remind you to
          </label>
          <input
            id={idFor("text")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            className={inputClass("mt-1 h-9")}
            disabled={!isOwn}
          />
        </div>
      )}
      {(kind === "followup" || kind === "remind") && (
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={idFor("when")} className={fieldLabel}>
              When
              {whenHint && (
                <span className="font-normal text-fg-subtle"> · AFK heard: {whenHint}</span>
              )}
            </label>
            <input
              id={idFor("when")}
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className={inputClass("mt-1 h-9")}
              disabled={!isOwn}
            />
          </div>
          {kind === "followup" && (
            <div>
              <label htmlFor={idFor("duration")} className={fieldLabel}>
                Length
              </label>
              <select
                id={idFor("duration")}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                className={inputClass("mt-1 h-9 w-auto")}
                disabled={!isOwn}
              >
                {durations.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {kind === "slack" && (
        <>
          <div>
            <label htmlFor={idFor("channel")} className={fieldLabel}>
              Channel
            </label>
            {channels && channels.length > 0 ? (
              <select
                id={idFor("channel")}
                value={channel?.id ?? ""}
                onChange={(event) => {
                  const picked = channels.find((candidate) => candidate.id === event.target.value);
                  setChannel(picked ? { id: picked.id, name: picked.name } : null);
                }}
                className={inputClass("mt-1 h-9 w-auto")}
                disabled={!isOwn}
              >
                {!channel && <option value="">Pick a channel</option>}
                {channels.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    #{candidate.name}
                  </option>
                ))}
              </select>
            ) : channel ? (
              <p className="mt-1 text-sm">
                <span className="font-medium">#{channel.name}</span>
                <span className="text-xs text-fg-subtle"> · chosen on the Connectors page</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-fg-muted">
                <Link href="/connectors" className="font-medium text-accent-strong underline">
                  Choose a channel on the Connectors page
                </Link>
              </p>
            )}
          </div>
          <div>
            <label htmlFor={idFor("message")} className={fieldLabel}>
              Message
            </label>
            <textarea
              id={idFor("message")}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              onKeyDown={submitOnCommandEnter}
              maxLength={2000}
              className={inputClass("mt-1 h-auto resize-y rounded-xl py-2 leading-relaxed")}
              disabled={!isOwn}
            />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
          {needsConnect && (
            <>
              {" "}
              <Link href="/connectors" className="font-medium underline">
                Open Connectors
              </Link>
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ready || !isOwn ? (
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={sending}
            disabled={!isOwn || busy}
          >
            {!sending && <Check aria-hidden />}
            Approve and {kind === "email" ? "send" : kind === "slack" ? "post" : "add to calendar"}
          </Button>
        ) : (
          <Link href="/connectors" className={buttonClass("primary", "sm")}>
            Connect {appName} to approve
          </Link>
        )}
        {kind === "email" && <EmailActions command={command} subject={subject} body={body} />}
      </div>
      {isOwn && isModelDraft(kind) && (
        <RewriteControl
          command={command}
          label="Rewrite"
          placeholder="What should change? e.g. shorter, more formal, mention the Friday date"
        />
      )}
      <p className="text-xs text-fg-subtle">
        AFK runs exactly these details, once, writes a line in your history file, and remembers the
        people you confirmed. Enter in a field, or ⌘/Ctrl+Enter in the message, approves.
      </p>
    </form>
  );
}

/** In a message box, Enter makes a new line; with the command or control key it approves. */
function submitOnCommandEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

/** The kinds the model drafts, so a draft can be sent back with a note. */
function isModelDraft(kind: string): boolean {
  return kind === "email" || kind === "followup" || kind === "remind";
}

/** "30 minutes" or "45" from a skill line, as minutes. */
function minutesIn(value: string | undefined): number | null {
  const match = /(\d{1,3})/.exec(value ?? "");
  const minutes = match ? Number(match[1]) : NaN;
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 240 ? minutes : null;
}

/** A draft sent back to AFK with a note; the card returns rewritten after the parse. */
function RewriteControl({
  command,
  label,
  placeholder,
}: {
  command: CommandView;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await visitorFetch(`/api/commands/${command.id}/rewrite`, {
        method: "POST",
        body: { note: note.trim() },
      });
      toast("AFK is writing it again. The card comes back in a moment.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't send.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-accent-strong underline decoration-accent/40 underline-offset-2"
        >
          {label}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={placeholder}
        maxLength={300}
        aria-label="What should change"
        className={inputClass("h-9 min-w-0 flex-1")}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={() => void send()}
      >
        Send back
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function EmailActions({
  command,
  subject,
  body,
}: {
  command: CommandView;
  subject?: string;
  body?: string;
}) {
  const toast = useToast();
  const source = command.approvedArgs ?? command.args;
  const finalSubject = subject ?? asString(source.subject) ?? "";
  const finalBody = body ?? asString(source.body) ?? "";
  const mailto = `mailto:?subject=${encodeURIComponent(finalSubject)}&body=${encodeURIComponent(finalBody)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${finalSubject}\n\n${finalBody}`);
      toast("Draft copied");
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", "error");
    }
  };
  return (
    <>
      <a href={mailto} className={buttonClass("secondary", "sm")}>
        <Mail aria-hidden />
        Open in Mail
      </a>
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        <ClipboardCopy aria-hidden />
        Copy draft
      </Button>
    </>
  );
}

function TypedCommandForm({ meetingId, playhead }: Pick<Props, "meetingId" | "playhead">) {
  const router = useRouter();
  const toast = useToast();
  const sec = usePlayheadTime(playhead);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await visitorFetch<{ status: string }>(`/api/meetings/${meetingId}/commands`, {
        method: "POST",
        body: { text: text.trim(), atSec: sec },
      });
      setText("");
      toast(
        result.status === "detected"
          ? "AFK is drafting it; the card appears once it has been parsed"
          : result.status === "proposed"
            ? "Ready for your approval above"
            : "Added",
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Type a command">
      <label htmlFor="typed-command" className="text-sm font-medium">
        Didn&apos;t catch a command? Type it
      </label>
      <div className="flex gap-2">
        <input
          id="typed-command"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="/task for Sam: send the deck by Friday"
          maxLength={1000}
          autoComplete="off"
          aria-describedby="typed-command-help"
          aria-invalid={error !== null}
          className={inputClass("min-w-0 flex-1")}
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!text.trim()}>
          Add
        </Button>
      </div>
      <p id="typed-command-help" className={cn("text-xs", error ? "text-danger" : "text-fg-muted")}>
        {error ?? `Cited to the moment at ${formatTime(sec)}.`}
      </p>
    </form>
  );
}

function WhatYouCanSay() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="-ml-3 text-accent-strong hover:text-accent-strong"
      >
        What you can say
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 text-fg-muted">
          {COMMANDS.filter(isActive).map((command) => (
            <li key={command.kind}>
              <span className="text-fg">&ldquo;{command.example}&rdquo;</span> {command.help}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
