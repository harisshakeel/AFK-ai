"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { AddressEntry } from "@/features/connectors/address-book";
import {
  expandEveryone,
  suggestedAddresses,
  suggestRecipients,
  withSaidAddresses,
} from "@/features/connectors/address-book";
import {
  approvalIssueMessage,
  APPROVED_SCHEMAS,
  splitAddresses,
  type ApprovableKind,
} from "@/features/connectors/approve-args";
import type { ConnectorView } from "@/features/connectors/registry";
import type { SlackChannel } from "@/features/connectors/slack";
import { loadSlackChannels } from "@/features/connectors/slack-channels";
import { channelForTopic, type SkillSettings } from "@/features/memory/files";
import { ApiError, visitorFetch } from "@/lib/visitor-api";

import { asString, asStrings, canRewrite, type CommandView } from "./command-view";
import {
  approvalArgs,
  durationChoices,
  initialFields,
  type ApprovalFields,
} from "./approval-draft";
import { EmailActions, isModelDraft, RewriteControl } from "./card-actions";

const fieldLabel = "text-xs font-medium text-fg-muted";

/**
 * The details an adapter will run with, pre-filled from what AFK heard, the owner's
 * people file and learned contacts (each with its reason), and the owner's skills
 * (who to copy or invite, the default length, the channel), checked by the kind's
 * schema before they are sent. Nothing is filled silently: a guessed address shows
 * why, the other matches are one click away, an unknown name says so.
 */
export function ApprovalForm({
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

  const [fields, setFields] = useState(() =>
    initialFields({
      kind,
      args,
      suggested: suggestedAddresses(suggestions),
      skills: { alwaysInvite, alwaysCopy: splitAddresses(skills.email["always copy"] ?? "") },
      skillMinutes,
      defaultChannel:
        defaultChannelId && defaultChannelName
          ? { id: defaultChannelId, name: defaultChannelName }
          : null,
    }),
  );
  const set = (patch: Partial<ApprovalFields>) =>
    setFields((current) => ({ ...current, ...patch }));
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [needsConnect, setNeedsConnect] = useState(false);

  // A Slack card lists the workspace's channels once, so the topic can pick one; the
  // skill's "topic: #channel" lines decide, else the channel chosen on Connectors.
  useEffect(() => {
    if (kind !== "slack" || !isOwn || !slack || slack.status !== "connected") return;
    let cancelled = false;
    loadSlackChannels()
      .then((list) => {
        if (cancelled) return;
        setChannels(list);
        const wanted = channelForTopic(fields.message, skills.slack);
        const found = wanted
          ? list.find((candidate) => candidate.name.toLowerCase() === wanted)
          : undefined;
        if (found) set({ channel: { id: found.id, name: found.name } });
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
  const durations = durationChoices(skillMinutes, fields.duration);

  const pickAddress = (name: string, email: string) => {
    const current = splitAddresses(fields.to);
    const own = suggestions.find((suggestion) => suggestion.name === name);
    const without = current.filter(
      (address) =>
        address !== own?.email && !own?.alternatives.some((alt) => alt.email === address),
    );
    set({ to: [...without, email].join(", ") });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isOwn || sending) return;
    const parsed = APPROVED_SCHEMAS[kind].safeParse(
      approvalArgs(kind, fields, asString(args.startsAt)),
    );
    if (!parsed.success) {
      setError(approvalIssueMessage(parsed.error.issues[0]));
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
      // The route names where to put it right; for an app it is the Connectors page.
      if (caught instanceof ApiError && caught.connect === "/connectors") setNeedsConnect(true);
      setError(caught instanceof Error ? caught.message : "That didn't save.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={approveOnlyOnCommandEnter}
      className="mt-3 flex flex-col gap-3 rounded-md bg-surface-raised p-3"
    >
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
            value={fields.to}
            onChange={(event) => set({ to: event.target.value })}
            placeholder={
              kind === "email"
                ? "name@example.com, other@example.com"
                : "Addresses, comma separated (optional)"
            }
            autoComplete="off"
            className={inputClass("mt-1 h-9")}
            disabled={!isOwn}
          />
          {kind === "email" && fields.to.trim() === "" && suggestions.length === 0 && (
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
              value={fields.cc}
              onChange={(event) => set({ cc: event.target.value })}
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
              value={fields.subject}
              onChange={(event) => set({ subject: event.target.value })}
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
              value={fields.body}
              onChange={(event) => set({ body: event.target.value })}
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
            value={fields.title}
            onChange={(event) => set({ title: event.target.value })}
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
            value={fields.text}
            onChange={(event) => set({ text: event.target.value })}
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
              value={fields.when}
              onChange={(event) => set({ when: event.target.value })}
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
                value={fields.duration}
                onChange={(event) => set({ duration: event.target.value })}
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
                value={fields.channel?.id ?? ""}
                onChange={(event) => {
                  const picked = channels.find((candidate) => candidate.id === event.target.value);
                  set({ channel: picked ? { id: picked.id, name: picked.name } : null });
                }}
                className={inputClass("mt-1 h-9 w-auto")}
                disabled={!isOwn}
              >
                {!fields.channel && <option value="">Pick a channel</option>}
                {channels.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    #{candidate.name}
                  </option>
                ))}
              </select>
            ) : fields.channel ? (
              <p className="mt-1 text-sm">
                <span className="font-medium">#{fields.channel.name}</span>
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
              value={fields.message}
              onChange={(event) => set({ message: event.target.value })}
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
        {kind === "email" && (
          <EmailActions command={command} subject={fields.subject} body={fields.body} />
        )}
      </div>
      {isOwn && isModelDraft(kind) && canRewrite(command) && (
        <RewriteControl
          command={command}
          label="Rewrite"
          placeholder="What should change? e.g. shorter, more formal, mention the Friday date"
        />
      )}
      <p className="text-xs text-fg-subtle">
        AFK runs exactly these details, once, writes a line in your history file, and remembers the
        people you confirmed. ⌘/Ctrl+Enter in a field approves; in the rewrite note, Enter sends the
        note back.
      </p>
    </form>
  );
}

/**
 * Enter alone in a one-line field never approves: approving sends an email or an invite
 * that cannot be taken back, and Enter is what people press after typing one address or
 * a rewrite note. With the command or control key it approves, as in the message box.
 */
function approveOnlyOnCommandEnter(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
  event.preventDefault();
  if (event.metaKey || event.ctrlKey) event.currentTarget.requestSubmit();
}

/** In a message box, Enter makes a new line; with the command or control key it approves. */
function submitOnCommandEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

/** "30 minutes" or "45" from a skill line, as minutes. */
function minutesIn(value: string | undefined): number | null {
  const match = /(\d{1,3})/.exec(value ?? "");
  const minutes = match ? Number(match[1]) : NaN;
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 240 ? minutes : null;
}
