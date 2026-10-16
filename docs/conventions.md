# AFK.ai — conventions

Short rules for how things are written. Per-tool detail is in
`.claude/skills/senior-engineer/references/stack.md`; the reasons are in
[docs/architecture.md](architecture.md) and [docs/system-design.md](system-design.md).

## Layout

```
app/(public)/        /, /tutorial, /tutorial/about, /meetings/[id], /search, /clips/[token],
                     /shared/[token], /privacy
app/(workspace)/     /app/quests, /app/meetings/[id], /app/search, /app/summon, /app/lore,
                     /app/loadout, /app/spells, /app/player, /app/settings
app/api/             webhooks/attendee, webhooks/google-calendar, webhooks/slack,
                     oauth/*, jobs/kick, cron/daily
components/ui/       shadcn components (generated; compose, never fork)
components/          one folder per feature: landing/, meeting-list/, meeting/, search/,
                     summon/, quests/, spells/, lore/, loadout/, share/, player-card/,
                     checklist/, account/, wrapup/, shell/ (app shell, public header)
lib/schemas/         Zod schemas, one file per shape; types via z.infer
lib/supabase/        server, browser and service-role clients (created once)
lib/db/              typed wrappers that call SQL functions (rpc), nothing else
lib/jobs/            job kinds, the runner, the kick client
lib/ai/              call.ts (CLAUDE_MODEL, JSON schema, no tools), ground.ts, prompts,
                     transliterate.ts, usage logging
lib/attendee/        API client, webhook verification, payload schemas, chat, fake mode
lib/commands/        command grammar and sender matching
lib/connections/     Google and Slack OAuth, token encryption, send clients, fake mode
lib/log.ts, env.ts   structured logging; env validated once
supabase/migrations/ one file per change, forward-only, timestamped
supabase/seed/       seed script and the seed README (sources, licence, changes)
tools/               owner-run scripts: convert-icsi.sh (afconvert to AAC), parse-icsi-transcripts.ts
tests/db/            PGlite tests that run the migrations (with the auth prelude)
tests/fixtures/ai/   recorded Claude responses for AI_MODE=fixture
e2e/                 Playwright specs with the axe scan
public/brand/        chair.svg (the one source for icons, favicon, social image), hero poster
docs/                plan, requirements, research, architecture, system-design,
                     conventions, data-flows, design
```

## Naming

- Files and folders: `kebab-case`. Components: `PascalCase` exports in `kebab-case.tsx`.
- Database: `snake_case`; tables plural (`meetings`), columns singular; every table has
  `id uuid default gen_random_uuid()`, `created_at timestamptz`, and `workspace_id` where
  it belongs to a workspace. Timestamps are `timestamptz`, durations are integer
  milliseconds, money is integer micro-dollars.
- SQL functions are verbs: `approve_card`, `claim_jobs`. Job kinds are
  `noun.verb`: `summary.generate`, `card.send`, `attendee.delete_data`.
- Zod schemas end in `Schema`; inferred types drop the suffix: `cardSchema` → `Card`.
- Idempotency keys are `kind:id[:qualifier]`: `meeting:123:chapters`, `card:456`.

## Code

- TypeScript `strict` and `noUncheckedIndexedAccess`. No `any`, no `!` on unchecked
  data, no `@ts-ignore`. Use `unknown` and narrow.
- Server Components by default; `"use client"` only on the smallest leaf that needs it.
  The meeting player is one client island.
- A mutation is a Server Action or Route Handler that: authenticates on the server,
  validates with Zod, calls **one** SQL function, calls `after(runJobs)` if work was
  enqueued, then `revalidatePath`. It returns `{ ok: true, data } | { ok: false, error,
  fieldErrors? }` and never throws for expected failures.
- Application code never updates state columns directly; it calls the SQL function.
- Every UI that loads data has loading, empty, error and success states. Errors tell the
  user what happened and what to do next; they never show provider text.
- Every Claude call goes through `lib/ai/call.ts`: Sonnet, no tools, JSON schema from a
  Zod schema, transcript as a delimited block, grounding check, usage logged. No other
  file imports the Anthropic SDK.
- Secrets are read only in `env.ts` (validated once) and used only in modules that
  `import "server-only"`.
- Comments say why, not what. No speculative abstractions, no unused options.

## Data

- Every schema change is a migration in `supabase/migrations`, never a dashboard edit.
  A migration enables RLS on any new table and adds the policies and indexes in the same
  file. A migration that needs a Supabase-only extension is marked `-- pglite: skip` on
  its first line and must not contain anything the app depends on in tests.
- Every state machine is a `text` column with a `check` constraint listing its states,
  and transitions happen only in its SQL function, which rejects backwards moves.
- Rows that represent a claim about the transcript carry `segment_id` and `quote`.
- Nothing is deleted by application code except through `delete_meeting`,
  `purge_guests` and account deletion, each of which cascades through foreign keys.

## Logging

- One JSON line per event through `lib/log.ts`: `{ ts, level, event, request_id,
  workspace_id, meeting_id, job_id, card_id, ...counts and durations }`.
- Never log content: no transcript text, names, emails, addresses, summaries, card bodies,
  memory, tokens, signed URLs or PINs. If a field could contain content, log its length.

## Tests

- Vitest tests sit next to the code (`*.test.ts`). They cover Zod schemas (good and bad
  input), the grounding check, command parsing, webhook signature verification, token
  encryption round-trips, the job runner's claim/complete/fail logic, and every server
  action with auth present, missing, wrong user, invalid input and provider failure.
  Mock the network with MSW, never our own modules.
- Database tests (`tests/db/`) load the real migrations into PGlite with a test prelude
  that stubs `auth.uid()`, `auth.jwt()` and `auth.role()` from a session setting. For
  every table: workspace A cannot read or write workspace B; `anon` reads seed rows only.
  For every SQL function: the rule it enforces, including the double-click, the stale
  lease and the backwards transition.
- Playwright specs (`e2e/`) cover one journey per feature plus its main failure path,
  with `getByRole`/`getByLabel`, web-first assertions, no fixed waits. Attendee and Claude
  are stubbed with `page.route`; no spec launches a real bot or spends tokens. Every spec
  runs an axe scan at 375 px and 1280 px with zero serious or critical violations.
- A bug fix comes with a test that fails without it.
- Nothing is "done" until it has been checked in a browser: happy path, forced loading,
  empty and error states, keyboard only, dark mode, console and server logs clean.

## Git

- Branch per feature from `main`; commit messages in the imperative ("Add card approval
  function"); one logical change per commit.
- Never commit `.env*` or keys. `.agent-logs/` is committed with every commit, never
  left out and never added in one batch later.
- Pull requests say what changed, why, how it was tested, and what was checked in the
  browser, with screenshots of the key states.

## Docs

- A product decision goes in the Decisions table of `docs/requirements.md`; a build
  decision goes in the decisions table of `docs/plan.md` with its reason; the system as
  built goes in `docs/architecture.md`; who can do what, controls, limits and gaps go in
  `docs/system-design.md`; a flow goes in `docs/data-flows.md`; the look goes in
  `docs/design.md`; a code rule goes here. Every piece of work that lands adds a line to
  the progress log in `docs/plan.md`. Update the doc in the same commit as the code.
- Every external claim (price, limit, API shape) carries a URL and the date it was
  checked.
