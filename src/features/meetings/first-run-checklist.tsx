import { Check, Circle } from "lucide-react";
import Link from "next/link";

/**
 * The first-run checklist: the four things a new account has to do once,
 * each a tick that links where it is done, gone when all are. Computed on the server
 * from what exists; nothing is stored.
 */
export type ChecklistInput = {
  guest: boolean;
  googleReady: boolean;
  slackChannel: boolean;
  /** The profile's "Name in calls" line is filled, or AFK has matched the host by name in a call. */
  nameInCalls: boolean;
  sentOnce: boolean;
};

export type ChecklistItem = { key: string; label: string; href: string; done: boolean };

export function checklistItems(input: ChecklistInput): ChecklistItem[] {
  if (input.guest) {
    return [
      { key: "send", label: "Send AFK to one test call", href: "/send", done: input.sentOnce },
      {
        key: "google",
        label: "Continue with Google to keep this workspace and let AFK send mail",
        href: "/sign-in?next=%2Fdashboard",
        done: false,
      },
    ];
  }
  return [
    {
      key: "google",
      label: "Connect Google, for Gmail and Calendar",
      href: "/connectors",
      done: input.googleReady,
    },
    {
      key: "slack",
      label: "Connect Slack and pick a channel",
      href: "/connectors",
      done: input.slackChannel,
    },
    {
      key: "name",
      label: "Tell AFK the name you show in calls",
      href: "/memory?tab=profile.md&field=Name%20in%20calls",
      done: input.nameInCalls,
    },
    { key: "send", label: "Send AFK to one test call", href: "/send", done: input.sentOnce },
  ];
}

export function FirstRunChecklist({ items }: { items: ReadonlyArray<ChecklistItem> }) {
  const open = items.filter((item) => !item.done);
  if (open.length === 0) return null;
  const done = items.length - open.length;
  return (
    <section
      aria-labelledby="first-run-title"
      className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <h2 id="first-run-title" className="text-sm font-semibold">
        Getting set up
        <span className="ml-2 font-mono text-[0.7rem] font-normal text-fg-muted">
          {done} of {items.length}
        </span>
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2.5 text-sm">
            {item.done ? (
              <Check className="size-4 text-success-strong" aria-label="Done" />
            ) : (
              <Circle className="size-4 text-fg-subtle" aria-label="To do" />
            )}
            {item.done ? (
              <span className="text-fg-muted line-through decoration-fg-subtle">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className="font-medium text-accent-strong underline-offset-4 hover:underline"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
