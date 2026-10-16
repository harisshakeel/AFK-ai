# Conventions

How AFK.ai's code is organised, named and checked. [CLAUDE.md](../CLAUDE.md) has the short
version; this is the detail. The reasons behind the system are in
[architecture.md](architecture.md) and [system-design.md](system-design.md).

## Folders

```
src/
  app/              Routes only: page.tsx, layout.tsx, loading.tsx, error.tsx, route.ts
                    (and a route's route.test.ts beside it).
                    A page composes feature components and calls feature queries.
    api/              Route handlers: webhooks/attendee, jobs/kick, cron/keepalive, health,
                      meetings/..., commands/..., memory/..., connectors/..., m/[code]/...
  proxy.ts          Runs before every page and route: public read limits, the CSP nonce,
                    the Supabase session refresh.
  features/         One folder per product area:
    landing/          the home page sections
    meetings/         dashboard, meeting page shell, meeting queries, the seed file schema
    transcript/       player, timeline, synced transcript, find in meeting
    summaries/        templates, AI output schema, grounding, notes panel
    clips/            highlights and the shared clip page
    search/           search across meetings
    capture/          sending the bot, the Attendee client, meeting URL parsing
    commands/         spoken and typed commands, approval cards, the Tasks tab
    connectors/       Gmail, Google Calendar and Slack: OAuth state, token sealing, adapters
    memory/           the nine memory files, contacts, the welcome flow
    meeting-link/     /m/<code> behind a PIN
    processing/       the job runner and every Claude call
  components/       The frames: AppShell, AppNav, Chrome, SiteHeader, GuestNotice.
    ui/               Shared, feature-agnostic primitives (see Styling).
  server/           Server-only boundaries; every file starts with import "server-only":
    db/               createSupabaseServerClient, createSupabaseAdminClient
    auth/             who the caller is (viewer.ts) and their sign-in providers (providers.ts)
    media/            short-lived recording links (media-url.ts)
    connectors/       connector config and the sealed-token store
    bots.ts           sending a bot: the meeting row, then the Attendee bot
    calendar-autojoin.ts  the keep-alive's bots for calendar events
    calendar-invitees.ts  the people on the invite of a meeting AFK is sent to
    http.ts           readJson, requireVisitor, requireUser, jsonError for route handlers
    jobs.ts           kickJobs: wakes the runner
    log.ts            the structured logger
  lib/              Small utilities and validated config: env.ts, time-rules.ts, playhead.ts,
                    speakers.ts, csp.ts, read-limit.ts, format-date.ts, cn.ts, log-line.ts,
                    fetch-all.ts (every row of a query, a page at a time), prompt-text.ts
                    (bending angle brackets in prompt data), site.ts (the name and
                    description), visitor-api.ts (the browser's calls to visitor write
                    routes), use-reduced-motion.ts, google-user.ts (who is a Google user),
                    same-origin.ts (cross-site writes), safe-path.ts (where a redirect
                    may go), regexp.ts, words.ts (grounding's word matching), record.ts, fetch-deadline.ts and
                    supabase-cookies.ts (the Supabase clients' deadline and cookie
                    options), the generated database.types.ts, the browser and admin
                    client builders.
  test/             Test-only helpers, never imported by the app: fake-supabase.ts.
scripts/            Operator scripts: import-seed.ts.
tools/icsi/         One-off seed tools (parse_mrt.py, encode_audio.sh), not part of the
                    app build.
data/               Seed meetings (meetings/*.json), their committed AI output (ai/), the
                    ICSI source transcripts and licence (icsi-source/), README. audio/
                    holds the encoded recordings locally; it is gitignored.
supabase/
  migrations/       One change per file, named <timestamp>_<what_changed>.sql.
  tests/            Database tests on the real migrations in PGlite: harness.ts loads
                    them, schema.test.ts holds the tests.
e2e/                Playwright journeys with the axe scan, and two opt-in tools.
public/             Brand marks and the landing video.
```

Rules of thumb:
- A file lives in the one area it is about. Areas may import each other's modules
  directly; feature-agnostic UI goes in `src/components/ui/`, small utilities in `src/lib/`.
- Files under `src/server/` start with `import "server-only"`, so a browser import fails at
  build time. The feature query modules that read the database (`*-queries.ts`) do the same.
- No barrel `index.ts` files. Import from the file that defines the thing.
- Only `src/features/processing/claude.ts` imports `@anthropic-ai/sdk`.
- Only `src/lib/env.ts`, `src/proxy.ts` and `src/server/jobs.ts` read `process.env`.

## Naming

| Thing | Style | Example |
|---|---|---|
| Files and folders | kebab-case | `transcript-panel.tsx`, `use-media-player.ts` |
| React components | PascalCase, one main component per file | `export function TranscriptPanel()` |
| Hooks | `use` prefix | `useMediaPlayer` |
| Functions, variables | camelCase, verbs for functions | `clampTime(sec, durationSec)` |
| Types | PascalCase, no `I` prefix | `MeetingFile`, `TranscriptTurn` |
| Zod schemas | `<thing>Schema`, type inferred from it | `meetingFileSchema`, `type MeetingFile` |
| Database tables and columns | snake_case, plural tables | `transcript_turns.start_sec` |
| API and JSON fields | camelCase | `startSec`, `recordedAt` |
| Environment variables | SCREAMING_SNAKE, `NEXT_PUBLIC_` only when the browser needs it | `SUPABASE_SECRET_KEY` |
| Routes | kebab-case segments | `/meetings/[meetingId]`, `/share/[token]`, `/m/[code]` |

Units are part of the name: `startSec`, `endSec`, `durationSec`, `createdAt`, `expiresAt`.
A bare `time` or `duration` is not allowed. Time is in seconds from the start of the
recording everywhere: `transcript_turns.start_sec` and `end_sec` are `numeric(10,3)`, and
`src/lib/time-rules.ts` holds the shared rules (clamping, the turn under the playhead).

## Types and validation

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`.
  ESLint refuses `any` (`@typescript-eslint/no-explicit-any`); no `as` to silence an error.
  An object literal is never asserted to a type (`@typescript-eslint/consistent-type-assertions`):
  declare it (`const x: T = {...}`), or build a fixed-key record with `recordOf()` in
  `src/lib/record.ts`.
  Type-only imports use `import type`.
- External data is validated with Zod at the boundary: request bodies (`readJson` in
  `src/server/http.ts`), URL params, the seed files in `data/`, Claude output, Attendee
  webhooks, connector responses, environment variables (`src/lib/env.ts`).
- Three kinds of types, kept apart when their shapes differ: database rows (generated into
  `src/lib/database.types.ts`, snake_case), API payloads (Zod, camelCase) and UI view
  models (derived in the feature). Convert at the boundary, in one place.

## Server, data and secrets

- Anything privileged runs on the server. The browser holds only the publishable key.
- `createSupabaseServerClient()` (`src/server/db/supabase-server.ts`) acts as the visitor
  and is subject to RLS. Use it by default.
- `createSupabaseAdminClient()` (`src/server/db/supabase-admin.ts`) bypasses RLS. Use it
  only where the code has already made its own access decision, and say so in a comment.
  The seed import and the proxy build the same client through `createAdminClient()` in
  `src/lib/supabase-admin-client.ts`. The browser uses `createSupabaseBrowserClient()`.
- State changes that need a rule (caps, at-most-once, approvals) go through a SQL function
  called with `rpc`, so the rule holds in the database for every caller.
- Log through `src/server/log.ts` (`log.info`, `log.warn`, `log.error`): one JSON line per
  event, identifiers and counts only. Never transcript text, memory, names, addresses,
  recording links, PINs, tokens or keys. ESLint refuses `console.log`, and allows
  `console` freely only in `src/lib/log-line.ts` and `scripts/`.
- Secrets live in environment variables. Only `.env.example`, with placeholders, is
  committed.

## Styling

- Tailwind 4 with semantic tokens defined once in `@theme` in `src/app/globals.css`
  (`bg-surface`, `bg-canvas`, `text-fg`, `text-fg-muted`, `bg-accent`, `text-danger` and
  the rest). No raw colour values in components. Light and dark come from the same tokens.
- Interaction states (hover, focus-visible, disabled, current) look the same everywhere;
  focus is always visible.
- Two faces, loaded in `src/app/layout.tsx` through `next/font`: `font-sans` (Instrument
  Sans) for everything, `font-mono` (JetBrains Mono) for times, dates and commands.
  `font-display` is the same sans, heavier and tight, for titles. Nothing is italic.
- The primitives in `src/components/ui/` are the vocabulary. A new control starts from them:

| Primitive | File | Use |
|---|---|---|
| `Button`, `buttonClass` | `button.tsx` | Variants `primary`, `secondary`, `ghost`, `danger`, `outline-danger`; `loading` shows the wave loader and blocks a second press |
| `chipClass`, `Kbd` | `button.tsx` | Pressed-or-not toggles (templates, speakers); keyboard hints |
| `inputClass` | `input.tsx` | Text fields: every field applies it to its own element. The file also exports an `Input` component, which nothing uses |
| `cardClass` | `card.tsx` | Card surfaces |
| `Badge`, `Eyebrow` | `badge.tsx` | Status labels, small headings |
| `PageTitle` | `page-title.tsx` | The top of a page: eyebrow, title, one line. Its `actions` prop is unused; page actions go in the top bar through `AppShell` or `Chrome` |
| `Skeleton`, `WaveLoader` | `skeleton.tsx`, `wave-loader.tsx` | Loading states |
| `Tabs`, `tabPanelProps` | `tabs.tsx` | Tabs, with arrow-key movement |
| `Logo`, `Wordmark` | `logo.tsx` | The empty-chair mark |
| `TimestampButton`, `SpeakerMark` | `timestamp-button.tsx`, `speaker-mark.tsx` | A time that seeks; a speaker told apart by more than colour |
| `ToastProvider`, `useToast` | `toast.tsx` | Toasts |
| `ThemeToggle`, `SidebarToggle` | `theme-toggle.tsx`, `sidebar-toggle.tsx` | Theme and sidebar, remembered in the browser |
| `Reveal`, `RevealWords`, `CountUp` | `reveal.tsx`, `count-up.tsx` | Motion that respects reduced motion |
| `Interactions` | `interactions.tsx` | Mounted once: the `magnet` and `tilt` pointer effects for any element with those classes |

- Frames. Signed-in pages sit in `AppShell` (`src/components/app-shell.tsx`): the sidebar
  (`app-nav.tsx`: Quests, Spells, Lore, Loadout, Tutorial, Summon AFK), search in the top
  bar, one content column (`width` is `wide`, `narrow` or `form`). Signed-out pages use
  `SiteHeader`. Pages both kinds of people open use `Chrome`, which picks one. The meeting
  page keeps its own full-height layout.
- Most data pages have a `loading.tsx` built from `Skeleton` in the shape of what is
  coming. `/connectors`, `/dashboard/record`, `/m/[code]`, `/sign-in`, `/welcome` and
  `/privacy` fall back to the root `src/app/loading.tsx`.
  Numbers shown are counted from real rows, never estimated.
- The primitives are this repo's own code. The shadcn CLI is a dev dependency, but there is
  no `components.json`.

## Tests

| Kind | Where | Runs with |
|---|---|---|
| Unit | Beside the code: `thing.ts` and `thing.test.ts` under `src/` | Vitest in Node (`pnpm test`) |
| Route handlers | Beside the route: `route.test.ts` calls the exported handler with a `Request`. Only the edges are mocked (`vi.mock` of the Supabase client factories, Attendee's client, `kickJobs`, the logger), with `src/test/fake-supabase.ts` as the client; `requireVisitor`, the schemas and the owner checks run as written. `src/server/route-guards.test.ts` checks that every route calls an access check | Vitest (`pnpm test`) |
| Database | `supabase/tests/`: `harness.ts` loads every migration into PGlite with stubs for `auth.uid()`, `auth.jwt()` and the Supabase roles | Vitest (`pnpm test`) |
| Journeys | `e2e/*.spec.ts`, with the axe scan; `e2e/signed-in.ts` makes a throwaway signed-in user from `.env.local`; `e2e/global-setup.ts` loads each main page once first, so no journey meets a cold dev-server compile | Playwright on installed Chrome, `desktop` and `phone` (Pixel 7) projects (`pnpm e2e`) |
| Performance | `e2e/metrics.spec.ts`, skipped unless `MEASURE=1`; numbers land in `.metrics/` | `MEASURE=1 pnpm e2e e2e/metrics.spec.ts --workers=1` |
| Screenshots | `e2e/screenshots.spec.ts`, skipped unless `SCREENSHOTS=1`; full-page captures of twelve pages land in `test-results/screenshots/<project>-<name>.png` | `SCREENSHOTS=1 pnpm e2e --grep screenshots` |
| Rendering | `e2e/render-svg.spec.ts`, skipped unless `RENDER_HTML` and `RENDER_PNG` are set: renders a local HTML file to a PNG, used to export the files in `public/brand/`. `RENDER_WIDTH` and `RENDER_HEIGHT` set the viewport (default 1200 by 800), `RENDER_SCALE` the device scale factor, `RENDER_TRANSPARENT=1` drops the background; any `BASE_URL` stops Playwright starting the dev server | `BASE_URL=http://127.0.0.1:9 RENDER_HTML=in.html RENDER_PNG=out.png pnpm e2e e2e/render-svg.spec.ts --project=desktop` |

The journey specs in `e2e/`:

| Spec | Covers |
|---|---|
| `landing.spec.ts` | The landing page: links, the scroll-driven hero, the light palette in dark mode, the footer, the visitor's dashboard and locked connectors, the privacy page |
| `home.spec.ts` | The sample meetings list and opening a meeting |
| `meeting.spec.ts` | The meeting page: `?t=` links, the playhead line, speaker filter, chapters, templates, Find, Back to now and speed, Copy all, highlights, audio failure, the skeleton, keyboard use, axe |
| `search.spec.ts` | Search results opening at the moment; the no-results state |
| `share.spec.ts` | A shared clip for a signed-out viewer until revoked; private ticks per visitor |
| `send.spec.ts` | The Send page demo and link checks; the bot route and webhook refusing unsigned callers; sign-in offered only when it works |
| `commands.spec.ts` | The Tasks tab demo on a sample, "What you can say", the command routes refusing strangers, both widths |
| `memory.spec.ts` | The demo memory page, the welcome preview, the routes that need a sign-in |
| `site.spec.ts` | The nonce-based CSP, the metadata routes (icons, social image, manifest, robots, sitemap), the welcome redirect, a bad paging cursor |
| `dashboard.spec.ts` | Signed in (needs `.env.local`): the welcome, the dashboard, memory saves, cards awaiting approval, typed commands and the write limit, a meeting still recording |
| `meeting-link.spec.ts` | Signed in: the owner's link and PIN, a stranger's wrong then right PIN, the link switched off |
| `metrics.spec.ts`, `screenshots.spec.ts`, `render-svg.spec.ts` | The opt-in tools above |

`e2e/signed-in.ts` is the helper the signed-in specs share, not a spec.

- Vitest aliases `server-only` to its empty build, so server modules can be unit-tested.
- Playwright starts `pnpm dev` unless `BASE_URL` points at a deployment.
- No test spends Claude tokens or launches a real bot.

## Scripts under Node type stripping

`pnpm import:seed` runs `scripts/import-seed.ts` with plain `node`, which strips types
instead of compiling. So every module a script imports (under `src/features/` and
`src/lib/`):
- imports other modules by relative path with the `.ts` extension, never the `@/` alias;
- uses no enums and no constructor parameter properties (ESLint refuses both there);
- never imports `server-only`.

## Commands

From `package.json`:

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server at http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm lint` / `pnpm lint:fix` | ESLint (Next core-web-vitals and TypeScript rules, Prettier last) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `pnpm format:check` | Prettier with the Tailwind class sorter |
| `pnpm test` / `pnpm test:watch` | Vitest: unit and database tests |
| `pnpm e2e` | Playwright journeys with the axe scan |
| `pnpm check` | lint, typecheck, format check and tests: the bar before every commit, and what CI runs |
| `pnpm import:seed` | Loads the seed meetings and their AI output into Supabase (`node --env-file=.env.local`) |

CI (`.github/workflows/ci.yml`) installs with `--frozen-lockfile` and runs `pnpm check` on
every push to `main` and every pull request. Vercel builds and deploys on its own.

## Git and docs

- Phased commits, one logical change each, with a short imperative message
  ("Add meeting links"). No co-author trailer.
- Never commit `.env*` files other than `.env.example`, or any key.
- `.agent-logs/` is committed with the work it records.
- When code changes, the doc that describes it changes in the same commit: a code rule or
  folder here, the system in [architecture.md](architecture.md), access, limits and gaps
  in [system-design.md](system-design.md), a flow in [data-flows.md](data-flows.md), a page
  or state in [design.md](design.md), a decision in [plan.md](plan.md).
