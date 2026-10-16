# System design

How AFK.ai behaves as built: who calls it, what each caller may do, the controls that
enforce it and where each lives, how work is kept at most once, the limits, retention,
and the gaps we know about. [architecture.md](architecture.md) has the data model and
the processing detail; [data-flows.md](data-flows.md) follows each feature from input to
output; [requirements.md](requirements.md) holds the requirement IDs used below.

## Components

| Component | Runs on | Trust |
|---|---|---|
| Web app (Next.js 16, App Router) | Vercel, `bom1` | Public. Pages read as the visitor under Row Level Security; route handlers validate every input with Zod and write as the visitor, or with the secret key only after deciding access themselves |
| Proxy (`src/proxy.ts`) | In front of every page and route except static files, generated icons and `/api/webhooks` | Throttles the public read paths per client, sets the Content-Security-Policy with a fresh nonce, refreshes the visitor's Supabase session, sends a signed-out `/welcome` to `/sign-in` |
| Postgres, Auth, Storage | Supabase, `ap-south-1` | The source of truth and the policy engine: RLS on every table, column-level grants, state changes through SQL functions that run as one transaction |
| Job runner (`src/features/processing/runner.ts`, started from `src/server/jobs.ts`) | Inside the web app's functions, after a response | The only place Claude is called. Leases jobs from Postgres for no longer than its own budget; publishes output only while it still holds the job's claim token |
| Kick and health routes (`/api/jobs/kick`, `/api/health`) | Vercel functions | The kick route starts a run behind the cron secret, for the chain and for an external pinger. The health route reports the queue in numbers, the last keep-alive and what is configured; 503 when a due job has waited over thirty minutes |
| Daily keep-alive (`/api/cron/keepalive`) | Vercel Cron, 06:17 UTC (`vercel.json`) | Housekeeping and retention behind the cron secret; one row in `cron_runs` per run |
| Claude API (`@anthropic-ai/sdk`) | Anthropic | `claude-sonnet-5-5` by default (`CLAUDE_MODEL`), no tools, a JSON schema the API enforces, the transcript as data in the message. Billed to the owner's key (`ANTHROPIC_API_KEY`) |
| Attendee | attendee.dev | The meeting bot, sent now or scheduled for a calendar meeting's time. Transcribes from captions or Deepgram (`ATTENDEE_TRANSCRIPTION`, `ATTENDEE_DEEPGRAM_LANGUAGE`), records video and keeps it. Talks to the app only through a signed webhook; the app calls it to send a bot, post to the chat, fetch the transcript, mint a recording link, and forget a bot's data |
| Gmail, Google Calendar, Slack | Google, Slack | Reached only from an approved `run_command` job or the owner's note, with the user's own sealed token |
| Browser | Anyone | Holds the publishable key and, after the first write, a Supabase session (anonymous or Google). Reads what RLS allows; writes only through the granted columns |

## Actors

| Actor | Identified by | What it is |
|---|---|---|
| Visitor | No session | Someone browsing who has done nothing yet |
| Guest | A Supabase anonymous identity (`is_anonymous`), made in the browser on the first write | Owns a private workspace in that one browser |
| Google user | A Supabase identity with Google among its sign-in providers (`app_metadata.providers`, which only Supabase Auth writes); a guest who continued with Google keeps the same user id. Any other identity is treated as a guest | The same workspace on every device, plus memory, contacts and connectors |
| PIN viewer | The grant cookie `afk-m-<code>` set after the right PIN | Anyone given a meeting's address and PIN; no account |
| Clip viewer | A 64-hex share token in `/share/<token>` | Anyone given a clip link; no account |
| Job runner | The service-role client inside the app's own functions | Runs `processing_jobs` rows |
| Attendee webhook | HMAC signature over the body | The bot provider reporting state changes and live utterances |
| Cron | `CRON_SECRET` as a bearer token | Vercel Cron, the chain between functions, an optional pinger |

## Who can do what

| Caller | Reads | Writes | AI runs |
|---|---|---|---|
| Visitor | The sample meetings (seed rows with no owner, once ready), shared clips, `/m/<code>` pages with the PIN, the empty dashboard, labelled demos | Nothing; the first write creates their identity | None |
| Guest | The above, plus their own meetings, commands and highlights; the Memory page as a demo; the Connectors page locked | Own highlights, clips, ticks, an access request; send the bot (5 a day, one active at a time); typed commands except `/remember`; dismiss commands; delete own meetings. Never a connector, a memory file or a contact | Their own meetings: notes, items, parsed commands, live answers; no learned lines, no owner's note |
| Google user | Everything a guest reads, plus their memory files, their connectors (never the token) and their contacts | Everything a guest writes, plus `/remember`, approving external commands, connecting and disconnecting Gmail, Calendar and Slack, editing, exporting or erasing memory, deleting contacts, the calendar auto-join switch | Their own meetings, learned lines and the owner's note too |
| PIN viewer | One ready meeting through `get_shared_meeting()`: title, date, length, headline, speakers, turns, summary points and notes said on the call (never a note the owner typed, migration 45), the recording through `/api/m/<code>/media` | Nothing | None |
| Clip viewer | One clip through `get_shared_clip()`: its range, the overlapping turns, the meeting title and date, the speakers heard in it; audio limited to the range for a sample meeting, transcript only for a private one | Nothing | None |
| Job runner | Everything, including sealed connector tokens (opened in its process only) | Job state, transcripts, AI output, commands, highlights it makes for the owner, command results, memory appends, contacts; sends mail, creates events and posts to Slack only through approved `run_command` jobs, and the owner's note through `notify_owner` | Yes, on the owner's key |
| Attendee webhook | Nothing returned | Advances one bot meeting's state, stores live utterances and live commands; never creates or revives a meeting | None itself; it kicks the runner |
| Cron | The queue in numbers | Prunes, sweeps, purges, schedules auto-join bots, runs what is queued | Through the runner |

Nothing lists users, and no row of one user's is readable by another. Jobs are created
only by the database: the seed import, the Attendee webhook (through `mark_bot_finished()`
and `record_live_utterance()`), a typed command, an approval, a rewrite
(`rewrite_command()` queues `detect_commands`), the notes chain (`complete_job()` queues
`learn` after a summary, the `meetings_owner_note` trigger queues `notify_owner`) and the
daily keep-alive's calendar scheduling (a scheduled bot is a meeting row whose finished
call queues its work through the webhook). So the bot caps and the command caps bound how
many Claude calls anyone can cause.

## Security controls

| Threat | Control | Where it is enforced |
|---|---|---|
| Reading someone else's meeting, notes or commands | RLS on every table. Meetings are readable when seeded and ready, or owned by the caller; speakers, turns, chapters and items follow through `can_read_meeting()`. Commands, highlights, share links, ticks and meeting links are owner-only | `can_read_meeting()` (migration 01), the policies in migrations 02, 03, 09, 39 |
| Writing around the route handlers with the publishable key | Revoke-all, then column grants: `highlights` (insert `meeting_id, start_sec, end_sec, note`), `share_links` (insert `token, highlight_id`, update `revoked_at`), `item_states` (`item_id, done`), `memory_files` (insert `owner_id, path, content`, update `content`, delete), `access_requests` (`email`); select only on the rest. `contacts` follows the same pattern: users hold select and delete only (migration 42), matching its two RLS policies. State changes for commands, jobs and links are functions the browser roles cannot execute | Grants in migrations 01 to 42 (`contacts` in migrations 33 and 42); `apply_typed_command()`, `approve_command()` granted to `service_role` only |
| Write flooding | 60 writes a minute per identity. Routes call `note_visitor_write()` through `requireVisitor()` and fail closed (503) when the check cannot run; the tables a visitor writes directly carry the `enforce_visitor_write()` trigger, so the Data API counts too. Counts run under an advisory lock on the identity | `src/server/http.ts`, `note_visitor_write()` (migration 29), `enforce_visitor_write()` (migration 10, access requests in 29) |
| Over-sized clips and link sprawl | A trigger clamps a highlight inside the recording, and a check keeps a clip at most 600 s long; caps of 300 highlights per identity and 50 links per highlight, each under an advisory lock on its key | `clamp_highlight()` (trigger `highlights_clamp`), the `highlights_max_length` check (migration 03), `cap_highlights()` (trigger `highlights_cap`), `cap_share_links()` (trigger `share_links_cap`) |
| Bot abuse (paid minutes) | One active bot per identity (partial unique index `meetings_one_active_bot_per_owner`, scheduled bots excluded); 5 requests a day per identity, 5 a day per place (a keyed hash of the sender's address), and `app_settings.bot_daily_cap` (20) in all, of which guests together may use half, so a few addresses minting guests cannot book the bot out for Google users, in one trigger under one advisory lock; Supabase allows 30 new anonymous identities an hour per address | `cap_bot_requests()` (migrations 29, 48), `supabase/config.toml` |
| Claude spend | Only the database creates jobs; bot and command caps bound them; `cap_meeting_commands()` (trigger `meeting_commands_cap`) allows 20 spoken and 20 typed commands a meeting; `rewrite_command()` allows three rewrites a draft and counts each against the write limit; every job report records tokens and an estimated cost | `claim_job()`, the caps, the job report |
| Forged or replayed webhooks | HMAC-SHA256 over Attendee's canonical JSON with a constant-time compare, numbers kept as signed; 503 without `ATTENDEE_WEBHOOK_SECRET`, 401 on a bad signature, 413 over 100,000 characters. State writes are compare-and-set on the meeting's status; live utterances are keyed by Attendee's idempotency key; no event creates a meeting | `src/app/api/webhooks/attendee/route.ts`, `parseWebhookBody`, `verifyWebhookSignature` (`src/features/capture/attendee.ts`), `mark_bot_finished()`, `record_live_utterance()` |
| Scraping the public read paths | Per-client limits a minute on `/search` (60), `/share/<token>`, `/m/<code>` and `/api/m/<code>/pin` (120 together), the two media routes (60) and `/api/health` (60). The client is an HMAC of its address under a key derived from `SUPABASE_SECRET_KEY`; the database holds no addresses. 429 from the proxy before the page runs, 503 when the count cannot be checked | `src/lib/read-limit.ts`, `throttleReads` in `src/proxy.ts`, `note_read_hit()` (service role only) |
| Script injection | A Content-Security-Policy on every HTML response: scripts only with the request's nonce plus `strict-dynamic` (`unsafe-eval` in development only), connections only to this site and the Supabase project, media also from any https origin (the bot provider's storage address is not known in advance, and a media source can neither run script nor read the page), no objects, no frames, `form-action` and `base-uri` self, `upgrade-insecure-requests` in production | `buildContentSecurityPolicy()` in `src/lib/csp.ts`, `src/proxy.ts` |
| Framing, sniffing, referrer leaks | `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` denying camera, microphone, geolocation and payment on every response, static files included | `src/lib/csp.ts`, `next.config.ts` |
| Connector token theft | Refresh and bot tokens sealed with AES-256-GCM under `CONNECTOR_TOKEN_KEY` (32 bytes, server only), with the owner and provider bound in as authenticated data, so a current (`v2`) ciphertext moved to another row fails to open. A `v1` ciphertext, sealed before the binding, still opens without it (audit D21, F40). Stored in `connector_secrets`, RLS on with no policy and no user grants. Access tokens live only in a function's process for one run. Disconnect revokes at the provider and deletes the row | `sealSecret()` and `openSecret()` in `src/features/connectors/token-crypto.ts`, `store_connector()` (migration 14), `src/server/connectors/store.ts`, `src/features/processing/token-source.ts` |
| A forged OAuth round trip | The OAuth state is a signed, short-lived cookie bound to the user and the provider; PKCE for Google | `src/features/connectors/oauth-state.ts` |
| Connectors or memory for a guest | Refused in RLS (`connectors`, `memory_files` and `contacts` check `is_google_user()`, which asks for Google among the token's `app_metadata.providers`, not merely a non-anonymous session), in every route through `isGoogleUser()` (`requireUser()`, `getViewer()`, the proxy, the connector routes) and in the approve route; `append_memory_lines()` returns at once for an owner `is_guest()` finds without a Google identity. Email sign-up is off, so the only identities are anonymous and Google | Migrations 30, 33, 44; `src/lib/google-user.ts`; `src/app/api/commands/[commandId]/route.ts` |
| Acting without consent | An adapter runs only from a `run_command` job, which only `approve_command()` inserts, after the route has read the command as the visitor (RLS finds it only for the owner), validated the confirmed arguments with the kind's schema and checked the app is connected | `approve_command()`, `start_command()`, `src/app/api/commands/[commandId]/route.ts` |
| An address AFK invents | Addresses come only from the host's people file (the zone the host wrote, never AFK's learned lines, which carry what anyone said and a meeting title a stranger's invite can set), cards the host confirmed, calendar invites of meetings AFK was sent to, an address said in the call and found in the transcript, and a Google import the host asked for. `contacts` is written only through `learn_contacts()` (service role). Nothing is sent without approval | `learn_contacts()` (migrations 33, 38), `src/features/connectors/address-book.ts`, `src/features/commands/approval-form.tsx` |
| Prompt injection through transcripts, memory or tool output | No tools in any Claude call; a JSON schema; content labelled as data with the instruction last; every output grounded against the current transcript before it is stored. The romaniser's rewritten lines replace turns only when they can be the same words (`isFaithfulRomanization()`), so a planted instruction cannot rewrite another turn into a command. A live answer with no surviving citation becomes the fixed "That wasn't discussed yet.", and its prompt carries none of the host's memory, so nothing private (people notes, other meetings' titles and headlines) can reach the meeting chat | `src/features/processing/claude.ts`, `src/features/summaries/grounding.ts`, `src/features/summaries/prompts.ts`, `src/features/processing/answer-in-meeting.ts` |
| Memory tampering | AFK appends only below the "Learned by AFK" rule through `append_memory_lines()`. The user's save goes through `PUT /api/memory/<path>`, which refuses the two history files (403), then `save_memory_file()`, which refuses a save over a newer version (P0006, 409). The function refuses the history files too, and the insert and update policies exclude `history/*.md`, so the Data API cannot write them either (a user may still delete them). A save with no expected version only creates: a row AFK made meanwhile is a conflict, never overwritten (migration 51, audit D8, F13). The `memory_files_user_write` trigger stamps `updated_by = 'you'` and counts the write | Migrations 12, 13, 16, 25, 30, 51; `src/app/api/memory/[...path]/route.ts` |
| Guessing a meeting's address or PIN | The code is minted by the database (twelve characters from a 32-letter alphabet); the PIN is checked in one function under an advisory lock on code and client; five wrong tries lock that pair for fifteen minutes, and a lock that ran out gives five tries again (audit D9, F17, fixed in migration 47); an unknown, switched-off or not-ready code answers like a wrong PIN. Across every client, fifty wrong tries on one code, summed over every client that tried it in the last day, switch the link off, so many addresses together get about a 0.5% chance; the owner's switch clears the count. Both functions run as the service role only | `new_link_code()`, `open_meeting_link()` (migrations 39, 47), `set_meeting_link_enabled()`, `src/app/api/m/[code]/pin/route.ts` |
| A forwarded or forged PIN grant | The grant cookie is HttpOnly, SameSite=Lax, Secure on https, seven days, named for its code, carrying an HMAC of code and expiry under a key derived from `SUPABASE_SECRET_KEY`, checked in constant time. A cookie for one code opens no other. Every read also checks the link itself (`enabled`, the code, a ready meeting). Switching the link off suspends every grant at once; switching it back on (`set_meeting_link_enabled()`) re-admits grants minted earlier, since a grant is bound to the code and not to an on-off epoch (audit D20). "New link and PIN" (`rotate_meeting_link()`) changes the code, which ends every grant, and also switches the link on | `src/features/meeting-link/link-grant.ts`, `get_shared_meeting()`, `src/app/m/[code]/page.tsx`, `src/app/api/m/[code]/media/route.ts` |
| Guessable share links | 64 hex characters from two v4 UUIDs, minted by a trigger whatever the browser sent; one live link per highlight (`share_links_one_live_per_highlight`); revocable | `mint_share_token()` (migration 10) |
| Cross-site writes | The proxy refuses with 403 any non-GET request a browser marks as sent by another site (`Sec-Fetch-Site` other than same-origin, or a foreign `Origin`), before any route runs; the session cookies are also SameSite=Lax and Secure. So a page elsewhere cannot spend a visitor's PIN tries or act through the session-less PIN route. Callers that are not browsers send neither header and meet their own checks | `isCrossSiteWrite()` in `src/lib/same-origin.ts`, `src/proxy.ts`, `SESSION_COOKIE_OPTIONS` |
| Logout by link | Sign-out is POST-only. The auth callback, a GET anyone can link to, never signs out: on a link conflict it only redirects to `/sign-in?error=linked`, and the switch to the existing account happens when the visitor clicks Continue there. (A PKCE verifier cookie was no proof: Supabase keeps flow cookies for 400 days, so any past sign-in carried one) | `src/app/auth/callback`, `src/app/auth/sign-out`, `src/app/sign-in/page.tsx` |
| Connector state forgery | The OAuth state cookie is signed under a key derived from `CONNECTOR_TOKEN_KEY` for that one use, never the token-sealing key itself | `src/features/connectors/oauth-state.ts` |
| Cron and kick credentials | One `CRON_SECRET`, compared in constant time over byte lengths; 401 when missing or wrong, logged loudly when unset | `requireCronSecret()` in `src/server/http.ts` |
| Secrets leaking into the browser or the code | Only `NEXT_PUBLIC_*` values reach the browser. Every file under `src/server/` starts with `import "server-only"`, so a client import fails the build | `src/lib/env.ts`, `src/server/` |
| Content in logs | One log module, one JSON line per event, identifiers and counts only; an error records its name and message; a test reads every log call | `src/server/log.ts`, `src/lib/log-line.ts`, `src/server/log.test.ts` |
| Stale guests | Anonymous identities older than thirty days that never linked Google are purged daily, except one whose bot is in a call: the users (cascading everything they own), then their audio objects, then Attendee is told to forget each bot's data | `purge_stale_guests()` (migration 32), `src/app/api/cron/keepalive/route.ts` |
| AFK reading the calendar unasked | The calendar is read only for a Google user who connected it: on their own dashboard, or by the keep-alive when their profile says "AFK joins my calendar meetings: yes". Every scheduled bot is a meeting row under the same caps | `src/server/calendar-autojoin.ts`, `cap_bot_requests()` |
| A participant giving commands | Only the sender's words are commands: matched by name, and a lone speaker counts only when no name is known for the sender at all, so the other person in a meeting the owner skipped cannot write the owner's memory or draft cards in their name. Two speakers who both match are a tie and neither counts, after the call and, over the names heard so far, during it (audit F2) | `findSender()` and `isLiveSender()` in `src/features/commands/sender.ts`, `live_speaker_names()` (migration 52) |
| A stranger's invite steering the bot | Anyone can put an invite on a user's calendar. Auto-join schedules only events the user organised or accepted, and invitees are learned only from those, so an unanswered or declined invite never sends the bot to a stranger's call or writes the stranger's names and addresses into the address book; Send AFK on any event stays the user's own choice | `isAccepted()` in `src/features/connectors/calendar.ts`, `src/server/calendar-autojoin.ts` |
| A recording outliving its meeting | Delete tells a bot still in the call to leave, deletes the row (cascading turns, jobs, items, commands, highlights, links, the address), removes the audio object, and tells Attendee to forget the bot's data (best effort, logged when refused). A meeting with spoken commands deletes like any other (audit S1, disproved by a database test) | `src/app/api/meetings/[meetingId]/route.ts` |

## Idempotency and at-most-once

| Where | Mechanism |
|---|---|
| Jobs | One queued or running job per (meeting, kind) through the partial unique index `processing_jobs_one_active`, and one per command through `processing_jobs_one_per_command`; inserts use `on conflict do nothing`. `claim_job()` takes one job under `for update skip locked` with a fresh `claim_token`, so two runners never take the same job. `complete_job()` and `start_job_effect()` act only while the job is `running` with that claim token; neither reads `lease_until`, so a run that outlives its lease still publishes until the next `claim_job()` sweep clears the token (audit D11, F24) |
| External commands | `approve_command()` locks the command row, accepts only a proposed command, or a failed one whose `executed_at` is null or whose kind is a calendar one, stores the approved arguments and inserts at most one `run_command` job (one attempt for email and Slack, three for calendar kinds). `start_command()` checks the claim, locks the command and sets `executed_at` before the adapter is called; a second start for email or Slack returns `ambiguous` and the card says to check the Sent folder |
| Calendar events | The event id is derived from the command id (`calendarEventId()` in `src/features/connectors/calendar.ts`), so a retry reads the existing event back instead of making a second |
| Sends with no command row | The owner's note (`notify_owner`) and a live answer's chat line go through `start_job_effect()` (migration 37): under the job's row lock and only while its claim holds, it stamps `effect_at` once; an attempt after one that reached Gmail or the chat sends nothing. At most once, not at least once. The live fallback line takes the same lock through `claim_live_fallback()` (migration 41): it goes out only when the answer has not started and stamps `effect_at` as it does, so a question gets either the fallback or the answer in the chat, never both |
| Spoken commands | Unique per (meeting, turn, kind) through `meeting_commands_spoken_once`; live commands unique per utterance through `meeting_commands_one_per_live_utterance`; re-running a parse records nothing twice |
| Typed commands | Applied under the meeting's row lock by `apply_typed_command()`, which returns the new command's id |
| Webhook | Status changes are compare-and-set, so a redelivery changes nothing; a live utterance is stored once per idempotency key, and a redelivered question queues no second answer |
| Bots | One active bot per owner and one scheduled bot per calendar event (`meetings_one_bot_per_calendar_event`); every count is taken inside `cap_bot_requests()` under one lock. The daily `sweep_stale_bots()` fails a Scheduled, Requested or Recording row six hours after its call was due, `coalesce(scheduled_for, created_at)`; Attendee ends every call within three hours of joining, so a live call is never swept (migration 40, audit F1) |
| Share links and ticks | A lost race returns the row that won, with the caller's value applied on top for ticks |
| Seed import | An unchanged transcript (by hash) is skipped; re-running creates no duplicates |
| Guest linking | Continuing with Google links the identity in place (same user id), so nothing is copied or merged |

## The job lifecycle

A job is `queued`, `running`, `done` or `failed`, with `attempts` (at most 3 by default),
`run_after`, `lease_until` and `claim_token`.

1. **Queued.** By the database only. `mark_bot_finished()` moves a finished bot meeting
   to `transcribed` and queues `ingest_media`. `ingest_transcript()` queues
   `detect_commands` for an owned meeting, or `analyze` and `summarize` for a seed
   meeting. `apply_commands()` queues `analyze` and `summarize`. A finished `summarize`
   queues `learn` for a Google user (in `complete_job()`), and the `meetings_owner_note`
   trigger queues `notify_owner` for a Google user whenever `summarized_at` is set or
   changes, so a re-summarised meeting sends the owner a second note (audit S3). An
   approval queues `run_command`; a typed command that needs the model or a rewrite
   (`rewrite_command()`) queues `detect_commands`; a live question queues
   `answer_in_meeting` (two attempts). A `detect_commands` job that fails for good queues
   `analyze` and `summarize` (`job_failed_for_good()`).
2. **Claimed.** `claim_job()` first sweeps expired leases (a job past its attempts fails
   with its follow-ups), then takes one due job: the kicked meeting's first, then live
   answers and approved commands, then the oldest due. The lease is the run's remaining
   budget plus 60 seconds, so a function cut off mid-job frees the job soon after.
3. **Finished.** `complete_job()` with one outcome:
   - `done` or `skipped`: applies the payload in the same transaction and marks it done.
   - `failed`: counts an attempt. With the default of 3 attempts, the job is due again 1
     minute after the first failure and 4 minutes after the second; the third failure is
     final and calls `job_failed_for_good()`, which records it on the meeting or the card.
   - `rejected`: output that `complete_job()` refused to store (a check, foreign key or
     similar refusal), or a transcript `ingest_transcript()` refused, fails the job at
     once, so the same refusal is not fetched and paid for three times.
   - `release`: a rate limit, an Anthropic outage, an unreachable service or a missing
     API key puts the job back without using an attempt, due again after the provider's
     retry time, five minutes, or ten minutes for a missing key. A Claude call that
     times out is released only when the run gave it less than 200 s, due again at once,
     and the run stops as out of budget so the chain hands it to a fresh function; one
     given more is too long for any run and fails as an attempt, so it is not paid for
     every five minutes for ever.
4. **Superseded.** A changed transcript fails the meeting's queued and running
   `detect_commands`, `analyze`, `summarize` and `learn` jobs and clears its notes marks.
5. **Pruned.** Done and failed jobs older than thirty days go with the keep-alive.

**Who runs jobs.** `kickJobs()` runs the runner after a response in the webhook, the
meeting page while notes or cards are pending (and again for a job still running six
minutes after its claim), the typed-command, approval and rewrite routes,
`POST /api/jobs/kick` and the daily keep-alive. A run gets 270 of the function's 300
seconds and keeps 20 seconds of headroom; it starts no job with 45 seconds or less left;
a job's Claude call gets what is left less 5 seconds, so at most about 245 seconds
(`runner.ts`; `claude.ts` uses 240 seconds only when no timeout is passed).

**The chain and its end.** A run that stops on its budget reads `queue_status()`. With
due jobs left it posts once to `/api/jobs/kick` with the hop count, and a fresh function
carries on. A run that stopped for a reason a new function would not change (no API key,
the provider down, the claim refused) does not chain. A released job is due only after
its retry time, and a failing job spends its attempts, so a job that keeps releasing or
failing cannot drive the chain. The chain therefore ends when nothing is due.

## Limits

| What | Limit | Enforced by |
|---|---|---|
| Writes per identity | 60 a minute | `note_visitor_write()`, `enforce_visitor_write()` |
| Highlights per identity | 300; links per highlight 50, revoked ones counted | `cap_highlights()`, `cap_share_links()` |
| Access requests per identity | 3 | `cap_access_requests()` (migration 46) |
| Clip length | At most 600 s; a spoken "highlight that" clips 5 to 60 s | `highlights_max_length` (migration 03), `MAX_CLIP_SEC` in `src/lib/time-rules.ts`, `HIGHLIGHT_MIN_SEC`/`HIGHLIGHT_MAX_SEC` in `src/features/commands/parse.ts` |
| Commands per meeting | 20 spoken parsed (the next 20 recorded as skipped), 20 typed | `cap_meeting_commands()` |
| Rewrites per draft | 3, each also a write against the visitor's limit | `rewrite_command()`, `meeting_commands.rewrites` |
| Tasks page | At most 200 commands listed | `TASKS_LIMIT` in `src/features/commands/tasks-queries.ts` |
| Bot requests | 1 active per identity (a scheduled bot is not active until it joins); 5 a day per identity; 5 a day per place; `bot_daily_cap` (20) a day in all, guests together at most half; one scheduled bot per calendar event; a bot scheduled at most 90 days ahead; the auto-join schedules at most 20 a run, 36 hours ahead; at most 12 sender names a meeting | `cap_bot_requests()`, the unique indexes, `src/app/api/bot/route.ts`, `src/server/calendar-autojoin.ts`, the `sender_names` check (migration 23) |
| A bot in the call | Leaves after 60 s alone, 5 minutes unadmitted in a waiting room, 10 minutes of silence (counted after the first 10), 3 hours at most | `BOT_LEAVE_SETTINGS` in `src/features/capture/attendee.ts` |
| New guest identities | 30 an hour per address | `supabase/config.toml` |
| Processing budget | 270 s of 300 s per function, 20 s of it headroom; a job's Claude call at most about 245 s (240 s when no timeout is passed); the ingest's recording probe 30 s | `src/server/jobs.ts`, `src/features/processing/runner.ts`, `src/features/processing/claude.ts`, `PROBE_TIMEOUT_MS` in `src/features/processing/jobs.ts` |
| Function length | 300 s for the routes that run jobs; 30 s for `POST /api/bot`; 60 s for the Google contacts import | `maxDuration` in each route |
| Outbound deadlines | Supabase as the visitor (pages and routes) 10 s, from the proxy 8 s (session) and 5 s (read count, failing closed); the service-role client 30 s in routes and 2 minutes in the job runner and the keep-alive (an ingest writes a whole transcript in one call); every Attendee call 20 s; the Google sign-in check 2 s, its answer kept five minutes | `fetchWithDeadline()` in `src/lib/fetch-deadline.ts`, `src/features/capture/attendee.ts`, `src/server/auth/providers.ts` |
| Job attempts | 3 (calendar commands 3, email and Slack 1, live answers 2); retries 1 then 4 minutes after a failure | `complete_job()`, `approve_command()` |
| Search | 120 hits a query, 200-character query | `SEARCH_LIMIT` in `src/features/search/search-queries.ts`, `src/app/search/page.tsx` |
| Recording links | Audio signed for 6 hours (sample) or 1 hour (private); video 30 minutes (Attendee's link), renewed two minutes before expiry, never sooner than 5 s, a minute when the expiry cannot be read | `src/server/media/media-url.ts`, `useRenewingMedia()` in `src/features/meetings/use-renewing-media.ts` |
| Meetings lists | 20 a page, keyset cursor | `list_meetings()` |
| Meeting links | One per meeting; five wrong PINs lock the code for that client for fifteen minutes, and a lock that ran out gives five tries again; fifty wrong PINs on one code, summed over every client that tried it in the last day, switch the link off; tries forgotten after a day without one; grants last seven days | `open_meeting_link()`, `prune_link_tries()`, `link-grant.ts` |
| Memory | 9 files of 32 KB per Google user; 8 KB a file and 32 KB in all inside a prompt | `memory_files` checks, `src/features/memory/files.ts` |
| Connectors | One per provider per user; approved arguments at most 8 KB; email to 5 To and 5 Cc addresses, follow-up to 10 invitees, Slack message 2,000 characters; the Slack channel list reads at most 5 pages of 200; the OAuth state cookie lasts 10 minutes | `connectors` unique key, the `approved_args` check (migration 14), `src/features/connectors/approve-args.ts`, `CHANNEL_PAGES` in `slack.ts`, `CONNECT_STATE_TTL_SEC` in `oauth-state.ts` |
| Contacts | One row per address per user; at most 50 invitees learned per meeting; a Google import of at most three pages of a thousand per list | `contacts` unique key, `learn_contacts()`, `src/features/connectors/people.ts` |
| Public reads per client | 60 searches, 120 share-link and meeting-address opens, 60 recording-link renewals, 60 health checks a minute | `READ_LIMITS` in `src/lib/read-limit.ts` |
| Live utterances | 2 KB of text each | `record_live_utterance()` |
| Live answers | 600 characters | `ANSWER_MAX_CHARS` in `src/features/commands/answer.ts` |
| Final transcript | Consecutive captions of one speaker merge when under 1.5 s apart, up to 600 characters | `src/features/capture/attendee-transcript.ts` |
| Webhook body | 100,000 characters | The webhook route |

## Retention

| Data | Kept | Removed by |
|---|---|---|
| Meetings, turns, notes, commands, highlights, links, the address | Until the owner deletes the meeting (or the guest is purged) | `DELETE /api/meetings/[meetingId]`, cascades |
| Bot recordings and Attendee transcripts | At Attendee for as long as Attendee keeps them; never copied | Attendee is told to forget them on delete and on guest purge |
| Live utterances | Until the final transcript is ingested, else 24 hours | `ingest_transcript()`, `prune_live_utterances()` |
| Bot request counts | 24 hours | `cap_bot_requests()` |
| Write-limit and read-limit counts | One minute | `note_visitor_write()`, `note_read_hit()`, the keep-alive |
| PIN tries | One day | `prune_link_tries()` |
| Done and failed jobs | 30 days; a meeting keeps `analyzed_at` and `summarized_at` for itself | `prune_finished_jobs()` |
| Guests who never continued with Google | 30 days from creation | `purge_stale_guests()` |
| Memory files, connectors, contacts | Until the user deletes them, or the account goes | The Memory and Connectors pages |
| Keep-alive runs | One `cron_runs` row per run, not pruned | |

## Pagination

`list_meetings(p_own, p_limit, p_before_recorded, p_before_created, p_before_id)` returns
one page as the caller (security invoker, so RLS applies), ordered by recorded date, then
creation time, then id, unrecorded meetings last. The page asks for one row more than it
shows; if it arrives, the last shown row's key becomes the `?after=` cursor (base64url,
validated with Zod on the way back; anything malformed means the first page). A cursor
is a position, not an offset, so a meeting arriving between two pages never shifts or
repeats a row. `/dashboard` and `/samples` page the same way.

## Scalability

| Property | How AFK.ai has it |
|---|---|
| Stateless compute | Every run starts empty inside a function; all state is in Postgres. A second instance needs nothing from the first |
| Durable, idempotent work | Jobs are rows with a lease and a claim token, taken with `skip locked`, retried with backoff, with at-most-once gates on everything that sends |
| One point of serialization | State changes are SQL functions in one transaction with row locks, advisory locks and partial unique indexes; correctness does not depend on how many runners exist |
| Bounded units of work | A run has a time budget, a recording is never downloaded (its length comes from the MP4 header in a few range requests), a meeting has a command cap |
| Back-pressure at the edge | Write limits, bot caps, read limits and the anonymous sign-in limit live in the database or Supabase, so they hold across instances |
| Observability | Every job carries a report with tokens and cost; every keep-alive leaves a row; the health route reports the queue |

A meeting notetaker is bursty and idle-heavy, so compute follows events and the queue
lives in Postgres. The nearest ceilings are Postgres connections through the pooler and
Anthropic's rate limits. At ten times the load, a long queue behind one chain is the
first limit: a small always-on process around `runJobs` can claim beside the functions
under the same leases. At a hundred times, Postgres as a queue (claim contention) and
full-text search cost come next: a broker behind the claim and complete calls, a read
replica, a dedicated search index, media on a CDN.

## Known gaps

Accepted limitations of the design:

- **Video lives in Attendee's storage.** A bot meeting's recording is never copied; it
  lasts as long as Attendee keeps it, and each fresh link is one Attendee call.
- **A private meeting's clip is shared as text only**, because any link to the file
  would expose the whole recording. A sample meeting's clip plays the full source file
  limited to the clip's range, and a clip's excerpt shows every overlapping turn in full.
- **Who may command AFK is decided by a display name.** A participant who renames
  themselves to the sender's name can speak commands.
- **Grounding proves turn ids, owners, dates and addresses**, not the rest of an item's
  wording.
- **A guest workspace is one browser.** Clearing cookies loses it; the dashboard says so.
- **Processing starts from events.** A job released by an outage with no event after it
  waits for the next event or the daily keep-alive. An external pinger on the kick route
  closes that ([going-live.md](going-live.md)); the health route shows the wait.
- **Read limits are per address**, so many people behind one office address share a count.
- **`search_meetings()` is callable directly** with the publishable key, where the
  proxy's read limit does not apply.
- **A changed transcript on re-ingest deletes the meeting's commands**, including the
  results of ones that ran (the history file keeps its line).

Current defects:

- **The live tie rule sees only the speakers heard so far** (audit F2): a second
  matching name that speaks to AFK before the sender has spoken is taken for the sender
  until then, and two people under one identical name cannot be told apart live.
- **The claim token, not the lease, gates publishing** (audit F24), so a run that
  outlives its lease still publishes until the next sweep.
- **`v1` connector ciphertexts open without the owner and provider binding** (audit F40).
- **Small buttons are 32 px tall** (`sm`, `icon-sm`), under the 44 px often used for
  touch.
- **Re-running analysis keeps a tick only on an action worded the same way**
  (migration 54); a reworded action starts unticked.
- **Scheduled bots have no per-user cap.** They are exempt from the one-active-bot rule,
  so only the daily request counts bound how many a user holds scheduled.
- **A purged guest's scheduled bots are not removed at Attendee**; Attendee is told to
  forget their data, but a bot scheduled to join is not cancelled.
- **Meeting dates always print in America/Los_Angeles** (`MEETING_TIME_ZONE` in
  `src/lib/format-date.ts`), whatever the viewer's zone.
- **Playback speed is not persisted** across reloads.
