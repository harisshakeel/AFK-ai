"use client";

import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Button, buttonClass, chipClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Wordmark } from "@/components/ui/logo";
import { visitorFetch } from "@/lib/visitor-api";

import type { OnboardingAnswers } from "./files";

/**
 * The welcome (requirement M10): five short questions, one screen each, every one
 * skippable, then one write that becomes profile.md. Timezone and language come from
 * the browser and are shown for confirmation. In preview mode (signed out) nothing is
 * saved and the last step leads to sign-in.
 */
type StepKey = keyof OnboardingAnswers;

type Step = {
  key: StepKey;
  question: string;
  help: string;
  placeholder?: string;
  options?: string[];
};

const STEPS: Step[] = [
  {
    key: "callMe",
    question: "What should AFK call you?",
    help: "Used in notes and emails it drafts for you.",
    placeholder: "Your first name",
  },
  {
    key: "roleAndCompany",
    question: "What do you do, and where?",
    help: "One line, as you would say it on a call.",
    placeholder: "Product manager at Acme",
  },
  {
    key: "meetingsAre",
    question: "What are your meetings mostly?",
    help: "AFK leans on this when it decides what matters in a call.",
    options: ["Client calls", "Team syncs", "Interviews", "Research", "Other"],
  },
  {
    key: "notesStyle",
    question: "How do you like your notes?",
    help: "You can change this any time on the Memory page.",
    options: ["Short bullets", "Detailed", "Decisions first"],
  },
  {
    key: "wantMost",
    question: "What do you most want AFK to do for you?",
    help: "Say it plainly; AFK reads this before every meeting it works on.",
    placeholder: "Catch the action items I'd otherwise forget",
  },
];

export function WelcomeFlow({
  name,
  next,
  preview = false,
}: {
  /** The Google name, offered as the default answer to the first question. */
  name: string | null;
  next: string;
  preview?: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({ callMe: name ?? "" });
  // The browser's timezone and language, read after hydration (the server has neither).
  const locale = useSyncExternalStore(noopSubscribe, readLocale, () => null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const step = STEPS[index];
  const last = index === STEPS.length; // the confirmation screen
  const total = STEPS.length + 1;

  const finish = async (skipped: boolean) => {
    if (preview) {
      router.push("/sign-in?next=%2Fdashboard");
      return;
    }
    setState("saving");
    setMessage(null);
    try {
      await visitorFetch("/api/memory/onboarding", {
        method: "POST",
        body: {
          skipped,
          answers: {
            ...answers,
            timezone: locale?.timezone,
            language: locale?.language,
          },
        },
      });
      router.replace(next);
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "That didn't save. Try again.");
    }
  };

  const advance = () => setIndex((value) => Math.min(value + 1, STEPS.length));

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-dots [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-float sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <Wordmark markClassName="size-7" />
          <p className="font-mono text-[0.7rem] text-fg-subtle" aria-live="polite">
            {Math.min(index + 1, total)} of {total}
          </p>
        </div>
        {preview && (
          <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-strong">
            Preview. Sign in and this is what you see first; nothing here is saved.
          </p>
        )}

        {step ? (
          <form
            key={step.key}
            onSubmit={(event) => {
              event.preventDefault();
              advance();
            }}
            className="mt-7"
          >
            <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
              {step.question}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">{step.help}</p>
            {step.options ? (
              <div role="group" aria-label={step.question} className="mt-5 flex flex-wrap gap-2">
                {step.options.map((option) => {
                  const on = answers[step.key] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAnswers((current) => ({ ...current, [step.key]: option }))}
                      className={chipClass(on)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">
                <label htmlFor={`welcome-${step.key}`} className="sr-only">
                  {step.question}
                </label>
                <input
                  id={`welcome-${step.key}`}
                  autoFocus
                  maxLength={200}
                  value={answers[step.key] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [step.key]: event.target.value }))
                  }
                  placeholder={step.placeholder}
                  className={inputClass("h-11")}
                />
              </div>
            )}
            <div className="mt-7 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={advance}
                className={buttonClass("ghost", "md", "-ml-4")}
              >
                Skip
              </button>
              <Button type="submit" variant="primary">
                Next
                <ArrowRight aria-hidden />
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-7">
            <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
              {answers.callMe?.trim() ? `Good to meet you, ${answers.callMe.trim()}.` : "All set."}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              This becomes your profile, in plain sentences you can edit any time on the Memory
              page. AFK reads it before every meeting it works on for you.
            </p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-fg-muted">Timezone</dt>
              <dd className="font-mono text-[0.8rem]">{locale?.timezone ?? "…"}</dd>
              <dt className="text-fg-muted">Language</dt>
              <dd className="font-mono text-[0.8rem]">{locale?.language ?? "…"}</dd>
              {STEPS.map((item) =>
                answers[item.key]?.trim() ? (
                  <Row key={item.key} label={item.question} value={answers[item.key]!} />
                ) : null,
              )}
            </dl>
            {state === "error" && message && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {message}
              </p>
            )}
            <div className="mt-7 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIndex(0)}
                className={buttonClass("ghost", "md", "-ml-4")}
              >
                Change answers
              </button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void finish(false)}
                loading={state === "saving"}
              >
                {state !== "saving" && <Check aria-hidden />}
                {preview ? "Sign in to save" : "Save and continue"}
              </Button>
            </div>
          </div>
        )}

        {!last && (
          <p className="mt-6 border-t border-border pt-4 text-xs text-fg-subtle">
            In a hurry?{" "}
            <button
              type="button"
              onClick={() => void finish(true)}
              disabled={state === "saving"}
              className="font-medium text-fg-muted underline hover:text-fg"
            >
              Skip all
            </button>{" "}
            keeps just your name and email.
          </p>
        )}
      </div>
    </main>
  );
}

const noopSubscribe = () => () => {};
let cachedLocale: { timezone: string; language: string } | null = null;
function readLocale() {
  cachedLocale ??= {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
  };
  return cachedLocale;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-fg-muted">{label.replace(/\?$/, "")}</dt>
      <dd>{value}</dd>
    </>
  );
}
