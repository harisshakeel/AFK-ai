import Link from "next/link";

import { Wordmark } from "@/components/ui/logo";

/** Every link here goes somewhere real. */
export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm">
          <Wordmark markClassName="size-6" />
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            A meeting notetaker built in 24 hours, inspired by Fathom. The sample meetings are real
            recordings from the{" "}
            <a
              href="https://groups.inf.ed.ac.uk/ami/icsi/"
              className="underline hover:text-fg"
              target="_blank"
              rel="noreferrer"
            >
              ICSI Meeting Corpus
            </a>
            , CC BY 4.0.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2.5 text-sm">
          <Link href="/samples" className="text-fg-muted transition-colors hover:text-fg">
            Sample meetings
          </Link>
          <Link href="/send" className="text-fg-muted transition-colors hover:text-fg">
            Send AFK to a meeting
          </Link>
          <Link href="/search" className="text-fg-muted transition-colors hover:text-fg">
            Search
          </Link>
          <Link href="/sign-in" className="text-fg-muted transition-colors hover:text-fg">
            Sign in
          </Link>
          <Link href="/privacy" className="text-fg-muted transition-colors hover:text-fg">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
