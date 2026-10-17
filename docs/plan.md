# AFK.ai plan

The decisions behind the product and their reasons, what is simulated, where each
requirement group stands, and what is left.

| Document | What it holds |
|---|---|
| [assignment.md](assignment.md) | The brief, verbatim |
| [requirements.md](requirements.md) | What it must do, with acceptance criteria |
| [architecture.md](architecture.md) | The system as built: data model, processing, pages |
| [system-design.md](system-design.md) | Who can do what, security controls, limits, known gaps |
| [data-flows.md](data-flows.md) | Each feature from its first input to its last output |
| [design.md](design.md) | The look: fonts, tokens, pages, accessibility |
| [conventions.md](conventions.md) | Folder structure and code rules |
| [going-live.md](going-live.md) | The owner's steps for every outside service |
| [setup.md](setup.md) | The owner's setup steps for every environment variable and CLI login |
| [audit.md](audit.md) | A static audit of the code against these documents, with findings to fix |
| [research.md](research.md) | The Fathom research the product was shaped against |

## Status

**2026-10-16:** built and deployed at https://afk-ai-tau.vercel.app from
https://github.com/harisshakeel/AFK-ai. CI (lint, types, formatting, unit and database
tests) is green. The walkthrough is not recorded yet.

**2026-10-17:** a security review and a quality review were worked through locally
(the decisions dated 2026-10-17 below, migrations 43 to 55). Not yet committed or
deployed: the migrations go to Supabase before the code ships, because the code reads
the columns they add.

## Our reading of the brief

The brief is in [assignment.md](assignment.md), verbatim. As we read it:

- **The product** is an AI meeting notetaker: it joins calls, records, transcribes, and
  gives you a summary, action items and moments you can share.
- **The case that matters** is an hour-long call with eight people. Most of the value
  comes after the call: finding a decision or a moment in a recording you were not fully
  present for, and passing it to someone who was not there.
- **The capture layer may be stubbed,** if we say so. Anything simulated is listed below.
- **Deliverables:** a live link that works signed out, a repository with the agent logs
  committed, real seed data with one long meeting (never an empty list, never invented
  conversations passed off as real), and a walkthrough of at most five minutes, camera on.
- **Judged on:** speed (how much working product), product judgement (what is built
  first and what is left out) and UX and UI.

The flows the brief names, and where each lives:

| Flow | In AFK.ai |
|---|---|
| Connect a calendar | Google Calendar on the Loadout page; the week's meetings with a link on the dashboard (F9a) |
| Get the notetaker into a real meeting and record | A real Attendee bot, for anyone (F9) |
| Highlight a moment | On the meeting page during playback, `H` or a selection (F6); "AFK, highlight that" in the call (C3) |
| Watch playback against the transcript | F2, F3 |
| Read the AI summary, switch templates | F4 |
| Pull the action items | F5 |
| Search across meetings | F8 |
| Share a clip with someone not on the call | F7, and the whole meeting behind a PIN (A1) |
| An eight-person call that runs an hour | The seed meeting `bmr007`: 60 minutes, 8 speakers |

## What we built first, and what we left out

The order, from the phase plan approved before any code (agent log
`2026-10-16_05-33-31_…md`), and why: **reviewers open a link.** Each phase was one flow
working end to end on the live link before the next began, and the link was deployed
from the first phase on, so it never broke.

1. **The live link, signed out,** with real seed meetings. A reviewer lands on real
   recordings, never an empty list, before any sign-in, bot or Claude call exists.
2. **The meeting page for the hour-long, eight-person call:** player, transcript that
   follows, click to seek, keyboard, `?t=` links. This is the brief's hardest case and
   the product's centre, so it came before anything around it.
3. **Summaries, navigation and search on the seed meetings:** the first Claude work, done
   once at seed time and committed, so the signed-out tour costs nothing per visit.
4. **Guests and personal state:** ticks, highlights, clips, then Continue with Google.
   Guest mode came before the bot so that "no account needed" held for everything.
5. **The real bot,** for anyone: paste a link, record, transcribe, summarise.
6. **Commands in the call,** typed afterwards, and answers in the meeting chat: the
   difference from Fathom, which records only while you are present
   ([research.md](research.md) §11). AFK is for the person who is not.
7. **Memory, cards and the wrap-up,** drafts only, then **connectors and sending,** one
   approval each, and last **sharing behind a PIN, Roman Urdu and the game layer.**

What each phase was allowed to drop if time ran short was written down with it (for
example speed persistence before seek-and-sync, Slack before Gmail). What we left out
for good, and why, is the "Not built" row under Decisions: live highlighting during a
replayed call, recording upload, allowed speakers beyond the sender, the morning brief,
the outgoing webhook, read tools during drafting, a face for the bot, routines and teams.
Each is either covered another way (`/ask` instead of chat-with-the-meeting) or matters
only once the core journey is used daily.

## Decisions

| Decision | Reason |
|---|---|
| Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4 with shadcn/ui, Zod 4 at every boundary | One framework for pages, routes and server code; private data stays on the server; one schema per external shape |
| Supabase for Postgres with RLS on every table, Auth (anonymous and Google) and private Storage | One free service covers data, identity and audio; RLS enforces privacy where the data lives |
| No workspaces table: every owned row carries `owner_id` (an `auth.users` id); a meeting with `owner_id` null is a public seed meeting | One identity is one workspace; ownership is one column compare in RLS |
| Guests are anonymous Supabase users, created on the first write (a tick, a highlight, a bot, an access request), not on page load | Nobody needs an account to try the product; reading the samples creates nothing; a guest owns meetings like a Google user |
| Continue with Google links the guest identity (manual linking) instead of making a new one | The guest keeps everything they made |
| Guests that never continue with Google are purged after thirty days by the daily keep-alive | Anonymous rows do not pile up; the dashboard says a guest workspace is one browser |
| Memory files, contacts and connectors belong to Google users only; the database refuses them to guests | They hold personal data and tokens that need a durable identity |
| Anyone may send the bot, under caps in one database trigger: one active bot per identity, 5 a day per identity, 5 a day per place, `bot_daily_cap` (20) a day across the deployment | The bot is the product; the caps bound Attendee hours and Claude spend |
| Attendee for the bot, recording video (MP4, speaker view, 720p) that stays at Attendee and plays through its thirty-minute links | No media storage or transcoding of our own; the ingest reads the length from the MP4 header and never downloads the file |
| Transcripts from the platform's captions by default; Deepgram through Attendee when `ATTENDEE_TRANSCRIPTION=deepgram`, multilingual by default (`ATTENDEE_DEEPGRAM_LANGUAGE`) | Captions are free and need no key; Deepgram is far more accurate and catches Urdu or Hindi in an English call |
| Urdu and Hindi turns are written in Roman Urdu by `romanizeTurns()` before storing; the notes stay English | A bilingual call is transcribed rather than lost, and readable by everyone on it |
| Claude through the API (`@anthropic-ai/sdk`) inside the app's own functions; the model from `CLAUDE_MODEL`, default `claude-sonnet-5-5` | No worker or container to run or pay for; one model to test; the model changes without code |
| Every Claude call has no tools, a JSON schema the API enforces, the transcript as data, and output grounded against the transcript before it is stored | A transcript can never trigger an action; citations, owners, dates and addresses are proved in code, the rest is dropped and reported |
| Jobs live in Postgres (`processing_jobs`), leased with `for update skip locked`; the runner runs after a response in the webhook, the meeting page, the typed-command, approval and rewrite routes, `/api/jobs/kick` and the daily keep-alive, and chains through the kick route when its budget runs out | No queue service; leases make retries safe; chaining stays inside Vercel's 300 s per function |
| Jobs are created only by the seed import, the Attendee webhook, a typed command, an approval, a rewrite (`rewrite_command()` queues `detect_commands`), `complete_job()` after a summary (`learn`), the notes trigger (`notify_owner`) and the daily keep-alive's scheduling (its bots queue their jobs through the webhook) | The bot and command caps then bound every Claude call anyone can cause, the rewrite included: three per draft, counted in the database (migration 43) |
| A job has at most 3 attempts, due again after 1 minute, then 4 minutes; the third failure is final | A passing fault gets two retries; a lasting one stops costing money |
| Grounding drops failing items one by one and publishes what survives, with no failure threshold | A partly wrong answer still yields its proven items; a `summarize` with no surviving template stores an empty list |
| Vercel Hobby in `bom1` with one daily cron (`/api/cron/keepalive`, 06:17 UTC) | Free; one real query a day keeps Supabase Free from pausing, and the same run prunes, sweeps and purges |
| Commands come from the bot's sender only, after the wake word "AFK", detected by a fixed pattern with no AI; the sender is matched by name | Deterministic and testable; nobody else on the call can make AFK act |
| Internal command effects land at once; anything that leaves the meeting (email, follow-up, reminder, Slack) waits on a card for one approval and runs at most once | The host stays in control of what goes out in their name |
| Memory is nine markdown files per Google user (`profile.md`, three context files, two history files, three skills), 32 KB each, with the user's zone above a `---` rule and "Learned by AFK" below it | Plain files the user can read, edit, download and erase; AFK never changes the user's zone |
| People AFK knows (`contacts`) are learned from confirmed cards, the People file, calendar invites and a Google import; a card shows its best guess with the reason | Drafts go to real addresses, never invented ones |
| Gmail and Calendar share one Google consent with offline access and PKCE; tokens are sealed with AES-256-GCM under `CONNECTOR_TOKEN_KEY` in `connector_secrets`, which no user role can read | One connect for both apps; a token never reaches the browser, a cookie or a log |
| Slack is a bot app with `chat:write`, `chat:write.public` and `channels:read`; the post is the host's own words | It posts to any public channel without joining; no model rewrites what goes to the team |
| The Google OAuth consent screen stays in Testing | No verification review; up to 100 test users; the landing collects Gmail addresses (`access_requests`) for the owner to add; the Connectors page shows "reconnect by" seven days out |
| Every meeting has an address, `/m/<code>`, behind a four-digit PIN, both minted by a database trigger with the meeting row (migration 39) and shown to the owner alone | Passing the recording, transcript and summary on is one copy; nothing of the owner's (tasks, commands, memory) is exposed |
| A shared clip of a private meeting is transcript-only | Any media link would expose the whole recording |
| Schema changes are SQL migrations committed in `supabase/migrations/` (`20261016000001_meetings_and_turns.sql` to `20261016000039_meeting_links.sql`), applied with `supabase db push` | The database is rebuilt from the repository; the PGlite tests run the same files |
| State changes that must hold together are SQL functions, one transaction each (`claim_job`, `complete_job`, `ingest_transcript`, `apply_commands`, `approve_command`, `start_command`, `finish_command`) | Rules are enforced where the data lives, across every instance |
| Rate limits are counted in the database (writes per identity, public reads per client under a keyed hash) | They hold across serverless instances with no cache service |
| Seed data is five real ICSI meetings with committed Claude output in `data/ai/`; the audio (`data/audio/`) is gitignored, encoded locally with `tools/icsi/encode_audio.sh` and already held by the live project | Real data from the first visit; the hour-long, eight-speaker meeting is the brief's case; the repository stays small |
| "Catch me up" is the default of four summary templates | The product is for the person who was not there |
| Gaming words in the shell (Quests, Spells, Lore, Loadout, Tutorial, Summon AFK) and a Player card counted from the user's own rows | Its own identity, kept light; nothing estimated |
| Light by default, dark as a choice remembered in the browser | The landing's palette is the brand; the toggle is one click |
| Browser journeys run from the owner's machine, not in CI | They need the live database's keys, which stay off GitHub; CI runs lint, types, formatting, unit and database tests |
| The stale-bot sweep times every bot row from when its call was due, `coalesce(scheduled_for, created_at)`, not from a new started-at column (migration 40, audit F1) | A bot joins at its scheduled time and Attendee ends every call within three hours, so six hours from that time never closes a live call; no column, webhook change or backfill is needed |
| A Google user is an identity with Google among its sign-in providers (`app_metadata.providers`), checked by `isGoogleUser()` in the app and `is_google_user()`/`is_guest()` in SQL; email sign-up is off through `config.toml`, the Email provider stays on for the browser journeys' throwaway user, which `e2e/signed-in.ts` marks with Google through the admin API (migration 44, security review 2026-10-17) | The checks used to ask only "not anonymous", and the project allowed email sign-up, so any confirmed address got memory, contacts and connectors and escaped the guest purge; `app_metadata` is written by Supabase Auth alone |
| Fifty wrong PINs on one code, summed over every client that tried it in the last day, switch the link off; the owner's switch clears the count (migration 47, security review 2026-10-17) | The lock was per address only, so a couple of thousand addresses could try every PIN on a leaked code in minutes; the budget leaves a guesser about a 0.5% chance, and the owner makes a new link and PIN |
| At most three access requests per identity (migration 46, security review 2026-10-17) | The write limit was the only bound, so one address minting guest identities could add tens of megabytes a day and push the Free-plan database to read-only |
| Route handlers are tested beside the route, with only the edges mocked: the Supabase client factories (a small fake in `src/test/fake-supabase.ts`), Attendee's client, the job kick and the logger (quality review 2026-10-17) | The access decisions, the owner checks and the status rules live in the handlers; mocking our own modules would test the mocks. The approval, delete, PIN and proxy paths are covered first, as the ones that send, delete or open something |
| The approval form's fields and the details they become live in `approval-draft.ts`, a pure module with tests; the component keeps the markup, in `approval-form.tsx`, apart from the Tasks tab (`tasks-tab.tsx`), the card's rewrite and email actions (`card-actions.tsx`) and the typed command box (`typed-command-form.tsx`) | The form was a 450-line component mixing state, building and markup; the build is what an approval sends, so it is now tested on its own |
| One media-link hook for the meeting page and a meeting's address, `useRenewingMedia()` (quality review 2026-10-17) | The two copies differed (one blind cast, two minimum waits) and an expiry that did not parse renewed in a loop; the hook checks the route's answer with Zod and waits a minute on an unreadable expiry |
| Smaller fixes from the security review (2026-10-17) | Approve refuses a command that runs nothing; approval refuses a message with a meeting address that is off or replaced; a "Share the notes" card cannot be rewritten; deleting a meeting treats only a bot-related 4xx from Attendee as "already gone"; the address-heard pattern no longer backtracks exponentially; the SDK's own errors never carry model output into logs or cards; live questions take no place under the spoken cap; a remember line is dated by its meeting; the live answer's cached block is the meeting's lines; cross-site writes are refused in the proxy; session cookies are Secure; the OAuth state has its own derived key; a production deployment without `NEXT_PUBLIC_SITE_URL` fails loudly |
| A Claude timeout uses an attempt when the call had at least 200 s; a shorter one is still released (security review 2026-10-17, audit F26) | The SDK reports a timeout as a connection error, so every timeout released the job without an attempt, and a job too long for any run was paid for every five minutes for ever |
| The command parse, the analysis and the summaries have no hard limits in the schemas sent to Claude; code clamps every value to the stored limits before grounding (security and quality reviews 2026-10-17) | The API treats lengths, counts and ranges as hints and the SDK checks them after the call is paid, so a sixth recipient or a five-minute follow-up failed the whole parse three times and lost every spoken task of the meeting |
| A romanized line replaces its turn only when it can be the same words: the original's Latin words kept in order, no new wake word, address or link, at most three times as long (security review 2026-10-17) | The rewritten text becomes the transcript commands and notes are read from, and a chunk mixes speakers, so one participant's instruction could rewrite the sender's turn into "AFK, email …". The cost: a command spoken wholly in Urdu script (the wake word transcribed in Devanagari) is not taken from the romanized text; commands are English, and it can be typed |
| The in-call answer's prompt holds the meeting's lines only, no memory (security review 2026-10-17) | The answer goes to a chat everyone in the call reads, and memory holds the host's private notes and the titles and headlines of other meetings; grounding checks that a line is cited, not where the words came from |
| The live sender is decided by the tie rule over the names heard so far, read only for a line addressed to AFK (audit F2, quality review 2026-10-17) | Keyed on names, not speaker ids: a sender who rejoins gets a new id but keeps the name. One small read per command line keeps the webhook fast; the rule matches the after-call parse, so a card and a chat line agree on who the sender was |
| A bot no row knows is matched by the meeting id in its metadata; a waiting row takes its id, a failed row's bot is taken back (audit F3, quality review 2026-10-17) | Its sender was told the send failed and may have sent another bot, so reviving the row could put two bots in one call; taking it back leaves one, and its id on the row lets a delete purge it |
| A parse that finishes queues one more when a waiting row changed after it started, by a trigger on the job row (audit F8, quality review 2026-10-17) | The route and `rewrite_command()` cannot queue a second parse while one runs (one active job per kind); the trigger runs inside `complete_job()`'s transaction, and keying on the row's change time against the job's start means a row the parse saw and left never loops |
| A new analysis puts each visitor's tick back on the action with the same text (quality review 2026-10-17) | Item ids change on every analysis and ticks cascade from the item; the text is the one honest sign of the same task, and a reworded action may be a different one |
| The Email provider is off in production, and the browser journeys sign their throwaway user in with a one-time link the admin API mints (2026-10-17) | `[auth.email] enable_signup = false` turns off the whole Email provider, password sign-in included; GoTrue's only other switch, sign-ups off, would also stop guests' anonymous identities. Google stays the only way in, and the journeys still cover the signed-in app |
| Guests together may use at most half of the day's bots; Google users can use the whole cap (migration 48, security review 2026-10-17, owner's choice over a CAPTCHA for now) | Guest identities are free, so four addresses could take all twenty bots and leave none for anyone; the share keeps room for signed-in users without a third-party script. Guests can still be booked out by someone determined |
| Teams links need a meeting path (`/l/meetup-join/…` or `/meet/<id>`) like Zoom and Meet (security review 2026-10-17, audit D15) | A bare Teams address passed the check, took a slot of the deployment's daily bot cap and only failed at Attendee, so four addresses could book the bot out for everyone with no meeting at all |
| The auth callback never signs out; a link conflict only redirects to `/sign-in?error=linked`, which says the guest workspace stays behind (security review 2026-10-17) | The callback is a GET anyone can link to, and the PKCE cookie it trusted lives 400 days, so one link signed a user out everywhere and abandoned a guest's workspace for good |
| A meeting's address shares only notes said on the call; a typed `/note` stays with the owner (migration 45, security review 2026-10-17) | `get_shared_meeting()` returned every note item, and a typed note makes the same row as a spoken one, so a private line typed after the call reached every PIN holder as "Notes from the call", against what the PIN page promises |
| The address book reads only the zone of the people file the host wrote (security review 2026-10-17) | A learned line holds what anyone on a call said plus the meeting's title, so an address said by a participant or put in an invite's title was offered as "from your People file", ranked above everything |
| A lone speaker is taken as the sender only when AFK knows no name for the sender (security review 2026-10-17) | The owner is often absent; in a 1:1 they skipped, the other person spoke alone and was taken as the sender, so their "AFK, remember …" wrote into the owner's memory with no approval. A sender on an unknown device label types the commands or sets "Name in calls" |
| Calendar auto-join and invitee learning use only events the user organised or accepted (security review 2026-10-17) | Anyone can put an invite on someone's calendar; joining every event with a link let a stranger bring the bot into their call under the user's name and fill the address book with names and addresses they chose. Send AFK on any listed event stays the user's choice |
| A draft can be rewritten three times, counted in the database, and each rewrite takes a write-limit slot inside `rewrite_command()` (migration 43, security review 2026-10-17) | Every rewrite is a Claude parse of the whole transcript, and the function is callable from the browser, so a guest could loop it without end; three covers a host refining a draft, and a retyped command falls under the typed cap |
| Not built: live highlighting during a replayed call (F10), recording upload (F12), allowed speakers beyond the sender (C9), the morning brief (M9), the outgoing webhook (X6), read tools during drafting (X3), a face for the bot (L4, L5), routines (L6), teams | The core journey and the follow-up work come first |

## Simulated behaviour

| What | How | Otherwise |
|---|---|---|
| Send page, "Show me what happens" | A labelled demo of the bot's steps; nothing is sent | The Send button sends a real Attendee bot |
| Tasks tab on the seed meetings | Example cards, labelled as examples, with Approve visible but disabled | Commands on a user's own meetings are real |
| Memory page for a visitor | A labelled demo profile | A Google user's nine files |
| Seed meetings | Not simulated: real ICSI audio and human transcripts; speakers are anonymous in the corpus and labelled "Speaker A", "Speaker B" and so on | |
| Seed AI output | Not simulated: real Claude output, generated once and committed under `data/ai/` | |

Everything else is real: the bot, the recording, the transcript, the Claude output and
the sends.

## Where we stand

| Group | Status | Notes |
|---|---|---|
| B1-B4 the brief | B1 and B3 met; B2 is this repository; B4 not done | The walkthrough is not recorded |
| F0-F9b core: import, list, playback, navigation, summaries, items, highlights, clips, search, the bot, calendar join, delete | Built | F10 and F12 not built by decision; F11 is covered by `/ask` |
| C1-C8 commands | Built | C9 not built |
| M1-M8, M10, M11 memory and contacts | Built | M9 not built |
| X1, X2, X4, X5, X7, X8 connectors | Built | X3 deferred; X6 not built |
| L1-L3 live presence | Built | L3 speaks only with text-to-speech credentials in the Attendee project; L4 and L5 dropped; L6 not built |
| A1 meeting address | Built | |
| W1-W7 after the meeting | Built | |
| P1-P5 processing | Built | |
| Non-functional | Mostly met | Scale has no 3-hour, 5,000-turn test fixture; the AI quality bar (20 items of `bmr007` checked by hand) and the cost per meeting are not measured on the current seed output; page speed is, under Measured below |

## Measured

From `e2e/metrics.spec.ts` (opt-in, numbers kept out of git in `.metrics/`): a
development build (`next dev`) on localhost, installed Chrome, a fresh context per load,
medians of five runs. A production build is faster; these are the floor of what we know.

| What | Desktop 1280 px | Phone 412 px |
|---|---|---|
| Hour-long meeting (`bmr007`, 1,067 turns) largest paint | 1.53 s | 1.46 s |
| The same on slow 4G with a 4× slower CPU: largest paint, then interactive | | 5.6 s, 11.3 s |
| A short meeting (`bro015`, 126 turns) largest paint | 0.64 s | 0.65 s |
| Landing page largest paint | 0.25 s | 0.28 s |
| Switch summary template / switch tab / seek by transcript line | 51 / 19 / 70 ms | 17 / 64 / 76 ms |
| Transcript following the audio over 30 s | 1,782 of 1,783 frames in sync | 1,767 of 1,768 |
| Search page, full load | 0.67 s | 0.66 s |

The slow-4G phone figure is the weak spot: the hour-long meeting renders and hydrates all
8,600 elements of its transcript and timeline before it answers (quality review,
2026-10-17); windowing the transcript is the fix.

## Known gaps

Accepted limitations:

| Limitation | Effect |
|---|---|
| `search_meetings()` is callable directly with the publishable key | The proxy's read limit does not apply to such calls |
| Read limits are per address | Many people behind one office address share a count |
| `http://localhost:3000/auth/callback` is in the live project's redirect list (owner's choice: local development uses the live project) | A sign-in started by someone else could return tokens to whatever listens on a victim's port 3000 |
| No CAPTCHA on guest identities | A few addresses can still use up the guests' half of the day's bots; Google users keep the other half |
| A changed transcript on re-ingest deletes the meeting's commands | Results of commands that ran are lost from the card; the history file keeps its line |
| Small buttons are 32 px tall (`sm`, `icon-sm`) | Under the 44 px often used for touch |

Open defects (ids from [audit.md](audit.md); a finding fixed since the audit carries a
status line there, and Part 5 lists them; the ones a user is most likely to meet):

| Gap | Effect |
|---|---|
| The live tie rule sees only the speakers heard so far (audit F2) | A second matching name who speaks to AFK before the sender does is obeyed until the sender speaks |
| Re-running analysis keeps a tick only on an action worded the same way | A reworded action starts unticked |
| Scheduled bots have no per-user cap | A user can schedule many bots ahead |
| A purged guest's scheduled bots are not removed at Attendee | They can still join a call after the guest is gone |
| Playback speed is not persisted | It resets on reload |
| Loading skeletons drop the app frame (audit F14) | Each navigation inside the app jumps |
| The meeting page re-renders whole to see a job's progress (audit F20) | It backs off to every 30 s and stops after 20 minutes; a status route would poll less |
| Times print in UTC and dates in America/Los_Angeles | A user elsewhere reads the wrong clock time |

## Next steps

1. Fix the open defects above, most likely to be met first: F14 (the loading skeletons,
   which needs a browser check), then the scheduled-bot cap.
2. Record the walkthrough (at most five minutes, camera on), saying what is simulated.
