# AFK.ai — system design

How the system behaves: who can do what, the security controls that enforce it, the
limits, and the gaps we know about. Written 2026-10-16 against
[docs/requirements.md](requirements.md) (v5) and [docs/architecture.md](architecture.md).
No code existed when this was written; where a table, function or route is named, it is
the name the code will use.

## Actors

| Actor | How they are identified | What it is |
|---|---|---|
| **Visitor** | No session | Someone browsing without having done anything yet |
| **Guest** | Supabase anonymous user (`is_anonymous = true`), httpOnly session cookie | A visitor after their first action; owns a workspace on this device only |
| **Member** | Supabase user with a linked Google identity | A guest who continued with Google, or someone who signed in; the same workspace on every device |
| **Sender** | A meeting participant whose platform name matches the owner's name | The owner, on the call; the only person the bot takes commands and questions from |
| **Other participant** | Anyone else on the call | Recorded, transcribed, may read chat answers; can do nothing to AFK.ai |
| **Clip viewer** | Unguessable link | Anyone with a clip link; no account |
| **PIN viewer** | Unguessable link + 4-digit PIN, then a PIN cookie | Anyone with a PIN-shared meeting link; no account |
| **Attendee** | Webhook signature + `idempotency_key` | The meeting-bot provider calling our webhook |
| **Vercel cron** | `CRON_SECRET` header | The daily kick and heartbeat |
| **Job runner** | Service-role client inside our own functions | Runs rows from `jobs`; every query scoped to a workspace explicitly |

A **workspace** is the unit of ownership. `workspaces.owner_id = auth.users.id`. Everything
a user has — meetings, segments, summaries, chapters, action items, decisions, notes,
highlights, clips, PIN shares, cards, sends, memory, connections, activity, quotas — hangs
off a workspace through `workspace_id`.

## Who can do what

| Action | Visitor | Guest | Member | Clip viewer | PIN viewer | Sender on call | Other participant |
|---|---|---|---|---|---|---|---|
| Browse seed meetings (audio, transcript, summaries, chapters, search) | ✔ | ✔ | ✔ | — | — | — | — |
| Tick, note or highlight on a seed meeting (stored per workspace) | creates a guest | ✔ | ✔ | — | — | — | — |
| Send the bot, paste a link | creates a guest | ✔ (guest quotas) | ✔ | — | — | — | — |
| See, play, search own meetings | — | ✔ | ✔ | — | — | — | — |
| Switch templates, regenerate a summary | — | ✔ | ✔ | — | — | — | — |
| Edit action items, decisions, notes, highlights; create clips | — | ✔ | ✔ | — | — | — | — |
| Typed commands after the call | — | ✔ | ✔ | — | — | — | — |
| Read, edit, download, erase memory | — | ✔ | ✔ | — | — | — | — |
| Connect Google Calendar, Gmail, Slack | — | — (asked to continue with Google) | ✔ | — | — | — | — |
| Approve a card that sends | — | — | ✔ | — | — | — | — |
| Create or revoke a PIN share; share the notes | — | — | ✔ | — | — | — | — |
| Delete a meeting; export data; delete account | — | ✔ (own) | ✔ | — | — | — | — |
| Play one clip and its transcript excerpt (private meeting: transcript only) | — | — | — | ✔ | — | — | — |
| Play a whole shared meeting: recording, transcript, Catch me up summary, navigation | — | — | — | — | ✔ | — | — |
| Spoken commands and questions during the call | — | — | — | — | — | ✔ | ✘ ignored |
| Read chat answers during the call | — | — | — | — | — | ✔ | ✔ (visible to all) |

Rules behind the table:
- A guest can do everything a member can **except** anything that needs a connected
  account (connections, sends, PIN shares and share-the-notes), because tokens belong to
  an account, and guest quotas are lower (see Limits).
- A member sees only their own workspace. There is no admin role in the product. The
  internal admin view (costs, bot hours) is a separate, environment-gated page for the
  developer, read-only, with no transcript content.
- A PIN viewer sees nothing of the owner's beyond the recording, transcript, summary and
  navigation of that one meeting: no action items, notes, cards, memory, highlights,
  other meetings, or the owner's name. A clip viewer sees even less.
- The sender is matched by **participant name only**, never by voice. No match means
  spoken commands are off for that meeting and the owner is told.

## Data model (what lives where)

| Table | Owner column | Notes |
|---|---|---|
| `workspaces` | `owner_id` → `auth.users` | `kind` (guest/member), `last_active_at`, settings, `plan_limits` overrides |
| `meetings` | `workspace_id` | state machine, Attendee `bot_id`, platform, timings, cost columns, `is_seed` |
| `segments` | `workspace_id` | speaker, start/end ms, text, `text_search tsvector`, `script` (latin/devanagari/arabic), `is_command` |
| `summaries`, `chapters`, `action_items`, `decisions`, `notes`, `highlights`, `clips` | `workspace_id` | each claim row carries `segment_id` + `quote` (grounding) |
| `seed_annotations` | `workspace_id` | per-workspace ticks, notes and highlights on seed meetings |
| `cards`, `card_sends` | `workspace_id` | card state machine; `card_sends(card_id PRIMARY KEY)` |
| `memory_entries` | `workspace_id` | section, content, `source_kind`, `source_segment_id`, `source_quote`, `status` (proposed/accepted) |
| `connections` | `workspace_id` | provider, encrypted token `{kid, iv, tag, ct}`, scopes, `broken_at`; **no client access** |
| `pin_shares`, `pin_attempts` | `workspace_id` | token, PIN hash, revoked_at, attempt counters |
| `jobs` | `workspace_id` (nullable for system jobs) | see Background jobs |
| `webhook_deliveries` | — | provider, `delivery_id` unique, received_at, status |
| `rate_limits` | `workspace_id` | `key`, `window_start`, `count` |
| `activity` | `workspace_id` | who/how/when/what for commands and cards; ids only |
| `usage` | `workspace_id` | per-call token counts and cost, per bot-hour, per transcription minute |
| `email_sends`, `memory_uses`, `calendar_events` | `workspace_id` | one row per outbound email (unique on meeting + kind); which memory entries each prompt used; this week's calendar events |
| `test_user_requests` | — | Gmail addresses from the landing form, unique; owner-only |
| `heartbeats` | — | one row per daily cron run; keeps the free project awake |

Seed meetings have `workspace_id = NULL` and `is_seed = true`; their rows are readable by
everyone and writable by no one except the seed script (service role).

## Security controls

### Data access rules (RLS)

- RLS is enabled on **every** table, including `jobs`, `webhook_deliveries`, `usage` and
  `rate_limits`. A table without a policy is unreadable.
- The standard policy on every workspace table, for select, insert, update and delete:
  `workspace_id in (select id from workspaces where owner_id = (select auth.uid()))`.
  Every `workspace_id` column is indexed.
- Seed rows: a separate permissive **select** policy `is_seed = true` (or
  `workspace_id is null` on child tables), granted to `anon` and `authenticated`. No
  insert, update or delete policy for anyone.
- `connections`, `card_sends`, `jobs`, `webhook_deliveries`, `usage`, `rate_limits`: no
  client policies at all. Only the service-role client, inside our own server code, reads
  or writes them, and only through the SQL functions below.
- **Restrictive** policies on `cards` (approve), `pin_shares` and `connections` require
  `(select auth.jwt() ->> 'is_anonymous')::boolean = false`, so a guest cannot send or
  share even if application code has a bug.
- Database tests (PGlite, running the real migrations) prove for every table that a
  session for workspace A cannot select, insert, update or delete workspace B's rows, and
  that `anon` can read seed rows and nothing else.

### State changes in SQL functions, one transaction each

Every state change goes through a `security definer` function with `set search_path =
''`, which checks ownership against `auth.uid()` (or takes an explicit workspace id when
called by the runner), enforces the rule, writes, and returns the new row. Application
code never updates state columns directly.

| Function | Rule it enforces |
|---|---|
| `start_guest_workspace()` | one workspace per user; sets `kind = 'guest'` |
| `link_or_merge_workspace(guest_user_id)` | keep/merge choice when a Google account already has a workspace; re-parents rows in one transaction |
| `launch_bot(meeting_id)` | bot-hour quota, one bot per meeting, state `scheduled → joining`, inserts the Attendee call as a job |
| `transition_meeting(meeting_id, to_state, attendee_event_id)` | only forward transitions; idempotent on the event id |
| `upsert_segment(meeting_id, …)` | unique on `(meeting_id, attendee_utterance_id)`; refreshes `text_search` |
| `store_claims(meeting_id, kind, claims jsonb)` | drops claims whose `segment_id` or `quote` fail the grounding check; records the dropped count |
| `approve_card(card_id)` | `state = 'waiting'` only; member only; inserts `card_sends` row and the `card.send` job in the same transaction |
| `claim_send(card_id, runner_id)` | `pending`, or `sending` with a lease older than 10 minutes; else no row |
| `record_send(card_id, provider_message_id)` | `card_sends.status = 'sent'`, `cards.state = 'sent'` together |
| `return_card(card_id, note)` | rewrite count ≤ 5; new version, old kept |
| `create_pin_share(meeting_id, pin)` | member only; one active share per meeting; stores a PIN hash |
| `check_pin(token, pin, ip)` | counts attempts; 5 wrong in 15 min locks; 20 in a day disables and notifies |
| `delete_meeting(meeting_id)` | cascades; enqueues `attendee.delete_data` job; keeps memory entries but nulls their source link |
| `consume_quota(workspace_id, key, limit, window)` | atomic upsert on `rate_limits`; returns allowed |
| `claim_jobs(runner_id, n)`, `complete_job`, `fail_job` | leases; see Background jobs |
| `purge_guests()` | deletes `is_anonymous` users idle 30 days; cascades |

### Validating input

Zod 4 at every boundary: form data, server-action arguments, route-handler bodies, query
params, environment variables (once, in `env.ts`), webhook payloads (after the signature
check), and every Claude response. `safeParse`, never `parse` in a `try`. Unknown keys are
stripped on external payloads. Strings are trimmed and bounded. Meeting URLs must be a
Zoom, Meet or Teams URL by pattern.

### The transcript is data

- Claude is called with **no tools** and a JSON schema. There is no code path from model
  output to an action except through Zod validation, the grounding check, and the SQL
  functions above, which enforce ownership and state independently of what the model
  said.
- Spoken and typed commands are parsed into a fixed set of command kinds with bounded
  fields; a command can only create rows in the owner's workspace. "AFK, delete
  everything" is not a command and becomes a note.
- A command's draft (email, invite, Slack post) is a **card**; it is never sent without
  the owner's click.

### Signed, idempotent webhooks

- Node runtime, raw body, verify before parsing, `crypto.timingSafeEqual`.
- Attendee: `X-Webhook-Signature` = base64(HMAC-SHA256(base64-decoded secret, sorted-key
  compact JSON)). No timestamp, so every delivery's `idempotency_key` is stored in
  `webhook_deliveries` and a repeat returns 200 without side effects.
- Slack: `v0:<timestamp>:<raw body>`, HMAC-SHA256 hex, reject if the timestamp is more
  than 5 minutes off.
- Google Calendar push: no HMAC; verify `X-Goog-Channel-Token` and channel id against the
  stored `watch`, then list changes with the `syncToken`; re-`watch` before expiry.
- Two webhook secrets are valid during a rotation.
- The webhook route is the only place that calls Attendee's chat endpoint on the live
  path, and it is rate-limited per meeting (see Limits).

### Secrets only in environment variables

- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ATTENDEE_API_KEY`,
  `ATTENDEE_WEBHOOK_SECRET` (two during rotation), `DEEPGRAM_API_KEY` (held in Attendee's
  dashboard, not ours), `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`,
  `SLACK_SIGNING_SECRET`, `TOKEN_ENCRYPTION_KEYS` (json of `kid → key`),
  `CRON_SECRET`, `JOBS_KICK_SECRET`. Validated once with Zod in `env.ts`.
- Non-secret switches, also in env and validated: `CLAUDE_MODEL` (default
  `claude-sonnet-5-5`), `TRANSCRIPTION_PROVIDER` (`captions` by default, or
  `deepgram`), and the test modes `ATTENDEE_MODE`, `AI_MODE`, `AUTH_TEST_MODE`,
  `PROVIDERS_MODE`, which `env.ts` refuses to enable when `VERCEL_ENV=production`.
- The Anthropic key is created by the owner with a spending limit and put straight into
  Vercel; it never appears in chat or in the repo. The Deepgram key lives in Attendee's
  project settings, not in ours.
- Modules that read them `import "server-only"`. Only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the client.
- OAuth tokens are encrypted in the app with AES-256-GCM (`{kid, iv, tag, ct}`), key from
  `TOKEN_ENCRYPTION_KEYS`, rotated by adding a `kid`. They are decrypted only inside a
  send or calendar-read job, and never logged or returned.
- Vercel environment variables are marked sensitive (write-only). Preview deployments
  point at the staging Supabase project, never production.

### Logs with ids and counts only

- Structured JSON logs with: request id, route, workspace id, meeting id, job id, card id,
  state before/after, durations, token counts, dropped-claim counts, provider status
  codes.
- Never logged: transcript text, segment text, summaries, card content, email addresses,
  participant names, memory content, tokens, signed URLs, PINs.
- Error messages shown to users name what happened and the next action, never a provider
  message or a stack trace.

### Rate limits in the database

`consume_quota(workspace_id, key, limit, window)` is called inside the SQL function that
performs the action, so the check and the action are one transaction. Limits are rows in
`plan_limits` (defaults per workspace kind) and can be changed without a deploy.

### Anything that sends runs at most once

1. `approve_card`: `UPDATE cards SET state='approved' WHERE id=$1 AND state='waiting' AND
   workspace_id=$ws`; zero rows is a double click. Same transaction: insert
   `card_sends(card_id, status='pending')` and a `card.send` job with
   `idempotency_key = 'card:' || card_id`.
2. `claim_send` leases the send row (10-minute lease). No row returned means another
   runner has it; exit.
3. Provider call, with the best dedupe each one offers:
   - Google Calendar `events.insert` with a client-set `id` derived from the card id; a
     409 `duplicate` is success.
   - Gmail `messages.send` with a deterministic `Message-ID: <card_id@afk.ai>`; after an
     unknown outcome, search `rfc822msgid:` before any retry.
   - Slack `chat.postMessage` with `metadata.event_payload.card_id`; before any retry,
     scan `conversations.history` for it.
4. `record_send` writes `provider_message_id` and both states in one transaction.
5. Retry only errors raised before the request left. A timeout or an ambiguous response
   moves the card to `needs_check`; nothing is ever auto-resent. The owner sees "We're
   not sure this was sent" with a manual check.
6. The summary email (FR-09) and the card-nudge email (FR-20) go through the same path
   with their own `card_sends`-style rows (`email_sends(meeting_id, kind)` unique).

### Background jobs

`jobs(id, workspace_id, kind, payload jsonb, idempotency_key unique, run_at, lease_until,
attempts, max_attempts, status, last_error_code, created_at, completed_at)`.

- **Enqueue** happens inside the SQL function that decided the work, with an
  `idempotency_key` so a repeated decision doesn't create a second job.
- **Claim**: `claim_jobs(runner_id, n)` — `SELECT … WHERE status='queued' AND run_at <=
  now() AND (lease_until IS NULL OR lease_until < now()) ORDER BY run_at FOR UPDATE SKIP
  LOCKED LIMIT n`, then set `lease_until = now() + lease`, `attempts = attempts + 1`.
  Leases are 5 minutes; a job that needs longer renews its lease between steps.
- **Run**: inside `after()` of the request that enqueued, or from `/api/jobs/kick`.
  `runJobs(deadline = start + 240 s)` runs claimed jobs one at a time. At most two
  runners per function invocation; concurrency across invocations is bounded by the
  leases, not by a lock.
- **Finish**: `complete_job` or `fail_job(error_code)`. After `max_attempts` (3), the job
  is `failed`, and the thing that depends on it (meeting, card) shows the failure with a
  retry button, which enqueues a fresh job.
- **Chain**: at the deadline with work left, POST `/api/jobs/kick` with
  `JOBS_KICK_SECRET` and exit. The kick route itself only calls `after(runJobs)` and
  returns 202.
- **Kick sources**: every mutation that enqueued work; every webhook; the daily Vercel
  cron (which also writes the Supabase heartbeat); the dashboard request path when
  `exists (select 1 from jobs where status='queued' and run_at <= now())`.
- **Crashes**: a runner that dies leaves its lease to expire; the next kick re-claims.
  Each job is idempotent on its key, and the pipeline is a chain of separate jobs, so a
  finished Claude call is never repeated.
- **The live path never uses jobs.** Live commands and answers run inside the Attendee
  webhook request.

## Limits

Per workspace, enforced in the database, adjustable in `plan_limits` without a deploy.

| Limit | Guest | Member |
|---|---|---|
| Bot hours per month | 2 in total, ever | 20 |
| Bots running at once | 1 | 3 |
| Commands per meeting (spoken + typed) | 50 | 50 |
| Live questions per meeting | 20 | 20 |
| Chat messages the bot posts per meeting | 25 | 25 |
| Summary generations per meeting per day | 8 | 8 |
| Rewrites per card | 5 | 5 |
| Cards waiting at once | 25 | 100 |
| Card sends per day | 0 | 50 emails, 20 invites, 50 Slack posts |
| Memory entries | 500 | 2,000 |
| Memory tokens per prompt | 4,000 | 4,000 |
| PIN attempts | — | 5 per 15 min per link; 20 per day disables |
| Requests per minute (any route) | 60 | 120 |
| Seed-audio signed URLs per hour | 30 | 30 |

Platform limits we design around:

| Platform | Limit | Source |
|---|---|---|
| Vercel Hobby | 300 s per function; cron once a day ± 59 min; 100 GB transfer; 1M invocations; 1-hour log retention; non-commercial use | https://vercel.com/docs/functions/limitations · https://vercel.com/docs/cron-jobs/usage-and-pricing · https://vercel.com/docs/limits/fair-use-guidelines |
| Supabase Free | 2 projects; 500 MB database; 1 GB storage; 5 GB egress; pauses after 7 days of low activity; anonymous sign-ins 30 per hour per IP | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/free-project-pausing · https://supabase.com/docs/guides/auth/auth-anonymous |
| Attendee | 5 free bot hours, then $0.50/hour; bot auto-leaves per our settings (5 min waiting room, 10 min silence, 3 h) | https://attendee.dev/pricing |
| Deepgram | $200 credit, then ≈ $0.35/hour | https://deepgram.com/pricing |
| Claude | spending limit on the API key; 512-token cache minimum; 5-minute cache TTL | https://platform.claude.com/docs/en/about-claude/pricing |
| Google OAuth (Testing mode, by decision) | up to 100 test users; refresh tokens expire after 7 days, so every Google connection shows "reconnect by <date>" | https://developers.google.com/identity/protocols/oauth2#expiration |

## Known gaps

| Gap | Effect | Mitigation now | Decision needed |
|---|---|---|---|
| Vercel Hobby is non-commercial | A commercial launch on Hobby breaks the fair-use terms | Build and demo on Hobby | Confirm non-commercial, or plan $20/month Pro at launch |
| Timed jobs run at the next kick | A "9:00 tomorrow" reminder can be late on a quiet day, up to a day | Kicks from every request and webhook; daily cron | Accept, or add a second daily cron at a different hour |
| Supabase pauses after 7 idle days | The whole app stops | Daily cron writes a heartbeat row | None |
| Seed-audio egress | 5 GB/month ≈ 170 full plays of a seed meeting | Signed URLs rate-limited per workspace | Accept for v1 |
| Sonnet-only cost | ≈ $0.45–0.57 Claude per hour-long meeting; all-in after credits ≈ $0.95–1.07 with captions, $1.30–1.42 with Deepgram | Captions are the default; `CLAUDE_MODEL` can switch to Haiku; cost recorded per meeting | Decided: revisit with real cost data once the bot works |
| Attendee and Deepgram are usage costs beyond Claude | $0.50 and ≈ $0.35 per hour after free allowances | Bot-hour quotas; Deepgram off by default | Decided: accepted |
| Google OAuth in Testing mode | Connections die after seven days; 100 test users max | "Reconnect by" dates on Loadout; test-user form on the landing page | Decided: accepted |
| One Supabase project shared by previews | A preview deployment reads and writes the same database as production | Test modes only in the Preview env; test workspaces tagged and purged by `guests.purge`; no destructive migrations run from previews | Accepted |
| Test-user emails | The landing form stores visitors' Gmail addresses | Owner-only table; stated on the Privacy page; deleted on request | Accepted |
| PGlite ≠ Supabase | No `auth` schema or `pg_cron`; some extensions missing | Test prelude stubs `auth.uid()`/`auth.jwt()`; migrations avoid Supabase-only extensions | Accept, or run the Docker stack occasionally |
| Live path runs in the webhook request | A slow Claude call delays the 2xx to Attendee; Attendee retries after a timeout | Answers use `max_tokens` bounds and a 10 s client timeout; a retry is deduped by `idempotency_key` | None |
| Sender matched by name | A participant who renames themselves to the owner's name could issue commands | Commands only create rows in the owner's workspace; sends still need the owner's click | Accept for v1 |
| httpOnly session vs browser Realtime | Live bot state may need polling | Poll every 5 s on the live meeting page | Decide at build time |
| Roman Urdu unverified | FR-22 may not be achievable as written | Transliteration step planned | Test clip before committing |
| No admin role | Support cannot look inside a workspace | Logs with ids and counts; user-driven export | Accept |
| Deleted meeting, kept memory | Memory entries lose their quote link but keep content | Owner is told how many; can erase | Accept (per NFR-03.5) |
