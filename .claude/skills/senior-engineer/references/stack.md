# Stack rules

These are the defaults until the codebase establishes its own patterns. Once it does,
follow the codebase. Check the installed versions in `package.json`. If an API here
doesn't match the installed version, trust that version's docs. The reasons behind each
choice, the rejected alternatives and the cost model are in `docs/architecture.md`
(decided 2026-10-16).

## Contents
- [Next.js (App Router)](#nextjs-app-router)
- [React](#react)
- [TypeScript](#typescript)
- [Tailwind and shadcn/ui](#tailwind-and-shadcnui)
- [Supabase](#supabase)
- [Zod](#zod)
- [Vitest and PGlite](#vitest-and-pglite)
- [Playwright](#playwright)
- [Vercel](#vercel)
- [Background jobs](#background-jobs)
- [Claude API](#claude-api)
- [Attendee meeting bot](#attendee-meeting-bot)

## Next.js (App Router)
- Components are Server Components by default. Add `"use client"` only to the smallest
  leaf that needs state, effects, or browser APIs. Pass serializable props across the
  boundary and never pass secrets.
- Fetch data in Server Components, close to where it is used. Run independent fetches in
  parallel (`Promise.all`) to avoid waterfalls.
- Mutations go in Server Actions, or in Route Handlers for webhooks and external callers.
  Treat a Server Action as a public endpoint: authenticate, authorize, validate, and only
  then act.
- After a mutation, call `revalidatePath` or `revalidateTag`. Know which routes are
  static and which are dynamic. Anything that reads cookies or auth is dynamic.
- Use the route-level `loading.tsx`, `error.tsx` (a client component with `reset`) and
  `not-found.tsx`. Use `<Suspense>` for streaming below route level.
- Middleware refreshes the Supabase session and redirects unauthenticated users. It is
  not the only authorization check: pages and actions check again.
- Validate env vars once (`env.ts` with Zod). Mark server-only modules with
  `import "server-only"`.
- Set metadata through `generateMetadata` or `metadata`. Use `next/image` and `next/font`.

## React
- Derive values instead of syncing them in state. An effect is for synchronizing with
  something outside React, not for transforming data.
- Use stable, meaningful `key`s and never array indexes for lists that can change.
- Use `useActionState` or `useFormStatus` for form pending and error state, and
  `useOptimistic` only where a rollback is handled.
- For accessibility: use semantic elements, give every input a label, use buttons for
  actions and links for navigation, keep focus visible, and announce async results.

## TypeScript
- Enable `strict` and `noUncheckedIndexedAccess`. Do not use `any` or `@ts-ignore`. Use
  `unknown` with narrowing.
- Generate database types with the Supabase CLI and type the clients with them.
  Regenerate after every migration.
- Model states as discriminated unions (`{ status: "error"; message: string } | …`).
- Server actions return a typed result such as `{ ok: true, data } | { ok: false, error,
  fieldErrors? }`. Do not throw for expected failures.

## Tailwind and shadcn/ui
- Use the shadcn components in `components/ui` before writing new ones. Compose them and
  do not fork them. Add new ones with the shadcn CLI, but ask before running it.
- Use design tokens (CSS variables such as `bg-background` and `text-muted-foreground`)
  instead of raw colours, so dark mode works.
- Merge classes with `cn()`. Use variants (`cva`) for component variations, not
  conditional string building.
- Design mobile-first (`sm:`, `md:` add to the base styles). Avoid arbitrary values
  unless nothing else works.
- Use `Skeleton` for loading, `Alert` or inline text for errors, and `Sonner` (toasts) for
  short feedback on success or failure. Do not use toasts for errors the user needs to
  read carefully.

## Supabase
- Use `@supabase/ssr`: `createServerClient` (with cookies) for the server and
  `createBrowserClient` for the client, each created once in `lib/supabase/`.
- Authenticate on the server with `getUser()` or `getClaims()`. `getSession()` reads
  unverified cookie data and is not trusted on the server.
- **RLS is enabled on every table**, with policies scoped to `auth.uid()` for each
  operation. Use the service-role client only in server code that must bypass RLS
  (webhooks, background jobs), and even there scope every query to the correct owner
  explicitly.
- Every schema change is a migration in `supabase/migrations`. Never edit the schema in
  the dashboard. Add indexes for foreign keys and filtered columns. Use `timestamptz`.
- Always check `{ data, error }`. Map errors to user-safe messages and log the original
  on the server.
- **Guests are anonymous users.** A visitor's first action calls `signInAnonymously()`;
  the workspace row has `owner_id = auth.uid()`, so one RLS scheme covers guests and
  Google users. "Continue with Google" is `linkIdentity({ provider: "google" })` (manual
  linking must be enabled). If the Google identity already has a user
  (`identity_already_exists`), sign in with Google, keep the guest user id in a
  short-lived httpOnly cookie, show the keep/merge choice, and re-parent rows with the
  service role in one transaction. Enable Turnstile on anonymous sign-ups. Bump
  `workspaces.last_active_at` from middleware; the daily `guests.purge` job calls
  `purge_guests()`, which deletes `is_anonymous` users idle for 30 days (FK cascades do
  the rest). Restrictive policies on `connections` and
  sends require `not is_anonymous`.
- Set `cookieOptions.httpOnly` on `createServerClient` and keep data access server-side.
  If browser Realtime needs a session, pass a short-lived token from a Server Component or
  poll; never make the session cookie script-readable.
- **OAuth tokens** (Google, Slack) are encrypted in the app, not in Postgres: AES-256-GCM
  with `crypto.createCipheriv`, a 12-byte IV and the auth tag, stored as
  `{kid, iv, tag, ct}` in `connections`, key in `TOKEN_ENCRYPTION_KEY`, rotation by a new
  `kid` and lazy re-encryption. Do not use Vault (its key is Supabase-held and the
  decrypted view is all-or-nothing) or pgsodium (pending deprecation). `connections` has
  RLS that denies all client access; only the service-role client reads it, inside a
  send job.
- Storage: recordings stay in Attendee's storage (never copy them). All audio we hold —
  the seed recordings — lives in a **private** Storage bucket and is served through
  server-signed URLs (one hour), including to anonymous visitors. Signed-URL creation is
  rate-limited per workspace. Nothing is in a public bucket. The free tier's 5 GB egress
  is the limit to watch.
- **State changes go through SQL functions**, one transaction each, `security definer`
  with `set search_path = ''`, checking `auth.uid()` or an explicit workspace id. Call
  them with `supabase.rpc(...)` through typed wrappers in `lib/db/`. Application code
  never updates a state column directly. Rate limits are checked inside the same
  function with `consume_quota`.
- Full-text search: a `tsvector` generated column with a GIN index on segments, summaries,
  notes and cards; query with `websearch_to_tsquery`. Add a normalisation column for
  Roman Urdu spelling variants. ParadeDB `pg_search` is not a native extension; skip it.
- No pg_cron. Scheduling is the `jobs` table plus the daily Vercel cron (see Background
  jobs). The cron also writes a heartbeat row so the free project doesn't pause after 7
  idle days. Only two projects fit the free tier (production and staging).
- Realtime: subscribe only where the user is waiting on a live change (such as bot
  status), and clean up the subscription on unmount. If the httpOnly session can't be
  used by the browser client, poll every 5 s instead.

## Zod
- Define each schema once (`lib/schemas/`) and share it between the client and the
  server. Infer types with `z.infer`.
- The project uses **Zod 4**. Use `safeParse` at boundaries, not `parse` inside a
  try/catch. Turn the result into field errors with `z.flattenError()`. (`flatten()` is
  Zod 3; only use it if `package.json` says otherwise.)
- Coerce form and query strings explicitly (`z.coerce.number()`). Trim strings and bound
  their length. Use `.strict()` or strip unknown keys on external payloads.
- Validate env vars, webhook bodies, and LLM JSON output, not just forms.

## Vitest and PGlite
- Put each test next to its code (`*.test.ts`). Use the `node` environment for server
  code and `jsdom` or `happy-dom` plus Testing Library for components.
- Database tests live in `tests/db/` and run the real `supabase/migrations` in PGlite
  (in-process Postgres, no Docker). A test prelude creates a stub `auth` schema whose
  `uid()`, `jwt()` and `role()` read a session setting, so RLS policies run unchanged.
  Set the setting per test to act as workspace A, workspace B or `anon`. A migration that
  needs a Supabase-only extension starts with `-- pglite: skip` and is not loaded.
- For every table: A cannot read or write B; `anon` reads seed rows only. For every SQL
  function: the rule it enforces, including the double-click, the stale lease and the
  backwards transition.
- Test behaviour through public interfaces. Mock the network (MSW or `vi.mock` on the
  SDK client), not your own modules.
- Use deterministic time (`vi.useFakeTimers`) and deterministic IDs. Leave no shared
  mutable state between tests.
- Make `vi.mock` factories type-safe and reset mocks in `beforeEach`.

## Playwright
- Write one spec for each critical journey plus its main failure path. Use `getByRole`
  and `getByLabel` locators and web-first assertions (`await expect(...).toBeVisible()`).
  Never use `waitForTimeout`.
- Authenticate once with a setup project and `storageState`. Seed test data through the
  API or SQL, not the UI.
- Stub third-party services (Attendee, Claude) with `page.route` or a test-mode server
  flag. E2E tests never launch real bots or spend real tokens.
- Every spec runs `@axe-core/playwright` at 375px and 1280px and fails on serious or
  critical violations.
- Use Playwright for the browser check too: screenshots at 375px and 1280px.

## Vercel
- Keep env vars separate for Development, Preview and Production, and keep secrets out
  of `NEXT_PUBLIC_*`. There is one Supabase project; previews share it, so the test modes
  (`ATTENDEE_MODE=fake`, `AI_MODE=fixture`, `AUTH_TEST_MODE`, `PROVIDERS_MODE=fake`) are
  set only in the Preview environment and `env.ts` refuses them when
  `VERCEL_ENV=production`. Never run a destructive migration from a preview.
- Watch the function duration limits (Hobby: 300 s). Long work (waiting on a bot, long
  LLM runs) runs as jobs from the `jobs` table inside `after()` (from `next/server`),
  never inside the response itself.
- Hobby cron runs once a day with up to an hour of slop. `GET /api/cron/daily` (checks
  `CRON_SECRET`) writes the Supabase heartbeat and kicks due jobs.
- Hobby is non-commercial only. Before a public launch, confirm the plan with the product
  owner (Pro is US$20/month).
- Webhook route handlers return quickly (2xx) after verifying and storing the event, and
  leave the heavy processing to jobs. The one exception is the live command path in the
  Attendee handler (see Attendee).
- Set `export const runtime` deliberately. The Node runtime is needed for most SDKs and
  for `crypto` HMAC.

## Background jobs
No worker, no queue service. Jobs are rows in Postgres; our own functions run them.
- Table `jobs(id, workspace_id, kind, payload, idempotency_key unique, run_at,
  lease_until, attempts, max_attempts, status, last_error_code, …)`. Job kinds are
  `noun.verb` (`summary.generate`, `card.send`). Payloads are validated with Zod on both
  enqueue and run.
- **Enqueue** inside the SQL function that decided the work, with an idempotency key, so
  a repeated decision never makes a second job. Then call `after(runJobs)` from the action
  or handler.
- **Claim** with `claim_jobs(runner_id, n)` (`FOR UPDATE SKIP LOCKED`, 5-minute lease,
  `attempts + 1`). **Finish** with `complete_job` or `fail_job`. After `max_attempts`
  (3) the job is `failed` and the meeting or card shows it with a retry button.
- **Runner**: `runJobs(deadline)` in `lib/jobs/run.ts` runs claimed jobs one at a time
  until 240 s have passed, then, if work remains, POSTs `/api/jobs/kick` with
  `JOBS_KICK_SECRET` and exits. The kick route only calls `after(runJobs)` and returns
  202. Renew the lease between long steps.
- **Kicks** come from every mutation that enqueued work, every webhook, the daily cron,
  and the dashboard request path when a job is due. Timed jobs (`run_at` in the future)
  run at the first kick after `run_at`, so they can be late on a quiet day.
- **The pipeline is a chain of jobs**, one per unit of work, each with its own
  idempotency key, so a retry never repeats a finished Claude call. Each job enqueues the
  next when it completes.
- **The live transcript never goes through jobs.** Handle `transcript.update` in the
  webhook request. Only draft commands (email, invite, reminder, Slack) enqueue a
  `card.draft` job.
- Recurring jobs (guest purge, card nudge, heartbeat) re-enqueue themselves with the next
  `run_at` on completion.

## Claude API
- Before writing or changing any Claude call, load the `claude-api` skill for current
  model IDs, parameters, and SDK usage. Do not write these from memory.
- Use `@anthropic-ai/sdk` directly (not the Vercel AI SDK), server-only, from one module
  (`lib/ai/call.ts`). The model is **Sonnet** (`claude-sonnet-5-5`) for every job, read
  from the `CLAUDE_MODEL` environment variable (validated in `env.ts`), never hard-coded
  at call sites, so Haiku can be switched in with no code change. Use
  `output_config.effort: "low"` for live answers and commands.
- **Every call has no `tools` and a JSON schema** (`messages.parse` with
  `zodOutputFormat(schema)`, read `parsed_output`). There is no tool-use path anywhere. A
  null `parsed_output` means the parse failed: retry once, then fail the job.
- Sonnet 5.5 rejects non-default `temperature` and `top_p`, assistant prefill and
  `budget_tokens`. Don't set them.
- **The transcript is data.** Pass it as a delimited block of
  `[segment_id] [speaker] [mm:ss] text` lines, cached as the prompt prefix, with a system
  prompt that says it is data and that every claim must cite a `segment_id` and `quote`
  the words it rests on. The same applies to command text and memory entries.
- **Check every output against the transcript before storing it** (`lib/ai/ground.ts`):
  each claim's `segment_id` must exist in the meeting and its `quote` must be found in
  that segment's text (whitespace and case normalised). Drop failing claims and count
  them; if more than a quarter fail, fail the job and store nothing. `store_claims` in
  SQL applies the same rule as a second guard.
- Set a sensible `max_tokens`. Handle `stop_reason` values such as `max_tokens` and
  `refusal`. Use prompt caching on the transcript prefix (minimum 512 tokens, 5-minute
  TTL; the 1-hour TTL costs 2× to write and is only worth it for live answers spaced out
  over a long call). Use the Batch API (50 % off) for seed-time generation.
- Log `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`
  and `usage.cache_read_input_tokens` per request, with the meeting and workspace, so cost
  per meeting is known.
- Stream responses that the user watches. Handle 429 and 529 with the SDK's retries and
  backoff, and show a clear error in the UI.
- Count tokens and chunk transcripts that are too long for the context window. Record
  cost and usage per request.

## Attendee meeting bot
Attendee is an API for meeting bots (Zoom, Google Meet, Teams) that join meetings,
record them and transcribe them. Check the current docs at docs.attendee.dev before
relying on endpoint shapes.
- Call the Attendee API only from the server, with the API key in a server env var.
  Store the Attendee bot ID next to the owning workspace and meeting in Supabase.
- Launching a bot is a paid, externally visible action ($0.50 per bot-hour after five
  free hours). Validate the meeting URL with Zod, check that the workspace is allowed to
  launch it and is under its bot-hour quota, and prevent duplicate launches with
  Attendee's `deduplication_key` (set it to the meeting id) plus a unique constraint per
  meeting.
- Create bots with: `bot_name: "AFK.ai Notetaker"`, no bot image,
  `recording_settings: { format: "mp4", view: "speaker_view", resolution: "720p" }`,
  `automatic_leave_settings: { waiting_room_timeout_seconds: 300,
  silence_timeout_seconds: 600, silence_activate_after_seconds: 600,
  max_uptime_seconds: 10800 }`, and the Deepgram transcription settings
  (`language: "multi"`). Check `docs.attendee.dev/api-reference` for the exact field
  names before relying on them.
- **Transcription is not included in the bot hour.** Platform closed captions are the
  **default** because they are free. `TRANSCRIPTION_PROVIDER=deepgram` switches to our
  own Deepgram key, saved in the Attendee project (free while the $200 credit lasts,
  then about $0.35/hour), in multilingual mode when the Summon form's language is
  "English and Urdu". Record transcription cost per meeting. Non-Latin segments
  (Devanagari U+0900–097F, Arabic script U+0600–06FF) go through a Sonnet
  transliteration job to Roman Urdu before anything else uses them.
- **Webhooks**: verify `X-Webhook-Signature` before doing anything else. It is an
  HMAC-SHA256 computed over the payload serialized as canonical JSON (sorted keys,
  compact separators). The key is the project's webhook secret, base64-decoded, and the
  digest is base64-encoded. Compare with `crypto.timingSafeEqual`. Reject the request if
  verification fails. There is no timestamp in the scheme, so store each delivery's
  `idempotency_key` in `webhook_deliveries` and ignore repeats (Attendee retries up to
  three times).
- Event triggers include `bot.state_change`, `transcript.update`,
  `participant_events.join_leave`, `chat_messages.update` and `calendar.*`. Store each
  event, dedupe it (events can repeat and arrive out of order), and update the meeting's
  state machine. Ignore transitions that go backwards.
- **Live path.** `transcript.update` arrives per utterance (after a speaker pause) with
  `speaker_name`, `speaker_uuid`, timestamps and text. In the webhook handler, in this
  order: verify the signature, upsert the segment, run a cheap keyword check for an
  utterance that starts with "AFK" from the sender's `speaker_name`, and only then call
  Claude. Capture commands write rows directly; questions post the answer with
  `POST /bots/{id}/send_chat_message` (`message`, `to: "everyone"`); draft commands
  enqueue a `card.draft` job. All of this fits in one request, well under 15 s. Nothing
  on the live path waits for the job runner.
- Fetch the transcript and the recording URL after the bot reports that post-processing
  has completed, not when the meeting ends. Then enqueue the pipeline's first job. The
  recording URL is a short-lived signed S3 URL: read its expiry from the URL and request
  a fresh one on demand; never store it.
- Deleting a meeting calls `POST /bots/{id}/delete_data` (allowed only once the bot is
  `ended` or `fatal_error`) and retries until Attendee confirms.
- Handle failure states (the bot is not admitted, kicked out, or hits a fatal error) as
  first-class UI states with a clear message and a retry where it makes sense.
- Meeting participants are third parties. Make it clear in the UI that a bot is
  recording, and keep recording and transcript data private to the owner.
