"use client";

import { WaveLoader } from "@/components/ui/wave-loader";
import { Check, CircleAlert, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { visitorFetch } from "@/lib/visitor-api";

import { PLATFORM_NAMES, parseMeetingUrl } from "./meeting-url";

/**
 * The send form. "live": anyone sends the real bot; a guest's first send creates their
 * workspace (visitorFetch starts the anonymous session). "unconfigured": a deployment
 * with no bot keys. Either way "Show me what happens" plays the steps as a labelled
 * demo without sending anything.
 */
type CallLanguage = "en" | "multi";
const LANGUAGE_KEY = "afk.send.language";
const LANGUAGE_EVENT = "afk:send-language";
function readSavedLanguage(): CallLanguage | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_KEY);
    return value === "en" || value === "multi" ? value : null;
  } catch {
    return null;
  }
}
function subscribeLanguage(callback: () => void): () => void {
  window.addEventListener(LANGUAGE_EVENT, callback);
  return () => window.removeEventListener(LANGUAGE_EVENT, callback);
}
const CALL_LANGUAGES: ReadonlyArray<{ value: CallLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "multi", label: "English and Urdu" },
];

const DEMO_STEPS = ["Joining the call", "Recording", "Processing the recording", "Summary ready"];

export function SendBotForm({
  mode,
  guest,
  signInAvailable,
}: {
  mode: "live" | "unconfigured";
  /** No Google account: the meeting will be private to this browser's workspace. */
  guest: boolean;
  /** False until Google sign-in is switched on for the deployment. */
  signInAvailable: boolean;
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [senderName, setSenderName] = useState("");
  // English boosts the wake word; English and Urdu also hears what is said in Urdu. The
  // last choice is kept in this browser; the server renders the default.
  const saved = useSyncExternalStore(subscribeLanguage, readSavedLanguage, () => null);
  const [chosen, setChosen] = useState<CallLanguage | null>(null);
  const language: CallLanguage = chosen ?? saved ?? "multi";
  const [touched, setTouched] = useState(false);
  // Send pressed: an empty link is then an error too, not only a malformed one.
  const [attempted, setAttempted] = useState(false);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "error" | "demo">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [demoStep, setDemoStep] = useState(0);

  const parsed = parseMeetingUrl(link);
  const showError = !parsed.ok && (attempted || (touched && link.trim() !== ""));
  // A guest has no account name for AFK to listen for; the one typed here is it.
  const nameMissing = guest && senderName.trim().length < 2;

  const chooseLanguage = (value: CallLanguage) => {
    setChosen(value);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, value);
      window.dispatchEvent(new Event(LANGUAGE_EVENT));
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  };

  useEffect(() => {
    if (state !== "demo" || demoStep >= DEMO_STEPS.length - 1) return;
    const timer = setTimeout(() => setDemoStep((step) => step + 1), 1400);
    return () => clearTimeout(timer);
  }, [state, demoStep]);

  // The demo sends nothing, so it needs no link.
  const demo = () => {
    setDemoStep(0);
    setMessage(null);
    setState("demo");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setAttempted(true);
    if (!parsed.ok) {
      linkRef.current?.focus();
      return;
    }
    if (nameMissing || mode === "unconfigured") return;
    setState("sending");
    setMessage(null);
    try {
      const { meetingId } = await visitorFetch<{ meetingId: string }>("/api/bot", {
        method: "POST",
        body: {
          meetingUrl: parsed.url,
          title: title.trim() || undefined,
          senderName: senderName.trim() || undefined,
          language,
        },
      });
      if (!meetingId) throw new Error("AFK couldn't be sent. Try again.");
      router.push(`/meetings/${meetingId}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "AFK couldn't be sent. Try again.");
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-5">
      {guest && mode === "live" && (
        <div className="flex gap-3 rounded-lg border border-accent/30 bg-accent-soft p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
          <div>
            <p className="font-medium text-fg">No account needed</p>
            <p className="mt-1 leading-relaxed text-fg-muted">
              AFK joins for guests too. The meeting it records is private to this browser&apos;s
              workspace, and cleared after thirty days.{" "}
              {signInAvailable && (
                <Link
                  href="/sign-in?next=%2Fsend"
                  className="font-medium text-accent-strong underline"
                >
                  Continue with Google to keep it.
                </Link>
              )}
            </p>
          </div>
        </div>
      )}
      {mode === "unconfigured" && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          The meeting bot isn&apos;t configured on this deployment yet (Attendee API key and webhook
          secret). The demo below shows the steps.
        </p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="meeting-link" className="text-sm font-medium">
            Meeting link
          </label>
          <input
            ref={linkRef}
            id="meeting-link"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://meet.google.com/abc-defg-hij"
            aria-invalid={showError}
            aria-describedby="meeting-link-help"
            className={inputClass("mt-1.5 h-11")}
          />
          <p
            id="meeting-link-help"
            className={cn("mt-1.5 text-xs", showError ? "text-danger" : "text-fg-muted")}
          >
            {showError && !parsed.ok
              ? parsed.reason
              : parsed.ok
                ? `${PLATFORM_NAMES[parsed.platform]} meeting`
                : "Zoom, Google Meet or Microsoft Teams"}
          </p>
        </div>
        <div>
          <label htmlFor="sender-name" className="text-sm font-medium">
            Your name in the call{" "}
            {!guest && <span className="font-normal text-fg-muted">(optional)</span>}
          </label>
          <input
            id="sender-name"
            value={senderName}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => setSenderName(event.target.value)}
            placeholder="As Meet, Zoom or Teams shows you"
            aria-invalid={touched && nameMissing}
            aria-describedby="sender-name-help"
            className={inputClass("mt-1.5 h-11")}
          />
          <p
            id="sender-name-help"
            className={cn(
              "mt-1.5 text-xs",
              touched && nameMissing ? "text-danger" : "text-fg-muted",
            )}
          >
            {touched && nameMissing
              ? "AFK needs your name to know whose commands count."
              : "AFK listens for commands from this name only. Guests must give one; a Google account's name is known."}
          </p>
        </div>
        <div>
          <label htmlFor="meeting-title" className="text-sm font-medium">
            Title <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <input
            id="meeting-title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Weekly product sync"
            className={inputClass("mt-1.5 h-11")}
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Language of the call</legend>
          <div className="mt-1.5 flex gap-1 rounded-full border border-border bg-surface p-1">
            {CALL_LANGUAGES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex h-9 flex-1 cursor-pointer items-center justify-center rounded-full text-sm font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-accent/20",
                  language === option.value
                    ? "bg-accent-soft text-accent-strong"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                <input
                  type="radio"
                  name="call-language"
                  value={option.value}
                  checked={language === option.value}
                  onChange={() => chooseLanguage(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            {language === "en"
              ? "English only, with \u201cAFK\u201d boosted so the wake word is heard."
              : "Hears English, and anything said in Urdu, written in Roman letters. Commands stay English."}
          </p>
        </fieldset>
        <p className="text-xs leading-relaxed text-fg-muted">
          AFK announces itself when it joins and everyone on the call can see it. Only send it to
          calls where everyone has agreed to be recorded. Your meetings are private to you.
        </p>
        <div className="flex flex-wrap gap-3">
          {mode === "live" && (
            <Button type="submit" variant="primary" loading={state === "sending"}>
              Send AFK
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={demo}>
            Show me what happens
          </Button>
        </div>
        {state === "error" && message && (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger">
            <CircleAlert className="size-4" aria-hidden />
            {message}
          </p>
        )}
      </form>

      {state === "demo" && (
        <section aria-label="Demo" className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs font-semibold tracking-wide text-accent-strong uppercase">
            Demo, nothing was sent
          </p>
          <ol className="mt-3 flex flex-col gap-3" aria-live="polite">
            {DEMO_STEPS.map((step, index) => (
              <li key={step} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs",
                    index < demoStep
                      ? "bg-success text-white"
                      : index === demoStep
                        ? "bg-accent-soft text-accent-strong"
                        : "border border-border text-fg-subtle",
                  )}
                >
                  {index < demoStep || (index === demoStep && index === DEMO_STEPS.length - 1) ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : index === demoStep ? (
                    <WaveLoader className="h-3.5" label={null} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={index <= demoStep ? "text-fg" : "text-fg-subtle"}>{step}</span>
              </li>
            ))}
          </ol>
          {demoStep === DEMO_STEPS.length - 1 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm text-fg-muted">
                This is where your meeting would land. Here&apos;s a real one:
              </p>
              <Link href="/meetings/bmr007" className={buttonClass("secondary", "sm", "mt-3")}>
                Open an hour-long, eight-person meeting
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
