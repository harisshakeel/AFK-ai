# AFK.ai — architecture

Decided 2026-10-16 by the product owner after reading the documentation for each option.
This document records the choices, how the parts fit together, what each one costs, and
what was rejected. It implements [docs/requirements.md](requirements.md) (v5). The
operating rules — who can do what, security controls, limits and known gaps — are in
[docs/system-design.md](system-design.md); how code is written is in
[docs/conventions.md](conventions.md). Per-tool rules for building are in
`.claude/skills/senior-engineer/references/stack.md`.

No code existed when this was written. Prices and versions are as of 2026-10-16, each
with a source.

## Principles

1. **Nothing to run or pay for beyond Claude.** No worker, no container, no queue
   service, no paid tier. Everything runs on Vercel's and Supabase's free tiers plus
   Attendee's and Deepgram's free allowances.
2. **The database enforces the rules.** Row Level Security on every table, state changes
   in SQL functions (one transaction each), rate limits in the database, sends recorded
   in the database before they happen.
3. **The transcript is data, never instructions.** Claude is called with no tools and a
   JSON schema; every output is checked against the transcript before it is stored.
4. **Guests are real users.** A visitor's first action creates a Supabase anonymous user,
   so one `auth.uid()` scheme covers guests and Google users alike.

## The stack

| Area | Choice | Why | Sources |
|---|---|---|---|
| Frontend | **Next.js 16** (App Router), **React 19**, **strict TypeScript**, **Tailwind 4**, **shadcn/ui** | Server Components keep private data and signed URLs on the server; `<Suspense>` streams the summary; shadcn's tokens give dark mode and AA contrast; Next 15 is end-of-life on 21 Oct 2026 | https://nextjs.org/blog · https://react.dev/versions · https://github.com/tailwindlabs/tailwindcss/releases · https://ui.shadcn.com/docs/changelog |
| Database, auth, storage | **Supabase** (one free project): Postgres with **RLS on every table**, **anonymous sign-in** for guests, **Google sign-in**, **private Storage** for audio with server-signed URLs. Seed audio is AAC `.m4a` (≈ 16 MB/hour) made with macOS `afconvert` by a script under `tools/` | One service for data, auth and files; anonymous users give guests an `auth.uid()`; `linkIdentity({provider: "google"})` is "Continue with Google"; private buckets keep audio off the public internet. Free tier: 2 projects, 500 MB database, 1 GB storage, 5 GB egress; pauses after 7 days of low activity | https://supabase.com/pricing · https://supabase.com/docs/guides/auth/auth-anonymous · https://supabase.com/docs/guides/auth/auth-identity-linking · https://supabase.com/docs/guides/platform/free-project-pausing · https://supabase.com/docs/guides/storage |
| Hosting | **Vercel** (free Hobby plan, one project) with **a daily cron** that writes a Supabase heartbeat and kicks due jobs. Preview deployments share the one Supabase project; test modes are enabled only in the Preview environment | Zero-config Next.js; 300 s functions; the cron keeps the free Supabase project awake. Hobby cron runs once a day with up to an hour of slop. Hobby is for non-commercial use (see open questions) | https://vercel.com/docs/plans/hobby · https://vercel.com/docs/functions/limitations · https://vercel.com/docs/cron-jobs/usage-and-pricing · https://vercel.com/docs/limits/fair-use-guidelines |
| Meeting bot | **Attendee** (hosted). Records 720p speaker-view MP4; transcribes with **the platform's captions by default** (free), or **Deepgram** in multilingual mode on our own key when `TRANSCRIPTION_PROVIDER=deepgram`, for calls in English and Urdu | Live utterances with `speaker_name` and `speaker_uuid`, `send_chat_message`, participant events, `automatic_leave_settings`, `deduplication_key`, `delete_data`, HMAC-signed webhooks with an `idempotency_key`. Five free hours, then $0.50 per bot-hour. Transcription is separate: Deepgram has a $200 credit (≈ 570 hours) then ≈ $0.35/hour; captions are $0 | https://attendee.dev/pricing · https://docs.attendee.dev/guides/transcription · https://docs.attendee.dev/guides/webhooks · https://docs.attendee.dev/api-reference/openapi.json · https://deepgram.com/pricing |
| AI | **Claude Sonnet 5.5** (`claude-sonnet-5-5`, read from the `CLAUDE_MODEL` environment variable so Haiku can be switched in later with no code change) via `@anthropic-ai/sdk`. **No tools; a JSON schema on every call**; the transcript passed as delimited data; prompt caching on the transcript prefix; the Batch API for seed-time generation. **Every output is checked against the transcript before it is stored** | One model to prompt-test; schema-only output validates with Zod; no tools means nothing in a transcript can trigger an action. $2 in / $10 out / $2.50 cache write / $0.10 cache read per million tokens; Batch 50 % off | https://platform.claude.com/docs/en/about-claude/pricing · https://registry.npmjs.org/@anthropic-ai/sdk/latest |
| Background jobs | **A Postgres `jobs` table with leases.** The app's own functions run due jobs **after a response** (`after()`); a **kick route** chains a new function when time runs out | Nothing extra to run; `FOR UPDATE SKIP LOCKED` leases are safe under concurrency; chaining stays inside the 300 s limit; a crashed runner just lets its lease expire | https://nextjs.org/docs/app/api-reference/functions/after · https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE |
| Validation | **Zod 4** at every boundary | One schema per shape, types inferred, `safeParse` on forms, actions, routes, env, webhooks and model output | https://registry.npmjs.org/zod/latest |
| Testing | **Vitest** for units; **PGlite** for database tests that run the real migrations; **Playwright** with an accessibility scan (`@axe-core/playwright`) for the browser | No Docker; migrations and RLS tested against real Postgres semantics in-process; Playwright + axe covers the journeys and WCAG 2.2 AA; GitHub Actions gives 2,000 free minutes a month | https://github.com/vitest-dev/vitest/releases · https://pglite.dev/ · https://playwright.dev/docs/release-notes · https://github.com/dequelabs/axe-core-npm/releases |
| Security | State changes in SQL functions, one transaction each; signed, idempotent webhooks; secrets only in environment variables; logs with ids and counts only; rate limits in the database; anything that sends runs at most once | Every rule that must hold is enforced where the data lives | [docs/system-design.md](system-design.md) |

## Rejected, with the reason recorded

| Rejected | Reason |
|---|---|
| A separate worker or container (Railway, Fly, Render, a VPS) | Adds a service to run and pay for. |
| A queue service (Inngest, Trigger.dev, Upstash QStash, pgmq + Edge Functions) | Postgres leases are enough at this scale. |
| Any paid tier (Vercel Pro, Supabase Pro, Cloudflare Workers Paid) | The project must cost nothing beyond Claude. |
| Cloudflare R2 for seed audio | Private Supabase Storage with signed URLs does the job with one fewer vendor. The 5 GB egress limit is tracked as a known gap. |
| Claude Haiku 5.5 for the cheap jobs | One model (Sonnet) to prompt-test and verify. The cost difference is an open question. |
| The Vercel AI SDK | Wraps usage fields and lags the API; the direct SDK with a JSON schema is simpler. |
| pgTAP on the Supabase local stack | Needs Docker. PGlite runs the same migrations in-process. |
| pg_cron | The jobs table plus the daily Vercel cron is one scheduling system instead of two. |
| React Router 8, SvelteKit, TanStack Start | No stable Server Components, or leaving React and shadcn; more risk for one developer. |
| Neon + Better Auth + R2; Convex + Clerk | Three vendors to wire and hand-rolled RLS, or no Postgres RLS at all and strong lock-in. |
| Recall.ai; Meeting BaaS; self-hosting Attendee | Storage fees and English-only live mode; undocumented chat/auto-leave/delete; or a server to run. |
| Jest; Cypress | ESM transforms (MSW 3 is ESM-only); accessibility and parallel features push toward paid Cloud. |

## How the parts fit

```
Browser ──► Next.js on Vercel ──► Supabase (Postgres + RLS, Auth, Storage)
                │  ▲                      ▲
                │  │ webhooks             │ service role (jobs, webhooks)
                ▼  │                      │
             Attendee ──► Deepgram   Claude API (Sonnet, JSON schema, no tools)
                                          ▲
   Vercel cron (daily) ──► /api/jobs/kick ─┘  runs due jobs, chains itself
```

### Request path (what a user does)

1. A Server Component reads data through the user's Supabase session. RLS decides what
   the query can see. Nothing private is fetched on the client.
2. A mutation is a Server Action or a Route Handler. It authenticates on the server,
   validates the input with Zod, then calls **one SQL function** that makes the state
   change in one transaction and enforces the rule (valid transition, quota, ownership).
3. If the mutation created work (a summary to generate, a card to send), the SQL function
   inserts a row in `jobs`. The action then calls `after(runJobs)` so the work starts
   before the function exits, without delaying the response.

### Webhook path (what Attendee tells us)

1. `POST /api/webhooks/attendee` runs on the Node runtime, reads the raw body, verifies
   `X-Webhook-Signature` with `timingSafeEqual`, and rejects anything that fails.
2. It inserts the delivery into `webhook_deliveries` keyed on Attendee's
   `idempotency_key`. A duplicate returns 200 and does nothing else.
3. `bot.state_change` → SQL function `transition_meeting` (ignores backwards moves).
   When post-processing is complete it enqueues the pipeline's first job.
4. `transcript.update` (**the live path**, during the call) → SQL function
   `upsert_segment`, then, still in the same request: a cheap check for an utterance that
   starts with "AFK" from the sender's `speaker_name`. Capture commands write rows
   directly. Questions call Claude and post the answer with `send_chat_message`. Draft
   commands enqueue a `card.draft` job. All of this fits in one request, well under 15 s.
   Nothing on the live path waits for a job runner.
5. The handler returns 2xx and calls `after(runJobs)`.

### Job path (what happens after a meeting)

The pipeline for one meeting is a chain of jobs, each with a unique `idempotency_key`
(`meeting:{id}:summary`, `meeting:{id}:chapters`, …), so a retry never repeats a finished
Claude call:

`fetch_transcript → transliterate (if any non-Latin segments) → summary:catch-me-up →
one_liner → chapters → action_items_and_decisions → memory_proposals → summary_email →
wrapup`

- **Claiming.** `claim_jobs(runner_id, n)` selects due rows with `FOR UPDATE SKIP
  LOCKED`, sets `lease_until = now() + lease`, increments `attempts`, and returns them.
- **Running.** `runJobs(deadline)` runs claimed jobs one at a time until the deadline
  (240 s on Vercel's 300 s limit). Each job finishes with `complete_job` or `fail_job`
  (one transaction each). A job that passes `max_attempts` is marked `failed` and the
  meeting or card shows the failure.
- **Chaining.** If work remains at the deadline, the runner POSTs to `/api/jobs/kick`
  (with a shared secret) and exits. The new function continues. If a runner crashes, its
  leases expire and the next kick picks the jobs up.
- **Kicks.** A kick happens after every mutation that enqueues work, after every webhook,
  from the daily Vercel cron, and from a lightweight check in the dashboard's request
  path when something is due. Timed jobs (`run_at` in the future, such as "remind me at
  9:00") run at the first kick after `run_at`.
- **Recurring jobs** (guest purge, 24-hour card nudge, heartbeat) re-enqueue themselves
  with the next `run_at` when they complete; the daily cron guarantees they are kicked.
- **Sends** (email, invite, Slack post) go through `card_sends` so nothing runs twice
  (see [system-design.md](system-design.md#anything-that-sends-runs-at-most-once)).

### The Claude call

Every call has the same shape:
- `model: claude-sonnet-5-5`, no `tools`, `output_config.format` set to a JSON schema
  generated from the Zod schema for that job.
- A system prompt that says the transcript is data and that every claim must cite a
  segment id and quote the words it rests on.
- The transcript as a delimited block of `[segment_id] [speaker] [mm:ss] text` lines,
  cached as the prompt prefix.
- The response parsed with Zod. A failed parse retries once, then the job fails.
- **The grounding check**, in code, before anything is stored: every claim's
  `segment_id` must exist in the meeting, and its `quote` must be found in that segment's
  text after normalising whitespace and case. Claims that fail are dropped and counted;
  if more than a quarter of a result fails, the job fails and the output is not stored.
  Memory proposals and action-item owners and dates go through the same check, which is
  how "never invents" is enforced.
- Usage (input, output, cache write, cache read tokens) is recorded per call with the
  meeting and workspace.

## Cost model per 60-minute, 8-speaker meeting

Transcript ≈ 16k tokens plus ≈ 1k tokens of instructions (17k prefix). Sonnet 5.5: $2 in,
$10 out, $2.50 cache write, $0.10 cache read per million tokens.
Source: https://platform.claude.com/docs/en/about-claude/pricing

| Item | Arithmetic | Cost |
|---|---|---|
| Attendee bot hour (after 5 free hours) | | $0.50 |
| Deepgram transcription (after the $200 credit; $0 with captions) | $0.0058/min × 60 | $0.35 |
| Catch me up summary | 17k × $2.50/M cache write + 1.5k × $10/M out | $0.058 |
| One-liner, chapters, action items and decisions, memory proposals (cache hits) | 4 × 17k × $0.10/M + 4k × $10/M | $0.047 |
| 3 more templates on demand | warm: 3 × (17k × $0.10/M + $0.015); cold: 3 × ($0.0425 + $0.015) | $0.050–0.17 |
| 10 commands (6k in, 300 out) | 10 × (6k × $2/M + 300 × $10/M) | $0.15 |
| 4 draft cards | 4 × (17k × $0.10/M + 800 × $10/M) | $0.04 |
| 5 live answers (growing cached prefix) | 40k × $2.50/M + 20k × $0.10/M + 1k × $10/M | $0.11 |
| Roman Urdu transliteration (fully-Urdu hour, worst case) | 30k × $2/M + 20k × $10/M | $0.26 |
| **Claude total, English meeting** | | **≈ $0.45 warm, $0.57 cold** |
| **All-in during free credits** | bot free hours and Deepgram credit | **≈ $0.45–0.57** |
| **All-in after free credits, Deepgram** | | **≈ $1.30–1.42** |
| **All-in after free credits, captions** | | **≈ $0.95–1.07** |

The requirements' Claude guide is US$0.40 and the all-in ceiling is US$1.00 (NFR-05,
NFR-09). With Sonnet for everything the Claude figure is just above the guide, and after
the free credits the all-in figure is above the ceiling unless captions are used. This is
recorded as open question 1 below.

## Decided since the research (2026-10-16, see [plan.md](plan.md))

- **Cost:** keep Sonnet for every call, from `CLAUDE_MODEL`; captions are the default
  transcription because they are free; Deepgram is switched on by
  `TRANSCRIPTION_PROVIDER` for English and Urdu calls. Revisit with real cost data once
  the bot works. The first real two-minute call cost about seven cents.
- **Attendee and Deepgram usage costs** are accepted as costs beyond Claude.
- **Vercel Hobby** is non-commercial for the build and demo; decided again before any
  public launch.
- **One Supabase project and one Vercel project.** Previews share the project; test
  modes (`ATTENDEE_MODE=fake`, `AI_MODE=fixture`, `AUTH_TEST_MODE`, `PROVIDERS_MODE=fake`)
  exist only in the Preview environment.
- **Roman Urdu is committed:** Deepgram multilingual mode, a language choice on the
  Summon form, and a real mixed-language test call by the owner once the bot works.
- **Google OAuth stays in Testing mode:** 100 test users, reconnect every seven days,
  shown on the Loadout page; the landing page collects Gmail addresses to add as test
  users.
- **The landing hero is a twelve-second video scrubbed by scroll**, with a play button
  under reduced motion; placeholder until the owner supplies it.
- **Seed audio** is AAC `.m4a` from `afconvert`, ≈ 16 MB per hour, so the 5 GB egress
  allows roughly 300 full plays of a seed meeting a month.

## Open questions

1. **Timed jobs can be late.** Without a worker, a job due at 9:00 runs at the first kick
   after 9:00: any mutation, any webhook, a dashboard visit, or the daily cron (±1 hour).
   On a quiet day a reminder can be up to a day late. Accepted for v1; a second daily
   cron at a different hour is the cheap fix if it matters.
2. **PGlite is not Supabase.** PGlite has no `auth` schema and not every extension.
   Database tests stub `auth.uid()`, `auth.jwt()` and `auth.role()` with a test-only
   prelude that reads a session setting; migrations avoid Supabase-only extensions or
   start with `-- pglite: skip`. Accepted; nothing Supabase-only is planned.
3. **Attendee's recording-URL lifetime** is documented only as "short-lived". The page
   reads the expiry from the signed URL (FR-03.2).
4. **Realtime with an httpOnly session.** If browser Realtime (live bot state) can't use
   an httpOnly session cookie, the page polls every 5 s. Decide at build time.
5. **The hero video's weight.** A twelve-second scrubbable video must be small enough to
   keep LCP under 2.5 s on a phone; the poster is the LCP element and the video loads
   after. Confirm the encoded size when the owner supplies it.
