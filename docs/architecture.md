# AFK.ai architecture

How AFK.ai is put together as built: the parts, the data model, how AI output is made,
and how it is deployed. [requirements.md](requirements.md) says what the product must do
and holds the requirement IDs used below. [system-design.md](system-design.md) holds the
operating rules: who can do what, the security controls, the limits and the known gaps.
[data-flows.md](data-flows.md) follows each feature from its first input to its last
output. [conventions.md](conventions.md) says how code is written.

## Principles

1. **Nothing to run or pay for beyond Claude.** No worker, no container, no queue
   service, no paid tier. The app runs on Vercel's and Supabase's free plans, plus
   Attendee's and Deepgram's free allowances.
2. **The database enforces the rules.** Row Level Security on every table. State changes
   happen in SQL functions, one transaction each. Caps and rate limits are counted in the
   database, so they hold across function instances. A send is recorded in the database
   before it happens.
3. **The transcript is data, never instructions.** Claude is called with no tools and a
   JSON schema. Every output is validated and checked against the transcript before it
   is stored.
4. **Guests are real users.** A visitor's first write creates a Supabase anonymous user,
   so one `auth.uid()` scheme covers guests and Google users alike.

## The stack

Versions are the ones in `package.json`.

| Area | Choice | Why | Sources |
|---|---|---|---|
| Frontend | **Next.js 16.3** (App Router, `next` 16.3.8), **React 19.3**, **TypeScript 5.9** strict, **Tailwind 4.3**, shadcn/ui patterns in `src/components/ui/`, `lucide-react` icons, `framer-motion` on the landing page | Server Components keep private data and signed links on the server; `after()` runs jobs once the response is out; `src/proxy.ts` is the Next 16 proxy | https://nextjs.org/blog · https://react.dev/versions · https://github.com/tailwindlabs/tailwindcss/releases · https://ui.shadcn.com/docs/changelog |
| Runtime and tooling | **Node 24**, **pnpm 10.34.6** (`packageManager`) | One runtime for the app, the import script and the tests | https://nodejs.org/en/about/previous-releases |
| Database, auth, storage | **Supabase** (one free project, `@supabase/supabase-js` 2.117, `@supabase/ssr` 0.12): Postgres with RLS on every table, anonymous sign-in for guests, Google sign-in with manual identity linking, a private Storage bucket for the seed audio. Seed audio is AAC `.m4a` at 64 kbit/s, made with macOS `afconvert` by `tools/icsi/encode_audio.sh` | One service for data, auth and files; anonymous users give guests an `auth.uid()`; `linkIdentity` turns a guest into a Google user without losing their rows. Free plan: 500 MB database, 1 GB storage, 5 GB egress; a project pauses after 7 days without activity | https://supabase.com/pricing · https://supabase.com/docs/guides/auth/auth-anonymous · https://supabase.com/docs/guides/auth/auth-identity-linking · https://supabase.com/docs/guides/platform/free-project-pausing · https://supabase.com/docs/guides/storage |
| Hosting | **Vercel** (Hobby, one project), functions in `bom1`, one daily cron | Zero-config Next.js; 300 s functions; the daily cron keeps the free Supabase project awake. Hobby cron runs once a day | https://vercel.com/docs/plans/hobby · https://vercel.com/docs/functions/limitations · https://vercel.com/docs/cron-jobs/usage-and-pricing |
| Meeting bot | **Attendee** (hosted, attendee.dev). Records 720p speaker-view MP4; transcribes from **the platform's captions**, or through **Deepgram** (multilingual by default) when `ATTENDEE_TRANSCRIPTION=deepgram` | Live utterances with speaker names, chat messages, signed webhooks with an idempotency key, `delete_data`. Free bot hours, then $0.50 per bot-hour. Captions cost nothing; Deepgram has a free credit, then a per-minute price | https://attendee.dev/pricing · https://docs.attendee.dev/guides/transcription · https://docs.attendee.dev/guides/webhooks · https://deepgram.com/pricing |
| AI | **Claude API** through `@anthropic-ai/sdk` 0.132. Model from `CLAUDE_MODEL`, default `claude-sonnet-5-5`. No tools; a JSON schema on every call; prompt caching on the transcript block | One model to prompt-test; the SDK validates the output against the Zod schema; with no tools, nothing in a transcript can trigger an action | https://platform.claude.com/docs/en/about-claude/pricing · https://registry.npmjs.org/@anthropic-ai/sdk/latest |
| Background jobs | **The `processing_jobs` table with leases.** The app's own functions run due jobs after a response (`after()`); the kick route chains a fresh function when the budget runs out | Nothing extra to run; `for update skip locked` leases are safe under concurrency; chaining stays inside the 300 s limit; a cut-off runner's lease expires and the next kick picks the job up | https://nextjs.org/docs/app/api-reference/functions/after · https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE |
| Validation | **Zod 4.6** at every boundary | One schema per shape: request bodies, URL parameters, environment, webhooks, imported transcripts, model output | https://registry.npmjs.org/zod/latest |
| Testing | **Vitest 5** for unit tests; **PGlite 0.5** for database tests that run the real migrations (`supabase/tests/`); **Playwright 1.63** with `@axe-core/playwright` for the journeys in `e2e/`. GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm check` | No Docker; RLS and the SQL functions are tested against real Postgres in-process | https://github.com/vitest-dev/vitest/releases · https://pglite.dev/ · https://playwright.dev/docs/release-notes · https://github.com/dequelabs/axe-core-npm/releases |
| Security | State changes in SQL functions; signed, idempotent webhooks; secrets only in environment variables; logs with identifiers and counts only; rate limits in the database; every send gated so it runs at most once | Every rule that must hold is enforced where the data lives | [system-design.md](system-design.md) |

## Rejected, with the reason

| Rejected | Reason |
|---|---|
| A separate worker or container (Railway, Fly, Render, a VPS) | Adds a service to run and pay for. |
| A queue service (Inngest, Trigger.dev, Upstash QStash, pgmq with Edge Functions) | Postgres leases are enough at this scale. |
| Any paid tier (Vercel Pro, Supabase Pro, Cloudflare Workers Paid) | The project must cost nothing beyond Claude. |
| Cloudflare R2 for seed audio | Private Supabase Storage with signed links does the job with one fewer vendor. |
| A second, cheaper model for the light jobs | One model to prompt-test and verify. `CLAUDE_MODEL` can switch it with no code change. |
| The Vercel AI SDK | Wraps the usage fields and lags the API; the direct SDK with a JSON schema is simpler. |
| pgTAP on the Supabase local stack | Needs Docker. PGlite runs the same migrations in-process. |
| pg_cron | The jobs table plus the daily Vercel cron is one scheduling system instead of two. |
| React Router 8, SvelteKit, TanStack Start | No stable Server Components, or leaving React; more risk for one developer. |
| Neon with Better Auth and R2; Convex with Clerk | Three vendors to wire and hand-rolled RLS, or no Postgres RLS at all and strong lock-in. |
| Recall.ai; Meeting BaaS; self-hosting Attendee | Storage fees and an English-only live mode; undocumented chat, auto-leave and delete; or a server to run. |
| Jest; Cypress | ESM transforms; accessibility and parallel runs push toward a paid cloud. |
| Supabase Realtime for live page state | Pages that wait on work re-fetch every ten seconds while the tab is visible; nothing else needs a socket. |

## Components and how they connect

| Part | Runs on | Does |
|---|---|---|
| Web app (Next.js) | Vercel Hobby, functions in `bom1` (`vercel.json`), next to the database | Pages, the API routes, the Attendee webhook, the daily keep-alive cron, and the job runner (`src/features/processing/`, started by `src/server/jobs.ts` after a response). `src/proxy.ts` runs first on every page and route |
| Postgres, Auth, Storage | Supabase Free, `ap-south-1`, project `afk-ai` | All data, with RLS on every table. Anonymous identities for guests and Google for those who continue with Google. The private `audio` bucket for the seed recordings |
| Claude API | Anthropic, `ANTHROPIC_API_KEY` | `CLAUDE_MODEL` (default `claude-sonnet-5-5`) with no tools and a JSON schema: analysis, summaries, the command parse, learned lines, live answers, Roman Urdu transliteration |
| Attendee | attendee.dev, `ATTENDEE_API_KEY`, `ATTENDEE_WEBHOOK_SECRET`, `ATTENDEE_API_URL` (default `https://app.attendee.dev`) | The meeting bot "AFK.ai Notetaker". Joins Zoom, Meet or Teams, records video that stays in its storage, transcribes from captions or Deepgram (`ATTENDEE_TRANSCRIPTION`, `ATTENDEE_DEEPGRAM_LANGUAGE`), posts in the meeting chat, sends signed webhooks, forgets a bot's data on request |
| Google and Slack | OAuth clients: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Google sign-in, and the connectors: Gmail send, Calendar events, Contacts read, Slack posts |

```
Browser ──► src/proxy.ts ──► Next.js on Vercel (bom1) ──► Supabase ap-south-1
                              │   ▲        │ after()        (Postgres + RLS, Auth, Storage)
                              │   │        ▼                        ▲
                              │   │     job runner ──► Claude API   │ service role
                              │   │        │ ──► Gmail, Calendar, Slack (approved commands)
                              ▼   │ signed webhooks                 │
                           Attendee ──► captions or Deepgram        │
                                                                    │
   Vercel cron, 06:17 UTC ──► /api/cron/keepalive ──────────────────┘
   a run out of budget    ──► POST /api/jobs/kick (CRON_SECRET) ──► the next run
```

No queue service, cache, worker or extra backend: Postgres leases the jobs and the app's
own functions run them.

## Data model

Thirty-nine migrations in `supabase/migrations/`, from `20261016000001_meetings_and_turns.sql`
to `20261016000039_meeting_links.sql`, make 25 tables in `public`. Every table has RLS
on. "Owner" is the column that ties a row to a user; a row reached through a meeting
belongs to the meeting's owner.

### Meetings and transcripts

| Table | Owner | Purpose |
|---|---|---|
| `meetings` | `owner_id` (null for a public seed meeting) | One meeting: title, date, `duration_sec`, `audio_path` (seed) or `video_ref` (a bot meeting's Attendee bot id), `status` (`scheduled`, `requested`, `recording`, `transcribed`, `ready`, `failed`), `transcript_hash`, `ai_headline`, `analyzed_at`, `summarized_at`, the bot fields (`bot_id`, `meeting_url`, `sender_names` (at most 12), `scheduled_for`, `calendar_event_id`, `refusal_noticed_at`: when a non-sender was told once that only the sender gives commands), the sender found by the parse (`host_speaker_code`, `host_detected_by`: `name` when one speaker's label matched, `only` when the meeting has a single speaker) and the wrap-up fields (`reviewed_at`, `rating`, `review_note`, `nudged_at`) |
| `meeting_speakers` | via meeting | The speakers of a meeting, key `(meeting_id, code)`; `is_host` from Attendee is informational |
| `transcript_turns` | via meeting | Immutable turns with start and end seconds, a foreign key to the speaker, a `tsv` column with a GIN index for search |
| `live_utterances` | via meeting; no user grants | What the bot hears during the call, keyed by Attendee's idempotency key; deleted at ingest or after a day |
| `live_replies` | none; service role only (no policy, no user grants) | The answers AFK posted in the meeting chat, one per live command, written by `finish_live_answer()` |
| `meeting_links` | via meeting; the owner reads, nobody writes from the browser | The meeting's address: a twelve-character code for `/m/<code>`, a four-digit PIN, `enabled` (A1) |
| `meeting_link_tries` | none; service role | Wrong PINs per code and client key, with `locked_until` |

### AI output and processing

| Table | Owner | Purpose |
|---|---|---|
| `processing_jobs` | via meeting; the service role writes | The job queue: `kind`, `status` (`queued`, `running`, `done`, `failed`), `run_after`, `lease_until`, `claim_token`, `attempts` and `max_attempts`, `command_id`, `effect_at`, a report |
| `chapters` | via meeting | Chapters, each starting at a real turn (`first_turn_id`) |
| `meeting_items` | via meeting | Summary points, action items, decisions and notes (`kind`: `point`, `action`, `decision`, `note`; `source`: `ai`, `command`), with a `tsv` index |
| `item_citations` | via meeting | Item to turn, with a foreign key on `(meeting_id, turn_id)`, so the database proves every citation |
| `meeting_commands` | via meeting; owner-only | What the sender told AFK: `source` (`spoken`, `typed`, `live`), the cited turn, `kind`, arguments, `status` (`detected`, `applied`, `proposed`, `unparsed`, `approved`, `running`, `done`, `failed`, `dismissed`, `skipped`), the item or highlight it made; for the external kinds `approved_args`, `executed_at` and the result; `live_seq` orders a meeting's live commands. Kinds: the eleven a user can give (`task`, `decision`, `note`, `highlight`, `remember`, `email`, `followup`, `remind`, `slack`, `ask`, `recap`) and the internal `unknown`, a sender's wake-word sentence AFK did not understand, shown as a "not understood" card |

### What a user makes

| Table | Owner | Purpose |
|---|---|---|
| `highlights` | `owner_id` | Clips `[start_sec, end_sec)` on a meeting the owner can read, clamped to the recording, at most 600 s long (`highlights_max_length`), at most 300 per identity; `command_id` when a spoken or typed command made it |
| `share_links` | `owner_id` | A clip's public link: a 64-hex token minted by the database, `revoked_at` |
| `item_states` | `owner_id` | Private ticks, key `(item_id, owner_id)` |
| `access_requests` | `requested_by` | Gmail addresses to add as Google test users; insert-only from the browser |

### Memory and connectors (Google users only)

| Table | Owner | Purpose |
|---|---|---|
| `memory_files` | `owner_id` | The nine markdown files, key `(owner_id, path)`, 32 KB each, `updated_by` (`you` or `afk`); RLS and the functions refuse a guest |
| `contacts` | `owner_id` | People AFK knows, one row per address, with `source` (`approval`, `people_file`, `google_contacts`, `google_other`, `calendar`), `aliases`, `uses`, `last_used_at`; written only by `learn_contacts()`. Users hold select and delete only (migration 42 revokes Supabase's default grants) |
| `connectors` | `owner_id` | One row per provider (`google`, `slack`): account, scopes, config such as the Slack channel, `status` (`connected`, `expired`, `revoked`), `connected_at` |
| `connector_secrets` | none; service role only | The sealed token for one connector |

### Limits and bookkeeping (service role only)

| Table | Purpose |
|---|---|
| `app_settings` | Deployment settings, such as `bot_daily_cap` |
| `bot_requests` | One row per bot sent, kept a day: the daily caps per identity and per place |
| `visitor_writes` | The one-minute log behind the write limit |
| `read_hits` | The one-minute log behind the public read limits, keyed by a hashed client key |
| `cron_runs` | One row per keep-alive run with its counts: `meetings`, `pruned` (write-limit rows), `swept`, `purged`, `jobs_pruned`, `utterances_pruned` |
| `live_replies`, `live_utterances`, `meeting_link_tries`, `connector_secrets` | Also service role only; listed with their areas above |

Design rules:
- **One readability rule.** `can_read_meeting()` holds the rule for every policy and for
  the write checks on highlights and ticks.
- **Few writes through the Data API.** Highlights, share links, ticks, access requests
  and a Google user's own memory files are the browser-writable tables, through column
  grants; triggers count each write against the same limit. Everything else changes
  through a SQL function or the service role.
- **Units in names.** Times are `numeric(10,3)` seconds named `*_sec`. `duration_sec` is
  the single timeline length.

### Helper functions, triggers and indexes

Besides the functions named elsewhere in this document, these SQL objects do work the
rest of the system relies on.

| Object | Kind | What it does |
|---|---|---|
| `set_updated_at()` | Function, used by the `*_set_updated_at` triggers | Stamps `updated_at` on meetings, jobs, highlights, ticks, commands and connectors |
| `item_citations_same_meeting` | Function and trigger | Refuses a citation whose item belongs to another meeting (23514) |
| `can_tick_item()` | Function | A tick is allowed only on an action item of a meeting the caller can read |
| `clamp_highlight()` / `highlights_clamp` | Function and trigger | Keeps a highlight inside the recording |
| `cap_highlights()` / `highlights_cap`, `cap_share_links()` / `share_links_cap` | Functions and triggers | The 300-highlight and 50-link caps |
| `cap_meeting_commands()` / `meeting_commands_cap` | Function and trigger | The 20 spoken and 20 typed commands a meeting |
| `memory_files_user_write` | Function and trigger | On a user's own write, stamps `updated_by = 'you'` and `updated_at` and counts it against the write limit |
| `note_meeting_in_history()` | Function, service role | Appends a meeting's line to `history/meetings.md` with its count of open action items |
| `apply_learned()` | Function, service role | Writes a `learn` job's lines into the three context files through `append_memory_lines()` |
| `clear_generation_marks()` / `meetings_clear_generation_marks` | Function and trigger | A changed `transcript_hash` clears `analyzed_at` and `summarized_at` |
| `queue_owner_note()` / `meetings_owner_note` | Function and trigger | Queues `notify_owner` for a Google user whenever `summarized_at` is set or changes |
| `make_meeting_link()` / `meetings_make_link` | Function and trigger | Makes the meeting's address with the meeting |
| `meetings_wrap_up` | Index | The owner's newest ready, summarised, unreviewed meeting, for the wrap-up prompt |
| `meetings_scheduled` | Index | Scheduled bots by `scheduled_for` |
| `highlights_command_idx` | Index | Highlights made by a command |
| `contacts_owner_rank` | Index | A user's contacts by uses, then last use |
| `processing_jobs_running_lease_idx` | Index | Running jobs by `lease_until`, for the claim sweep |

## Processing

### The queue

`processing_jobs` holds one row per piece of work for a meeting. The kinds:

| Kind | What it does | Claude |
|---|---|---|
| `ingest_media` | A bot meeting: fetch Attendee's transcript, read the recording's length from the MP4 header in a few range requests, romanize Devanagari or Arabic-script turns, store the turns with `ingest_transcript()`, then `finish_ingest()` | Only to romanize |
| `detect_commands` | Find the sender's "AFK, …" turns with a fixed pattern, apply the internal commands, parse the model-needing ones, then `apply_commands()` | One call when a command needs the model |
| `analyze` | Headline, chapters, action items, decisions | One call |
| `summarize` | All four templates in one output | One call |
| `learn` | At most ten learned lines for a Google user's memory, after `summarize` | One call |
| `answer_in_meeting` | Answer a live `/ask` or `/recap` in the meeting chat | One call |
| `run_command` | Carry out an approved email, follow-up, reminder or Slack post | None |
| `notify_owner` | One email to a Google user when the notes are written | None |

Only the database creates jobs: the seed import, the Attendee webhook through
`mark_bot_finished()` and `record_live_utterance()`, a typed command, an approval
(`approve_command()`), a rewrite (`rewrite_command()` queues `detect_commands`), the notes
chain (`complete_job()` queues `learn` after `summarize`; the `meetings_owner_note`
trigger queues `notify_owner`), and the daily keep-alive's calendar scheduling, whose
scheduled bot meetings queue their work through the webhook when the call ends.

`claim_job(worker, kinds, lease, meeting)` first returns expired leases to the queue (or
fails them after `max_attempts`, three), then takes one due job under `for update skip
locked`: the kicked meeting first, live answers and approved commands before notes. It
sets `claim_token` and `lease_until` and adds an attempt. `complete_job()` publishes the
output only while the job is still `running` with that claim token; it does not read
`lease_until`, so a run past its lease still publishes until the next sweep clears the
token (audit D11, F24). The outcomes are `done`, `skipped`, `failed` (due again after 1
minute, then 4 minutes; the third failure is final), `rejected` (the database refused the
output, so the job ends at once) or `release` (back to the queue at a later time without
using an attempt).

### The runner

`runJobs()` in `src/features/processing/runner.ts` is a function of a service-role client,
a config and a time budget. `src/server/jobs.ts` builds those and starts it.

- **Budget.** Each function has 300 s (`maxDuration`); a kick spends at most 270 s, of
  which 20 s is headroom. A job starts only with more than 45 s left, and its lease
  lasts the remaining budget plus 60 s, so a cut-off job is freed soon after. A job's
  Claude call gets the remaining budget less 5 s, so at most about 245 s; `claude.ts`
  falls back to 240 s only when no timeout is passed.
- **Errors.** A rate limit or outage at Anthropic releases the job and ends the run. A
  missing or refused API key releases it for ten minutes and ends the run. An
  unreachable service releases it for five minutes. Output that `complete_job()` refuses
  to store ends the job as `rejected`, and so does a transcript that `ingest_transcript()`
  refuses (`RefusedError` in `jobs.ts`), so it is not fetched and romanized again. Anything
  else uses an attempt.
- **Who kicks.** `kickJobs()` runs the runner in `after()` from the Attendee webhook,
  the meeting page while notes or cards are pending, the typed-command, approval and
  rewrite routes, `POST /api/jobs/kick` and the daily keep-alive. A ready meeting's page
  re-kicks a job still running six minutes after its claim (`needsKick`).
- **The chain.** A run that stops on its budget with due jobs left posts once to
  `/api/jobs/kick` with `Authorization: Bearer $CRON_SECRET`. That route answers 202 and
  runs the next link after its response. The body may name a meeting, kinds and the hop.
  A run that stopped for a reason a fresh function would not change (no key, the
  provider down) does not chain.
- **The daily keep-alive.** Vercel Cron calls `GET /api/cron/keepalive` at 06:17 UTC
  (`17 6 * * *`) with the cron secret. It runs one real query so Supabase does not
  pause, prunes `visitor_writes`, sweeps stale bots (`sweep_stale_bots()`: a `scheduled`,
  `requested` or `recording` row six hours after its call was due, the scheduled time or
  else the request, so a scheduled bot in its call is never closed; migration 40),
  purges guests older than thirty days (`purge_stale_guests()`,
  then their audio, then Attendee's copy), prunes finished jobs, live utterances and PIN
  tries, schedules calendar auto-join bots, writes a `cron_runs` row, and runs whatever
  is queued with the time left.
- **Health.** `GET /api/health` reports the queue (due, scheduled, running, failed in
  the last day, the oldest wait, from `queue_status()`), the last keep-alive and which
  services are configured. It answers 503 when a due job has waited over thirty minutes.
  Public, counts only, read-limited.

## The three paths

### Request path

1. `src/proxy.ts` throttles the public read paths, sets the Content-Security-Policy with
   a fresh nonce, and refreshes the Supabase session cookie.
2. A Server Component reads data through the visitor's session with
   `createSupabaseServerClient()`. RLS decides what the query sees.
3. A write goes to a route handler under `src/app/api/`. The route validates the body
   with Zod, acts as the visitor under RLS (or makes its own access decision before using
   the secret key), and calls one SQL function or a granted insert. The first write from
   a browser with no session calls `signInAnonymously()` (`src/lib/visitor-api.ts`).
4. If the write created work, the route calls `kickJobs()`.

### Webhook path

`POST /api/webhooks/attendee`:
1. Answers 503 without `ATTENDEE_WEBHOOK_SECRET`. Reads the raw body (at most 100,000
   characters) and verifies `x-webhook-signature`, an HMAC-SHA256 over Attendee's
   canonical JSON, with a constant-time compare; 401 on a bad signature.
2. A state change to recording moves the meeting from `scheduled` or `requested` to
   `recording`. A finished or failed bot calls `mark_bot_finished()`, a compare-and-set
   that queues `ingest_media` on success; the route then kicks the runner for that
   meeting.
3. The webhook never creates or revives a meeting; it only updates rows the bot route
   made. Every write is keyed, so a redelivery changes nothing in the database.

### Live path

While the call is on, each `transcript.update` reaches the same webhook:
1. The speaker is matched by name against `meetings.sender_names`. Only the sender's
   words can be commands.
2. `record_live_utterance()` stores the utterance once, keyed by the idempotency key.
   For a sender's `/ask` or `/recap` it also inserts a `meeting_commands` row with
   `source = 'live'` and an `answer_in_meeting` job in the same transaction.
3. The webhook kicks the runner. The answer is written from the utterances so far with
   one Claude call, keeps only citations that exist (else "That wasn't discussed yet."),
   is posted to the meeting chat, and `finish_live_answer()` records it.
4. After the response, twenty seconds on, the webhook asks `claim_live_fallback()`
   whether the answer has started. Under the answer job's row lock it says yes only
   while the question is still `detected`, the job is not running on a live lease and
   nothing has been posted; it then stamps the job's `effect_at`, so
   `start_job_effect()` answers `done_before` and a later answer lands on the card only.
   The chat then gets "I'll answer this after the call". A slow answer posts itself and
   no fallback, so a question gets one chat line, never two (migration 41). Someone other than the sender who says the wake word is told
   once that only the sender can give commands. Any other spoken command gets one
   "Heard" line in the chat.

## The Claude call

`createClaudeRunner()` in `src/features/processing/claude.ts` makes every call the same
way:
- `model` from `CLAUDE_MODEL`, a fixed system line, no `tools`, and
  `output_config.format` set to a JSON schema built from the Zod schema for that run.
- The message has two blocks. The first is the big, stable data block (the transcript as
  `[turn-id] mm:ss Speaker C: words` lines) with `cache_control`, so the runs on one
  meeting read one cached prefix. The second holds the smaller data blocks (memory,
  explicit items, the commands) and, last, the instruction.
- The SDK parses the output against the schema. A refusal, an output cut off at the
  token limit, or a schema mismatch fails the run.
- The SDK does not retry (`maxRetries: 0`); the queue does.
- Every job report records the model, duration, input, output, cache read and cache
  write tokens, and an estimated cost from the price table in `claude.ts`.

Grounding happens in code before anything is stored (`src/features/summaries/grounding.ts`,
`src/features/commands/grounding.ts`, `src/features/memory/learn.ts`):
- A citation must name a turn of this meeting; the database's foreign key proves it again.
- An owner must be a speaker, or a name said in a cited turn. A due date must be words
  said in a cited turn.
- Chapters must start at real turns, in order. Summary points must belong to a known
  template and section.
- A learned line must quote at least three words of its turn.
- A parsed command argument must come from the sentence or the surrounding minute.

What fails is dropped item by item and listed in the job report by position, never by
content; whatever survives is published. There is no failure threshold that fails the
job: a `summarize` whose every template is dropped stores `{ templates: [] }` as a
success (audit D14).

## Media

| Recording | Where it lives | How it plays |
|---|---|---|
| Seed audio | The private `audio` bucket (50 MB limit, AAC or MP3), uploaded by `pnpm import:seed` under a content-addressed path | A signed link from `signAudioUrl()`: six hours for a public seed meeting, one hour for a private one |
| A bot meeting's video | Attendee's storage; the meeting holds only `video_ref`, the bot id | `mintVideoUrl()` asks Attendee for its thirty-minute link; the page asks `/api/meetings/[id]/media` (or `/api/m/[code]/media`) for a fresh one two minutes before expiry and keeps the player's place |

`src/server/media/media-url.ts` always takes the path or id from the row, never from the
request, and is called only after the caller decided the visitor may play the recording.
A shared clip of a private meeting is transcript-only.

## Auth

- **Visitors** have no session. They read the sample meetings, shared clips and meeting
  addresses with the PIN.
- **Guests.** The first write in a browser (a tick, a highlight, a bot, an access
  request) calls `signInAnonymously()`. Supabase allows 30 new anonymous identities an
  hour per address (`supabase/config.toml`). A guest owns meetings like any user. A
  guest who never continues with Google is purged after thirty days.
- **Google users.** "Continue with Google" calls `linkIdentity()` for a guest, keeping
  the same `auth.uid()` and every row, or `signInWithOAuth()` otherwise. The callback is
  `/auth/callback`; sign-out is `/auth/sign-out`. `/welcome` is for Google users only;
  the proxy sends a signed-out visitor to `/sign-in`.
- `is_guest()` and `is_google_user()` let RLS and the SQL functions refuse memory files,
  contacts and connectors to guests. `getViewer()` in `src/server/auth/viewer.ts` tells
  pages who is looking.

## Connectors and token sealing

- `/connectors/[provider]/start` refuses a guest, then starts OAuth. The state is a
  signed, short-lived cookie bound to the user and the provider (`oauth-state.ts`); Google
  also uses PKCE, offline access and forced consent.
- `/connectors/[provider]/callback` exchanges the code on the server, seals the refresh
  token (Google) or bot token (Slack) with AES-256-GCM under `CONNECTOR_TOKEN_KEY`, with
  the owner and provider as additional data (`token-crypto.ts`, version `v2`; a `v1`
  value, sealed before the binding, still opens without it), and stores it with
  `store_connector()` in `connector_secrets`, which no user role can read.
- The token is opened only in a server process: to revoke it, to list Slack channels or
  import Google contacts, and in a `run_command` job. Google's one-hour access tokens live
  in the function for one run.
- The adapters (`src/features/connectors/adapters/`: `gmail-send.ts`,
  `calendar-create.ts`, `slack-post.ts`) take `approved_args` from the database and
  nothing else. `start_command()` marks `executed_at` before the adapter call, and
  `finish_command()` records the result and a line in `history/actions.md`.

## Folder layout

| Path | Holds |
|---|---|
| `src/app/` | Routes only: pages, layouts, `loading.tsx` (most data pages have one; `/connectors`, `/dashboard/record`, `/m/[code]`, `/sign-in`, `/welcome` and `/privacy` fall back to the root `src/app/loading.tsx`), one `error.tsx` at the root, route handlers under `api/`, `auth/`, `connectors/[provider]/`, `m/[code]`, and the generated `robots.ts`, `sitemap.ts`, `manifest.ts`, `icon.svg`, `apple-icon.tsx`, `opengraph-image.tsx` |
| `src/features/<area>/` | One folder per product area: `landing`, `meetings`, `transcript`, `summaries`, `clips`, `search`, `capture` (the bot and the Send form), `commands`, `connectors`, `memory`, `meeting-link`, `processing` (the runner, the jobs and the Claude calls) |
| `src/components/` | The shell (`app-shell.tsx`, `app-nav.tsx`, `site-header.tsx`, `chrome.tsx`, `guest-notice.tsx`) and shared UI in `ui/` |
| `src/server/` | Server-only modules: `db/` (the server and admin Supabase clients), `auth/`, `media/`, `connectors/`, and `jobs.ts`, `bots.ts`, `calendar-autojoin.ts`, `calendar-invitees.ts`, `http.ts`, `log.ts` |
| `src/lib/` | Validated config (`env.ts`), the CSP builder, the read-limit keys, database types, small utilities |
| `src/proxy.ts` | The proxy: read limits, CSP, session refresh |
| `supabase/` | `config.toml`, `migrations/` (39 files) and `tests/` (PGlite) |
| `scripts/` | `import-seed.ts`, run by `pnpm import:seed` |
| `tools/` | `icsi/`: `parse_mrt.py` turns the corpus transcripts into meeting files, `encode_audio.sh` encodes the audio |
| `data/` | The seed: `meetings/` (transcripts), `ai/` (committed Claude output), `icsi-source/`, and `README.md` with the credit. `audio/` (`<id>.m4a`) is gitignored and not in the repository; it is made locally before an import (see Deployment) |
| `e2e/` | Playwright journeys with the axe scan |

## Deployment

- **Vercel** project `afk-ai`, connected to GitHub `harisshakeel/AFK-ai`, deploying
  `main` to production at https://afk-ai-tau.vercel.app. `vercel.json` sets the region
  `bom1`, skips builds for other branches (`ignoreCommand`), and declares the one cron:
  `/api/cron/keepalive` at `17 6 * * *` (06:17 UTC).
- **Supabase** project `afk-ai` in `ap-south-1`. Migrations are applied with the
  Supabase CLI; the seed is loaded with `pnpm import:seed`. The live project already
  holds the audio. To import locally, first download each meeting's mixed headset
  channel `<Id>.interaction.wav` from the ICSI corpus site
  (https://groups.inf.ed.ac.uk/ami/icsi/), encode it with
  `tools/icsi/encode_audio.sh <in.wav> data/audio/<id>.m4a` (macOS `afconvert`, 64 kbps
  AAC), then run the import. It stops with a clear error if a file is missing.
- **Environment.** The variables are listed in `.env.example` and set in Vercel. Only
  `NEXT_PUBLIC_*` values reach the browser. A missing optional service (Attendee, a
  connector, the Claude key) degrades with a visible message, and `/api/health` shows
  what is configured.
- **Security headers.** `next.config.ts` sets `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy` and `Permissions-Policy` on every response; the proxy adds the CSP.
- **CI.** GitHub Actions runs `pnpm check` on pushes to `main` and on pull requests.
  The browser journeys run locally, since they need the live database's keys.

## Cost per meeting

An estimate for a 60-minute, 8-speaker bot meeting of a Google user: a transcript of
about 16k tokens plus about 1k of system line and formatting, a 17k cached prefix. Prices
from the table in `claude.ts` for `claude-sonnet-5-5`, per million tokens: $2 input, $10
output, $2.50 cache write, $0.20 cache read. The prompt cache lasts a few minutes, so a
prefix is read only by runs that follow soon after the run that wrote it. The token
counts for outputs and side blocks are assumptions, not measurements.

| Item | Arithmetic | Cost |
|---|---|---|
| Command parse (only when a spoken command needs the model); writes the prefix | 17k × $2.50/M + 5k memory and skills × $2/M + 1.5k out × $10/M | $0.07 |
| Analysis (cache read) | 17k × $0.20/M + 2k × $2/M + 3k out × $10/M | $0.04 |
| Summaries, all four templates in one call (cache read) | 17k × $0.20/M + 2k × $2/M + 4k out × $10/M | $0.05 |
| Learned lines (cache read) | 17k × $0.20/M + 5k × $2/M + 1k out × $10/M | $0.02 |
| 5 live answers (small inputs) | 5 × (6k × $2/M + 300 out × $10/M) | $0.08 |
| **Claude, no commands or live answers** | the analysis writes the prefix: $0.08 + $0.05 + $0.02 | **≈ $0.15** |
| **Claude, with commands and 5 live answers** | the rows above | **≈ $0.26** |
| Roman Urdu, a fully Urdu hour (worst case) | about 60 KB in 6 KB chunks, ≈ 20k in and 20k out | + $0.24 |
| Attendee bot hour, after the free hours | | + $0.50 |
| Deepgram, after the free credit (captions cost nothing) | $0.0058/min × 60 | + $0.35 |

A seed meeting costs nothing at runtime when its committed output in `data/ai/` matches
the transcript; otherwise its analysis and summaries are generated on first open. Each
job's actual tokens and estimated cost are in its report.

## Known gaps in this area

Stated in full in [system-design.md](system-design.md):
- A webhook redelivery can post the "Heard" chat line again: the route ignores
  `record_live_utterance()`'s `duplicate` flag.
- Re-running the analysis deletes `item_states`, so ticks on the old items go.
- `rewrite_command()` has no cap.
- The page's media-link renewal can loop without backoff when the expiry fails to parse.
- Scheduled bots have no per-user cap, and a purged guest's scheduled bots are not
  removed at Attendee.
- A bot's id can fail to reach its meeting row, leaving a bot no webhook matches
  (audit F3).
- A parse that fails for good re-generates existing notes (audit F5).
- Publishing is gated by the claim token, not the lease (audit F24).
