import Link from "next/link";

import { Eyebrow } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Reveal, RevealWords } from "@/components/ui/reveal";

import { FeatureFlow } from "./feature-flow";
import { TestUserForm } from "./test-user-form";
import { TypedLines } from "./typed-lines";

/**
 * Everything after the animation: the claim, typed out as the page reaches it, beside
 * the three things to do (the sample, sign-in, and leaving your Gmail to be added as a
 * test user); the route through the product as a timeline; and a closing line. Every
 * claim here is something the app does today. The blocks rise into view as the page
 * reaches them.
 */
export function ShortVersion({ signedIn }: { signedIn: boolean }) {
  const links = (
    <>
      <Link href="/meetings/bmr007" className={buttonClass("primary", "lg")}>
        Open the hour-long sample
      </Link>
      <Link href={signedIn ? "/dashboard" : "/sign-in"} className={buttonClass("secondary", "lg")}>
        {signedIn ? "Your meetings" : "Sign in to send AFK"}
      </Link>
    </>
  );

  return (
    <section className="relative overflow-hidden">
      {/* Two slow violet drifts behind the section: the animation's glow, carried on. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-accent-soft/80 blur-3xl motion-safe:animate-drift-a"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 -right-40 size-[30rem] rounded-full bg-accent-soft/60 blur-3xl motion-safe:animate-drift-b"
      />

      <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6 lg:pt-28 lg:pb-32">
        {/* The claim, centred: the question, still, and its answer typed by the scroll in
            the wordmark's face, the way the animation above plays by it; then the three
            things to do. */}
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-[3rem] leading-[0.95] font-bold tracking-tight sm:text-6xl lg:text-[4.25rem]">
            <span className="block">Away from keyboard?</span>
            <TypedLines
              drive="scroll"
              className="block"
              lines={["The meeting still gets written up."]}
              lineClassNames={[
                "mt-3 font-sans text-[0.5em] leading-tight font-semibold tracking-tight text-fg-muted",
              ]}
            />
          </h1>
          <Reveal delay={0.2} className="mt-10 flex flex-col items-center gap-5">
            <div className="flex flex-wrap justify-center gap-3">{links}</div>
            <TestUserForm className="w-full max-w-xl" />
          </Reveal>
        </div>

        <div className="mt-24 border-t border-border pt-16 lg:mt-32 lg:pt-20">
          <Reveal>
            <Eyebrow>The short version</Eyebrow>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-balance sm:text-5xl">
            <RevealWords text="Link in. Notes out. Here's the route." delay={0.1} />
          </h2>
          <FeatureFlow />
        </div>

        <div className="mt-20 flex flex-col gap-6 border-t border-border pt-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-display text-3xl tracking-tight sm:text-4xl">
              <RevealWords text="Lurk first, sign in later." />
            </h2>
            <Reveal delay={0.2}>
              <p className="mt-3 max-w-xl text-fg-muted">
                Eight people, one hour, 1,067 turns, zero accounts needed. A real recording with
                real notes, not a mock-up.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.3} className="flex flex-wrap gap-3">
            {links}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
