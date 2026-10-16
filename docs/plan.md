# AFK.ai — build plan

Approved 2026-10-16. The phases, the decisions with their reasons, what is simulated, and
the progress log. Requirements are in [requirements.md](requirements.md); the system as
built in [architecture.md](architecture.md); who can do what in
[system-design.md](system-design.md); code rules in [conventions.md](conventions.md); each
feature's flow in [data-flows.md](data-flows.md); the look in [design.md](design.md).

## How we work

- **Each phase is one flow that works end to end on the live link before the next
  starts.** Reviewers open a link, so the first phases make a signed-out visitor land on
  real seed meetings and open the hour-long, eight-person call. The bot, commands, memory
  and connectors come after the core works.
- **First deploy: the end of Phase 0, on day one, with an empty app.** Every phase after
  that ends with a deploy to the same link.
- **Before every commit:**
  1. **Check.** `pnpm check` (`tsc --noEmit`, ESLint, Vitest units, Vitest `tests/db` in
     PGlite) and the phase's Playwright journey. Each run needs the owner's consent;
     consent is asked once per commit for the whole run.
  2. **Browser look.** The changed pages at 1280 px and 375 px, light and dark, forced
     loading, empty and error states, keyboard only, console and server logs clean.
     Screenshots in the report.
  3. **Code review.** `/code-review` on the diff plus the security checklist in
     `.claude/skills/senior-engineer/SKILL.md`.
  4. **Docs.** The progress log below, and whichever of `data-flows.md`,
     `architecture.md`, `system-design.md`, `conventions.md`, `design.md` or
     `requirements.md` the change touches, in the same commit.
  5. **Logs.** `.agent-logs/` is committed with every commit, never left out and never
     batched.
- **Standing rules** (from the owner's global instructions): no `node`, `pnpm`, `npx`,
  installs, builds or tests without consent for that run; never execute code from
  downloads; scan for obfuscated code after every pull.

## Phases

### Phase 0 — Foundation and the live link
- **When done, a user can:** open the live URL signed out and see the AFK.ai home page
  with the Tutorial section empty but styled, in light and dark mode, on a phone.
- **Covers:** NFR-02 (baseline), NFR-04.1, NFR-04.5, NFR-04.6, NFR-04.9.
- **Touches:** Next.js 16 scaffold with strict TypeScript, Tailwind 4, shadcn/ui, the two
  fonts, tokens and theme toggle; `env.ts`; `lib/supabase/` (server, browser,
  service-role); `lib/log.ts`; migration `0001_workspaces` (table + RLS);
  `tests/db/` PGlite harness with the `auth` stub prelude; `app/(public)/page.tsx`;
  `app/api/cron/daily` (heartbeat only); Vitest, Playwright + axe, GitHub Actions; one
  Supabase project; one Vercel project with the daily cron; placeholder chair SVG.
- **Tests:** PGlite loads the migration and proves `anon` reads nothing from
  `workspaces`; `env.ts` rejects a missing secret; Playwright opens the home page at 375
  and 1280 with zero axe violations.
- **Could go wrong:** the PGlite `auth` stub not matching Supabase's functions (fix in the
  prelude). **Cut if short:** nothing.

### Phase 1 — Real seed meetings, signed out, and the landing page
- **When done, a user can:** scroll the landing page (hero video scrubbed by scroll,
  "How it works" timeline), see five real ICSI meetings in the Tutorial with title, date,
  length, speakers and a placeholder one-liner, read the corpus credit and our list of
  changes, and leave a Gmail address to become a test user.
- **Covers:** FR-02.1–3, FR-02.6–7 (seed part), FR-10, FR-11.5, FR-25, NFR-03.8,
  NFR-01.1.
- **Touches:** migrations `0002_meetings`, `0003_segments` (with `text_search`),
  `0004_test_user_requests`, seed policies; `tools/convert-icsi.sh` (afconvert to AAC
  `.m4a`) and `tools/parse-icsi-transcripts.ts`; `supabase/seed/` (script + README with
  corpus IDs, licence, changes); private Storage bucket `audio`; `lib/db/`;
  `components/landing/` (hero video scrubber, timeline, test-user form),
  `components/meeting-list/`; `app/(public)/page.tsx`,
  `app/(public)/tutorial/page.tsx`, `app/(public)/tutorial/about/page.tsx`,
  `app/(public)/privacy/page.tsx`.
- **Tests:** seed script is idempotent in PGlite (run twice, same rows); RLS: `anon` reads
  seed rows and cannot insert; the test-user form stores an email once (unique) and
  nothing else; Playwright: a signed-out visitor sees five meetings and the 60-minute one
  shows eight speakers; reduced-motion shows the play button; axe.
- **Could go wrong:** parsing the ICSI NXT XML transcripts into segments; Storage's 1 GB
  limit (AAC at ≈ 16 MB per hour keeps five meetings well under it); the placeholder
  video's size on the first paint (poster image is the LCP element). **Cut if short:**
  ship the hour-long meeting plus one short one and add the rest later.

### Phase 2 — The meeting page for the hour-long call
- **When done, a user can:** open the eight-speaker meeting, play the audio, watch the
  transcript follow along, click any line to seek, change speed, use the keyboard, and
  arrive at a moment from a `?t=` link, on desktop and phone.
- **Covers:** FR-03.1–10, NFR-01.2–4, NFR-02.2–6.
- **Touches:** `components/meeting/` (player island with `@tanstack/react-virtual`, WebVTT
  track, speaker marks, docked player, phone mini player); `app/(public)/meetings/[id]/`
  (`page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`); a server action that signs an
  audio URL.
- **Tests:** unit: segment-at-time lookup and auto-scroll pause logic; Playwright on the
  8-speaker meeting: click a segment and the player time matches; speed persists after
  reload; `?t=` opens at the moment; keyboard only; axe; the page is interactive under
  2 s on the CI runner.
- **Could go wrong:** virtualisation plus auto-scroll is the fiddliest UI in the project;
  a signed URL expiring mid-play (renew on `error`). **Cut if short:** speed persistence
  and `?t=`.

### Phase 3 — Summaries, navigation and search on the seed meetings
- **When done, a user can:** switch between the four summary templates, click a point to
  jump to its moment, use chapters, the who-spoke-when strip, the speaker filter and
  find-in-meeting, read action items and decisions with their moments, and search across
  the Tutorial meetings.
- **Covers:** FR-04.1–5, FR-04.8–9, FR-05.1–2, FR-05.6, FR-08.1–4, FR-13, FR-02.4,
  NFR-05.3–5, NFR-09.2–4.
- **Touches:** `lib/ai/` (`call.ts` with `CLAUDE_MODEL`, JSON schema, no tools;
  `ground.ts`; prompts; usage logging); migration `0005_summaries_chapters_claims`
  (summaries, chapters, action_items, decisions with `segment_id` + `quote`, `usage`),
  SQL function `store_claims`; seed script extended to generate with the Batch API;
  `components/meeting/` (summary panel, chapters, strip, filter, find);
  `components/search/`; `app/(public)/search/page.tsx`.
- **Tests:** unit: the grounding check drops a claim whose quote isn't in its segment
  and fails the job past 25 %; Zod parse of model output with MSW fixtures; PGlite:
  `store_claims` rejects ungrounded rows, FTS returns the right segment; Playwright:
  switch template, click a point seeks, find marks and steps, filter hides other
  speakers, search opens at the moment; axe.
- **Could go wrong:** grounding too strict on paraphrased quotes (tune normalisation,
  log drop counts); seed-time Claude spend (≈ $0.60 for five meetings, inside the key's
  limit). **Cut if short:** Project update and Brief templates, the speaker strip.

### Phase 4 — Guests, Continue with Google, personal state
- **When done, a user can:** tick an action item or add a highlight on a seed meeting
  and have it persist, create a clip of a seed meeting and open it without an account,
  continue with Google and find the same workspace on another device, see the first-run
  checklist, and reach the Player card from the line under the dashboard list.
- **Covers:** FR-11.1–4, FR-11.6 (partial), FR-12.1–4, FR-12.7–8, FR-05.3–5, FR-05.7,
  FR-06.1–4, FR-07.1–2, FR-07.4–8, FR-23, NFR-04.2, NFR-07.6–7, NFR-08 (guest
  baseline).
- **Touches:** migration `0006_guest_state` (seed_annotations, highlights, clips,
  rate_limits, plan_limits, restrictive `not is_anonymous` policies), SQL functions
  `start_guest_workspace`, `link_or_merge_workspace`, `consume_quota`; `middleware.ts`
  (session refresh, `last_active_at`); the app shell with the sidebar;
  `components/account/`, `components/checklist/`; `app/(workspace)/quests/page.tsx` (the
  Quest log), `app/(public)/clips/[token]/page.tsx`, `app/(workspace)/settings/page.tsx`.
- **Tests:** PGlite: every new table A-can't-read-B; `link_or_merge_workspace` keep and
  merge paths; `consume_quota` atomic under two concurrent calls; Playwright: tick,
  reload, still ticked; sign-in on a preview deployment through the test-only session
  route; clip page plays only the range; axe.
- **Could go wrong:** the anonymous sign-in rate limit (30/hour/IP) in CI (use the test
  session route); Supabase manual identity linking is beta. **Cut if short:** the merge
  choice (keep the account's workspace), the checklist.

### Phase 5 — The bot: Summon AFK, record, transcribe, summarise
- **When done, a user can:** paste a Zoom, Meet or Teams link, choose the call's
  language, summon "AFK.ai Notetaker", watch the state change live, and get a ready
  meeting with video, transcript, summaries, chapters, action items and decisions;
  delete it and have Attendee delete its data.
- **Covers:** FR-01.3–14 (calendar in Phase 8), FR-02 (own meetings), FR-03.2
  (signed-link renewal), FR-04 and FR-05 for own meetings, FR-22.1–5 and 7, NFR-01.5–6,
  NFR-01.8, NFR-03.1–2, NFR-03.5, NFR-04.4, NFR-04.8, NFR-05.1–2, NFR-08 (bot hours),
  NFR-09.1, NFR-09.6.
- **Touches:** migration `0007_jobs_webhooks` (jobs, webhook_deliveries, meeting state
  columns), SQL functions `launch_bot`, `transition_meeting`, `upsert_segment`,
  `claim_jobs`, `complete_job`, `fail_job`, `delete_meeting`; `lib/jobs/` (runner, kick
  client, job kinds); `lib/attendee/` (client, signature, payload schemas,
  transcription settings from `TRANSCRIPTION_PROVIDER`); `lib/ai/transliterate.ts`;
  `app/api/webhooks/attendee/route.ts`; `app/api/jobs/kick/route.ts`;
  `app/api/cron/daily` (now kicks); `components/summon/` (form with consent text and
  language choice, live state); `app/(workspace)/summon/page.tsx`,
  `app/(workspace)/meetings/`.
- **Tests:** unit: Attendee signature verify and reject, replay dedupe; runner chaining
  at a fake deadline; transliteration output is Latin-only; PGlite: forward-only
  transitions, claim, lease, stale lease, complete, fail; `launch_bot` refuses a second
  bot and an over-quota guest; Playwright with the fake Attendee: paste link, joining,
  recording, ready, summary visible; failure path "not admitted". Manual: one real bot
  check on a consented call, and one mixed Urdu/English call run by the owner.
- **Could go wrong:** Vercel's 300 s per function (chain early, bound `max_tokens`);
  Attendee's URL expiry format; Deepgram's multilingual output script. **Cut if short:**
  video (record audio only); collapse the auto-leave states into one "ended early"
  message.

### Phase 6 — Spoken and typed commands, answers in chat
- **When done, a user can:** say "AFK, task for Sam…", "AFK, decision…", "AFK, note…",
  "AFK, highlight that" and see them appear during the call; type the same afterwards;
  ask "AFK, what did we decide about pricing?" and get a cited answer in the meeting
  chat; see every command in the activity log.
- **Covers:** FR-14, FR-16, FR-03.11, FR-04.9, FR-05.8, FR-06.5, NFR-01.7, NFR-08
  (commands, questions, chat messages).
- **Touches:** migration `0008_commands_activity` (notes, activity,
  `segments.is_command`); `lib/commands/` (grammar parser, sender match); the live path
  inside the Attendee webhook; `lib/attendee/chat.ts`; `components/meeting/` (command
  box, Activity tab).
- **Tests:** unit: parser on 40 phrasings including non-commands; sender matching
  including "Sam (2)"; fake Attendee emits an utterance from the sender and a row
  appears within 10 s; from another participant, nothing; a question gives one chat
  message with timestamps; the limit of 20 gives the limit message. Playwright: a typed
  command creates a task.
- **Could go wrong:** Deepgram splitting a command across two utterances (buffer 3 s
  before parsing); the 15 s budget. **Cut if short:** live questions (FR-16); keep
  capture and typed commands.

### Phase 7 — Lore, Spells and the wrap-up (drafts, no sending yet)
- **When done, a user can:** read, edit, download and erase memory; accept or discard
  proposals after a meeting; say "AFK, remember…"; see draft email, invite, reminder and
  Slack cards on the meeting, the Quest log and the Spells page; send a draft back with a
  note and get a rewrite; rate the meeting in the wrap-up.
- **Covers:** FR-17, FR-15.1–2, FR-15.4–6, FR-15.8, FR-15.12, FR-20.1–2, FR-20.5–6,
  NFR-06, NFR-08 (memory, cards).
- **Touches:** migrations `0009_memory`, `0010_cards` (memory_entries with a mandatory
  source, cards with versions), SQL function `return_card`, memory writes with the source
  check; `lib/ai/` prompts for proposals and drafts; `components/lore/`,
  `components/spells/`, `components/wrapup/`; `app/(workspace)/lore/`,
  `app/(workspace)/spells/`.
- **Tests:** PGlite: an entry with no source is rejected; the card state machine including
  the `return_card` cap of 5; Playwright with Claude fixtures: a proposal appears with its
  quote; send back gives a new version with the old kept; memory export downloads JSON
  and Markdown.
- **Could go wrong:** memory growing past the 4,000-token prompt budget (summarise
  sections). **Cut if short:** Markdown export, the People conflict picker.

### Phase 8 — Loadout and sending
- **When done, a user can:** connect Gmail, Google Calendar and Slack and see "reconnect
  by <date>"; approve a Spell and have it sent once from their own account; get the
  summary email; "Share the notes"; get reminders and nudges; see the week's meetings and
  summon AFK from the calendar.
- **Covers:** FR-18, FR-15.3, FR-15.7, FR-15.9–11, FR-09, FR-19, FR-20.3–4, FR-01.1–2,
  NFR-03.6–7, NFR-07.1–5, NFR-07.8, NFR-08 (sends).
- **Touches:** migration `0011_connections_sends` (connections encrypted, card_sends,
  email_sends), SQL functions `approve_card`, `claim_send`, `record_send`;
  `lib/connections/` (OAuth, AES-GCM, Gmail, Calendar and Slack clients,
  `reconnect_by`); `app/api/oauth/*`, `app/api/webhooks/google-calendar`,
  `app/api/webhooks/slack`; `components/loadout/`, `components/calendar/`; the Quest
  log's week view.
- **Tests:** unit: encryption round-trip and rotation by `kid`; Slack and Calendar
  signature checks; a fake Gmail that times out after accepting moves the card to
  `needs_check` and never resends; PGlite: `approve_card` double-click returns zero rows;
  `claim_send` stale lease. Playwright with fake providers: connect, approve, "Sent" with
  a provider id; "reconnect by" shows seven days after connecting.
- **Could go wrong:** Google's Testing mode limits (100 test users, tokens expire after
  seven days — the Loadout page says so); Calendar push channels. **Cut if short:**
  Slack, calendar push (poll every five minutes), reminders and nudges.

### Phase 9 — Sharing, lifecycle and the game layer
- **When done, a user can:** share a whole meeting behind a PIN; share a transcript-only
  clip of a private meeting; export data and delete the account; see levels, streak and
  badges on the Player card.
- **Covers:** FR-21, FR-07.3, FR-24, FR-12.5–6, NFR-03.6, NFR-08 (PIN).
- **Touches:** migration `0012_pin_shares_game`, SQL functions `create_pin_share`,
  `check_pin`, `purge_guests`; `components/share/`, `components/player-card/`;
  `app/(public)/shared/[token]/`, `app/(workspace)/player/page.tsx`; jobs
  `guests.purge`, `cards.nudge`.
- **Tests:** PGlite: 5 wrong PINs lock, 20 disable; `purge_guests` deletes only idle
  anonymous users and cascades; Playwright: the PIN page shows recording, transcript and
  summary and nothing else; the Player card counts only real meetings; axe.
- **Could go wrong:** nothing structural. **Cut if short:** FR-24 entirely.

## Decisions, with reasons

| Decision | Reason |
|---|---|
| Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, shadcn/ui | Server Components keep private data on the server; one framework for pages, actions and routes; accessible token-based components |
| Supabase: Postgres with RLS on every table, anonymous sign-in for guests, Google sign-in, private Storage for audio | One service; anonymous users give guests an `auth.uid()`; `linkIdentity` is "Continue with Google"; server-signed URLs keep audio private |
| One Supabase project, one Vercel project | Free tier; nothing to keep in sync. Preview deployments share the project with test modes enabled only in the Preview environment |
| Vercel Hobby with a daily cron | Free; the cron writes a heartbeat so Supabase never pauses and kicks due jobs. Non-commercial for the build and demo; decide again before any public launch |
| Attendee, recording video; captions by default, Deepgram switched on by `TRANSCRIPTION_PROVIDER` | Captions are free; Deepgram's multilingual mode handles English and Urdu when enabled. Attendee and Deepgram usage costs accepted |
| Claude Sonnet for every call, from `CLAUDE_MODEL`; no tools; a JSON schema; the transcript as data; every output checked against the transcript before storing | One model to test; switch to Haiku later without code changes; a transcript can never trigger an action; "never invents" enforced in code. Revisit with real cost data once the bot works (first real two-minute call: about seven cents) |
| No worker, no queue: a Postgres `jobs` table with leases, run by the app's own functions after a response; a kick route chains a new function | Nothing to run or pay for; `SKIP LOCKED` leases are safe; chaining stays inside the 300 s limit |
| Zod at every boundary | One schema per shape; `safeParse` on forms, actions, routes, env, webhooks and model output |
| Vitest units; PGlite running the real migrations; Playwright with an accessibility scan | No Docker; RLS tested against real Postgres semantics; axe covers WCAG 2.2 AA |
| State changes in SQL functions, one transaction each; signed idempotent webhooks; secrets only in env; logs with ids and counts; rate limits in the database; sends at most once | Rules enforced where the data lives |
| Roman Urdu committed: Deepgram multilingual mode; the Send page asks the call's language ("English and Urdu" by default, remembered in the browser, or "English") | Owner will run a mixed-language test call once the bot works |
| Google OAuth client kept in Testing mode, not published | Avoids verification; 100 test users; connectors must be reconnected every seven days, shown on the Loadout page; the landing page collects Gmail addresses to add as test users |
| ICSI audio re-encoded to AAC `.m4a` with `afconvert` on the owner's Mac, script under `tools/` | Built into macOS, no third-party tools; ≈ 16 MB per hour, under Supabase's 50 MB file limit |
| Landing hero is a twelve-second video scrubbed by scroll; reduced motion gets a play button; placeholder until the owner supplies it | Owner's call; the poster image is the LCP element and the video loads after |
| Placeholder chair SVG now; final art, icons, favicon and social image drawn from one SVG | Owner supplies the mark |
| The game layer in Phase 9; the Player card reached from one line under the dashboard list, not the sidebar | Catch-up comes first; gamification stays light |
| `.agent-logs/` committed with every commit | Owner's rule; the logs are part of the record |
| Rejected: a separate worker or container | Adds a service to run and pay for |
| Rejected: a queue service | Postgres leases are enough at this scale |
| Rejected: any paid tier | The project must cost nothing beyond Claude |

## What is simulated

| Thing | How | Real use |
|---|---|---|
| Attendee | `ATTENDEE_MODE=fake`: a local route accepts bot creation, replays the eight-speaker seed transcript as signed `transcript.update` webhooks on a timer, emits state changes, and a fake `send_chat_message` records messages. Failure injection by a meeting-URL suffix (`#not-admitted`). | One manual check per bot phase on a consented call |
| Claude | MSW in unit tests; `AI_MODE=fixture` in e2e replays responses recorded once from real calls on seed meetings, saved under `tests/fixtures/ai/` | Seed-time generation and manual checks; spending limit on the key |
| Deepgram and captions | Only through Attendee; the fake replays text | Through Attendee |
| Google sign-in | A test-only session route (`AUTH_TEST_MODE=1`, Preview environment only) that creates a session for a fixed test user | Manual checks |
| Gmail, Calendar, Slack | `PROVIDERS_MODE=fake`: base URLs point at local fake routes that record sends; a header injects timeouts and 5xx | Manual checks with the owner's accounts |
| Time | Fake timers in unit tests; the runner takes an injected clock | — |
| The hero video and the chair mark | Placeholders until the owner supplies them | — |
| Seed meetings | **Never simulated.** Real ICSI audio and transcripts | Always |

## Progress log

| Date | Phase | What landed | Checks |
|---|---|---|---|
| 2026-10-16 | — | Research, requirements v6, architecture, system design, conventions, data flows, design, this plan, `CLAUDE.md`. Commit "Build plan and docs". | Docs only; no code, nothing run |
