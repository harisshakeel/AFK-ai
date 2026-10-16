# AFK.ai

An AI meeting notetaker for the person who wasn't fully there: the bot sits in your
meetings so you don't have to. Inspired by Fathom, with its own identity.

Anyone can send the bot (Attendee) to a Zoom, Meet or Teams call without an account: the
first write makes an anonymous Supabase identity, and a guest's meetings get notes like a
Google user's. The bot records video, which stays at Attendee and plays on the meeting page
through short-lived links. The sender can speak commands in the call ("AFK, task for Sam
..."); internal effects land at once, anything that leaves the meeting waits on a card for
one approval. Every meeting has an address, `/m/<code>` behind a four-digit PIN. Memory
files (nine), the people AFK knows (`contacts`) and connectors (Gmail, Google Calendar,
Slack) belong to Google accounts only. AI runs through the Claude API (`ANTHROPIC_API_KEY`,
`CLAUDE_MODEL`, default `claude-sonnet-5-5`) inside the app's own functions: Postgres leases
the jobs and `src/features/processing/` runs them. There is no worker process, queue
service or container. The seed data is five real ICSI Meeting Corpus recordings (audio),
including `bmr007`: 60 minutes, eight speakers.

## Where it lives

| What | Where |
|---|---|
| Live app | https://afk-ai-tau.vercel.app (works signed out) |
| Repository | https://github.com/harisshakeel/AFK-ai |
| Vercel project | `afk-ai` (functions in `bom1`, daily cron `/api/cron/keepalive`) |
| Supabase project | `afk-ai` |

## How it is judged

Weigh every decision against the three things reviewers judge:

- **Speed:** how much working product exists. Finish one flow end to end before the next.
- **Product judgement:** what is built first and what is left out. Record each decision and
  its reason in [docs/plan.md](docs/plan.md).
- **UX and UI:** whether it is good to use. Polish the core journey before adding features.

The hand-in needs a live link that works for someone not signed in as us; a public
repository with the agent logs committed (`.agent-logs/`); real seed data, never an empty
meetings list, with a long meeting with many speakers and only recordings we may publish
(never invented conversations passed off as real); and a walkthrough of at most five
minutes, camera on. Anything simulated is listed in [docs/plan.md](docs/plan.md).

## The documents

| Document | What it holds |
|---|---|
| [README.md](README.md) | What AFK.ai is, how to run it, the seed data's credit |
| [docs/assignment.md](docs/assignment.md) | The brief, verbatim. Never edit it |
| [docs/requirements.md](docs/requirements.md) | The functional and non-functional requirements with their IDs |
| [docs/architecture.md](docs/architecture.md) | The system as built: data model, processing, pages |
| [docs/system-design.md](docs/system-design.md) | Who can do what, security controls, limits and known gaps |
| [docs/data-flows.md](docs/data-flows.md) | Each feature from its first input to its last output, one section per flow |
| [docs/conventions.md](docs/conventions.md) | The folder structure, naming, the code rules and the commands |
| [docs/design.md](docs/design.md) | The look: fonts, tokens, shared pieces, frames, every page, accessibility |
| [docs/plan.md](docs/plan.md) | Scope, the decisions with their reasons, what is simulated, the status |
| [docs/research.md](docs/research.md) | The Fathom research the product was shaped against |
| [docs/going-live.md](docs/going-live.md) | The owner's steps: OAuth setups, keys, hosting |
| [docs/setup.md](docs/setup.md) | The owner's setup steps for every environment variable and CLI login |
| [docs/audit.md](docs/audit.md) | A static audit of the code against these documents, with findings to fix (ids F, S, D, H) |

Per-tool rules for building are in the `senior-engineer` skill
(`.claude/skills/senior-engineer/`). Load it before planning, building or reviewing any
feature.

## Rule: keep the documents true

When a decision is made or a piece of work lands, update the right document in the same
commit:

- A product decision or a changed requirement → `docs/requirements.md`.
- A build or technical decision → `docs/plan.md`, with its reason; and
  `docs/architecture.md` if it changes how the system is built.
- A change to who can do what, a security control, a limit or a known gap →
  `docs/system-design.md`.
- A new or changed flow → its section in `docs/data-flows.md`.
- A new or changed page, piece or state → `docs/design.md`.
- A new code rule or folder → `docs/conventions.md`.
- Work that changes what is done → the status in `docs/plan.md`.

## Engineering standards

- **Inspect existing code before changing it,** and follow its patterns.
- **Keep credentials out of code, commits and captured responses.** Secrets go in
  environment variables; only `.env.example`, with placeholders, is committed.
- **Validate all external input** with Zod: request bodies, URL parameters, seed files,
  Attendee webhooks, connector responses and Claude output.
- **Protect meeting data.** Meetings are private unless shared, and a share link or
  meeting address exposes only what its owner chose to share. RLS applies by default.
- **Handle loading, empty and failure states** in every view that loads data.
- **Test important behaviour,** such as transcript and playback sync, search, share-link
  access, parsing of AI output and the database functions that enforce caps and
  at-most-once.
- **Inspect user-facing changes in a browser** at 1280 px and 375 px before calling them done.
- **Never claim a check passed unless it actually ran.** Say what was not checked.
- **Every Claude call costs money** on the owner's key. Never run one just to see what
  happens.

## Stack and commands

Next.js 16.3 (App Router, React 19, TypeScript strict), Node 24, pnpm 10, Tailwind 4,
Supabase (supabase-js, `@supabase/ssr`, SQL migrations, Storage, anonymous and Google
auth), Zod 4, Vitest with PGlite for database tests, Playwright on installed Chrome with
axe, the Claude API (`@anthropic-ai/sdk`), Attendee for the bot, deployed on Vercel.

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server on http://localhost:3000 |
| `pnpm check` | lint + typecheck + format:check + unit and database tests; run before every commit (CI runs it too) |
| `pnpm e2e` | Playwright journeys with the axe accessibility scan |
| `pnpm build` | Production build |
| `pnpm import:seed` | Load the seed meetings and their AI output into Supabase |

The full table is in [docs/conventions.md](docs/conventions.md).

## Conventions

The detail is in [docs/conventions.md](docs/conventions.md). The essentials:

- **Where code goes:** `src/app/` is routes only. Each product area lives in
  `src/features/<area>/` (landing, meetings, transcript, summaries, clips, search, capture,
  commands, connectors, memory, meeting-link, processing). Shared primitives in
  `src/components/ui/`, the frames in `src/components/`. Server-only boundaries in
  `src/server/{db,auth,media,connectors}/` plus `bots.ts`, `calendar-autojoin.ts`,
  `calendar-invitees.ts`, `http.ts`, `jobs.ts` and `log.ts`, each file starting with
  `import "server-only"`. Utilities and validated config in `src/lib/`.
- **Naming:** kebab-case files, PascalCase components and types, camelCase functions and
  JSON fields, snake_case database names. Units in names, times in seconds: `startSec`,
  `durationSec`, `createdAt`.
- **Types:** strict TypeScript, no unexplained `any` or `as`. Zod at every boundary.
  Database rows, API payloads and UI models kept apart when they differ.
- **Data access:** `createSupabaseServerClient()` (RLS applies) by default;
  `createSupabaseAdminClient()` only after an explicit access decision, with a comment.
- **Logging:** through `src/server/log.ts`; identifiers and counts, never content or secrets.
- **Styling:** semantic Tailwind tokens from `src/app/globals.css` and the primitives in
  `src/components/ui/`; no raw colours in components.
- **Tests:** unit tests beside the code (`*.test.ts`), database tests in `supabase/tests/`,
  journeys in `e2e/`.

## Commits

- Phased commits: one logical change each, in a sensible order.
- Concise imperative messages ("Add meeting links"). No co-author trailer.
- Before every commit: `pnpm check` and the affected Playwright journeys (consent asked
  once per commit), a browser look at 1280 px and 375 px, a code review, the doc updates
  above, and `.agent-logs/` included.

## Agent capture

Every prompt and final response in this repo is logged to `.agent-logs/`, and the logs are
committed with the work.

- **How it works:** [.claude/settings.json](.claude/settings.json) runs
  [.claude/hooks/capture.py](.claude/hooks/capture.py) (`python3 -I`, standard library only)
  on `SessionStart`, `UserPromptSubmit`, `Stop` and `StopFailure`. It writes one file per
  session, `.agent-logs/YYYY-MM-DD_HH-MM-SS_<session-id>.md`, append-only, with
  `PROMPT` and `RESPONSE` entries. Subagent turns are not logged. If the hook went live
  mid-session it backfills earlier turns from the transcript and marks them. Its
  bookkeeping is in `.claude/hooks/.state/` (gitignored); a failure never blocks the
  session, is written to `.claude/hooks/.state/capture-errors.log` and shows as a system
  message.
- **Leave it alone:** don't bypass the hook, and never edit files in `.agent-logs/` by
  hand, except to redact a secret that was pasted into the chat.
- **The logs are verbatim and public.** Never put credentials, tokens or private personal
  data in a prompt or a final response.

## The owner's rules

The owner's global rules apply to everything here: never run node, pnpm, installs, builds
or tests without consent for that run; `npx`, `pnpm dlx` and `corepack` are never used;
never execute code from downloads; never read `.env.local`; scan for obfuscated code after
every pull.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
