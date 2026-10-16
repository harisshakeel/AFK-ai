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
| Jobs are created only by the seed import, the Attendee webhook, a typed command, an approval, a rewrite (`rewrite_command()` queues `detect_commands`), `complete_job()` after a summary (`learn`), the notes trigger (`notify_owner`) and the daily keep-alive's scheduling (its bots queue their jobs through the webhook) | The bot and command caps then bound every Claude call anyone can cause; the rewrite is the exception, with no cap of its own (see known gaps) |
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
| Not built: live highlighting during a replayed call (F10), recording upload (F12), allowed speakers beyond the sender (C9), the morning brief (M9), the outgoing webhook (X6), read tools during drafting (X3), a face for the bot (L4, L5), routines (L6), teams | The core journey and the follow-up work come first |

## Simulated behaviour

| What | How | Otherwise |
|---|---|---|
| Send page, "Show me what happens" | A labelled demo of the bot's steps; nothing is sent | The Send button sends a real Attendee bot |
| Tasks tab on one seed meeting | Example cards, labelled as examples, with Approve visible but disabled | Commands on a user's own meetings are real |
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
| Non-functional | Mostly met | Scale has no 3-hour, 5,000-turn test fixture; the AI quality bar and the cost are not measured on the current seed output |

## Known gaps

Accepted limitations:

| Limitation | Effect |
|---|---|
| `search_meetings()` is callable directly with the publishable key | The proxy's read limit does not apply to such calls |
| Read limits are per address | Many people behind one office address share a count |
| A changed transcript on re-ingest deletes the meeting's commands | Results of commands that ran are lost from the card; the history file keeps its line |
| Small buttons are 32 px tall (`sm`, `icon-sm`) | Under the 44 px often used for touch |

Open defects (ids from [audit.md](audit.md)):

| Gap | Effect |
|---|---|
| The live sender match is a token subset with no tie rule (audit F2) | A participant whose name contains the sender's name can command AFK in the call |
| The bot id update after creating a bot is not checked (audit F3) | A bot can record unseen by AFK, and a retry sends a second bot |
| `meeting_commands_turn_fk` has no delete action (audit S1, suspected) | Deleting a meeting with a spoken command probably fails |
| "Share the notes" inserts a new card on every click (audit F4) | The notes can be emailed twice |
| A parse that fails for good re-queues `analyze` and `summarize` (audit F5) | A second owner email, a second history line, lost ticks |
| PIN failures are never reset by a lock's expiry (audit F17) | After one lock, each wrong try locks again for fifteen minutes |
| `save_memory_file()` does not refuse the history files; a template save has no version check (audit D8, F13) | A Google user can change the history files through the Data API; a save can overwrite AFK's lines |
| The webhook ignores `record_live_utterance`'s duplicate flag | A redelivered utterance can post the "Heard" chat line again |
| A Slack card needs a default channel saved on the Connectors page | Without one it cannot be approved |
| `rewrite_command` has no cap | A host can ask for rewrites, each a Claude parse, without limit |
| Media-link renewal has no backoff when the expiry fails to parse | The page can request new links in a loop |
| Re-running analysis deletes `item_states` | Ticks on that meeting's items are lost |
| Scheduled bots have no per-user cap | A user can schedule many bots ahead |
| PIN lockout is per visitor, not per link | Many visitors together can try more than five PINs on one code |
| A purged guest's scheduled bots are not removed at Attendee | They can still join a call after the guest is gone |
| Meeting dates always print in America/Los_Angeles | Dates and times read wrong for users elsewhere |
| Playback speed is not persisted | It resets on reload |
| The 12-character link code carries 56 random bits | The specification says 60 |
| Some `aria-labelledby` ids contain spaces on the dashboard and privacy pages | Those regions lose their accessible names |

## Next steps

1. Fix the open defects above in the audit's order: S1, then F3 and F2, then the
   double sends F5 and F4, then the duplicate "Heard" line, the Slack default channel
   and the rewrite cap.
2. Record the walkthrough (at most five minutes, camera on), saying what is simulated.
