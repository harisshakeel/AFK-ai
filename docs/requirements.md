# AFK.ai — requirements

AFK.ai is an AI meeting helper built for the person who wasn't fully there: they were
double-booked, half-listening, or absent, and need to catch up in minutes without asking
anyone to repeat themselves. It goes beyond a notetaker: it takes spoken commands during
the call, drafts the emails, invites, reminders and Slack posts that follow, and sends
them only after the user approves. Every output leads back to the moment in the recording
where it was said, so the user can check anything they don't trust.

Status: draft v6, 2026-10-16. Based on a hands-on run of Fathom,
[docs/research.md](research.md), the product decisions in the [Decisions](#decisions)
section, and the AFK.ai additions (FR-12 to FR-25, NFR-06 to NFR-09), marked
**[AFK.ai addition]**. v4 to v6 amend criteria to match the stack and plan in
[docs/architecture.md](architecture.md) and [docs/plan.md](plan.md) (Next.js 16, Supabase
with anonymous users and private Storage, Vercel with a daily cron, Attendee with
captions by default and Deepgram by switch, Claude Sonnet from `CLAUDE_MODEL` with a JSON
schema and no tools, jobs in a Postgres table). How the system behaves is in
[docs/system-design.md](system-design.md); the look is in [docs/design.md](design.md).
No code exists yet.

## Priorities

- **P0** — the product doesn't work without it. In the first release.
- **P1** — expected by users; ships in the first release if time allows, otherwise next.
- **P2** — valuable, not required for launch.

## Definitions

- **Workspace** — the private container for one user's meetings, memory, cards and
  settings. A guest gets one on their first action (FR-12); "Continue with Google"
  attaches it to a Google account (FR-11).
- **Owner** — the user whose workspace a meeting belongs to; the one who sent the bot.
- **Sender** — the owner, as a participant on the call. Only the sender can give spoken
  commands (FR-14) or ask questions during the call (FR-16).
- **Seed meeting** — one of the five ICSI Meeting Corpus meetings loaded into every
  environment (FR-10). Seed meetings are public: anyone can open them, with or without a
  workspace.
- **Moment** — a timestamp in a recording, in milliseconds from the start.
- **Segment** — one transcript line: speaker, start and end moment, text.
- **Ready** — the meeting has a recording, a transcript and at least one summary.
- **Card** — a pending outbound action (email, calendar invite, reminder, Slack post)
  waiting for the owner's approval (FR-15).
- **Memory** — what AFK.ai has learned about the owner: profile, people, projects,
  words, and writing preferences (FR-17).

## Scope of this release

- Transcription and notes are in English. Urdu or Hindi speech is transcribed in Roman
  Urdu (FR-22); notes stay in English.
- During the call, AFK.ai listens for the sender's commands (FR-14) and answers the
  sender's questions in the meeting chat (FR-16). Every other feature happens after the
  call.

---

## Functional requirements

### FR-01 — Connect a calendar and send the bot to a call — P0

The owner connects their Google Calendar once. AFK.ai sends a bot to Zoom, Google Meet and
Microsoft Teams calls on that calendar. The bot joins, records and transcribes, whether or
not the owner is on the call. The owner can also paste a meeting link for a call that
isn't on the calendar.

Acceptance criteria:
1. The owner can connect a Google Calendar with OAuth and disconnect it from settings.
   Nothing is stored before the owner consents. Google Calendar is the only calendar
   supported.
2. Upcoming meetings with a Zoom, Meet or Teams link appear in an "Upcoming" list within
   5 minutes of being added to the calendar, each with a toggle: *Send bot* on or off.
   The default is configurable: all meetings, none, or only meetings with an external
   attendee. FR-19 extends this list into the dashboard's week view.
3. The owner can paste a Zoom, Meet or Teams URL and send a bot now. The URL is validated
   on the server; anything else is rejected with a clear message.
4. The send form (and the Upcoming toggle, the first time it is used) shows this text:
   *"AFK announces itself when it joins and everyone on the call can see it. Only send it
   to calls where everyone has agreed to be recorded. Your meetings are private to you."*
5. The bot joins within 60 seconds of the scheduled start, or within 60 seconds of
   "send now". It joins as **"AFK.ai Notetaker"** with no camera image.
6. **The bot records whether or not the owner is on the call.** This is the point of the
   product and the main thing Fathom cannot do
   ([research §2](research.md#2-how-the-bot-joins-calls)).
7. The bot records video: MP4, speaker view, 720p. The recording stays in Attendee's
   storage (see FR-03 for playback).
8. The meeting goes through a stored state machine — `scheduled → joining → recording →
   processing → ready | failed` — and the UI shows the current state live. The owner
   never has to refresh to find out what happened.
9. The bot leaves on its own after 5 minutes in a waiting room, 10 minutes of silence, or
   3 hours of recording. Each case is a distinct, plainly worded state with the next
   action: *not admitted from the waiting room* (retry), *left after 10 minutes of
   silence*, *stopped at the 3-hour limit* (the recording up to that point is kept and
   processed), *removed by the host*, *meeting never started*, *recording failed*
   (contact support). No raw provider errors reach the user.
10. Sending a bot is idempotent: one meeting cannot get two bots. Launches are
    rate-limited per workspace (see NFR-08 for the quotas).
11. Transcription produces segments with speaker, start and end moments, and text. A
    live transcript is received during the call so that FR-14 and FR-16 can act on it.
12. Speaker names are taken from the meeting platform's participant names. A participant
    who drops and rejoins is merged into one speaker automatically. Two different people
    with the same name are numbered: "Sam", "Sam (2)". There is no manual confirm, rename
    or merge step.
13. The meeting is *ready* within 10 minutes of the call ending for a 60-minute call.
14. The Summon form asks the call's language: **"English and Urdu"** (the default) or
    **"English"**. The choice is remembered in the browser. When Deepgram is on
    (`TRANSCRIPTION_PROVIDER=deepgram`) it selects Deepgram's multilingual mode for
    "English and Urdu"; with platform captions (the default) it is informational.

### FR-02 — Meetings list — P0

Acceptance criteria:
1. The list shows every meeting in the workspace, newest first, with: title, date and
   start time (in the owner's time zone), length, the speakers (names, overflowing to
   "+N"), and a one-line summary.
2. The seed meetings appear in a separate "Example meetings" section for every visitor,
   including visitors without a workspace, and are clearly marked as public examples.
3. Meetings not yet ready show their state (scheduled, recording, processing, failed)
   instead of a summary.
4. The one-line summary is generated once the transcript is ready and is at most 160
   characters.
5. Empty state for a new workspace: "No meetings yet" with a button to connect a calendar
   or paste a link, with the seed meetings still shown below.
6. The list is paginated or infinitely scrolled; 500 meetings load without a noticeable
   slowdown.
7. Loading, empty, error and success states all exist (see NFR-02 for accessibility).

### FR-03 — Meeting page with synced playback and transcript — P0

Acceptance criteria:
1. The recording plays in the page: video (MP4, speaker view, 720p) for recorded
   meetings, audio only for seed meetings.
2. Recorded meetings play through Attendee's short-lived signed links. (Attendee
   documents them only as "short-lived"; the 30-minute figure from the product decisions
   is unverified, so the page reads the expiry from the signed URL rather than assuming
   it.) The page requests a link when it loads and renews it before it expires, without
   interrupting playback or losing the current position. Links are never exposed to
   anyone but the owner (or a PIN viewer, FR-21).
3. The transcript is shown as segments with speaker name, timestamp and text. The current
   segment is highlighted and the transcript scrolls to keep it in view while playing;
   scrolling manually pauses the auto-scroll until the user clicks "Jump to now".
4. Clicking any segment seeks the player to that segment's start moment and starts or
   continues playback.
5. Playback speed can be set to 1×, 1.25×, 1.5×, 1.75× and 2×, and the choice persists
   for the owner.
6. Keyboard: space plays/pauses, left/right skips 5 seconds, and the transcript is
   navigable by keyboard with visible focus.
7. The page loads and can start playing within 2 seconds on a 60-minute, 8-speaker
   meeting (see NFR-01).
8. The URL can carry a moment (`?t=1234567`) so links open the page at that moment with
   the matching segment in view.
9. Speaker colours or labels are consistent for the whole meeting.
10. Seed meeting pages show the ICSI Meeting Corpus credit and a link to the list of
    changes made (FR-10).
11. Spoken commands (FR-14) and live questions (FR-16) stay in the transcript, marked as
    commands, with a link to what they produced.

### FR-04 — AI summary with templates, linked to moments — P0

Acceptance criteria:
1. When the transcript is ready, a summary is generated with the **Catch me up** template
   without any action from the owner.
2. The owner can switch between exactly four templates: **Catch me up** (for the person
   who missed it: what was decided, what's expected of me, what changed), **General**,
   **Project update** and **Brief**. There are no custom templates. Switching shows a
   cached result if it exists, otherwise generates one with a visible progress state.
3. Every point in a summary is linked to the moment it was said. Clicking a point seeks
   the player (FR-03) to that moment. A point that cannot be tied to a moment is shown
   without a link, never with a wrong one.
4. Summaries are grounded in the transcript. A spot check of 20 summary points on the
   seeded 60-minute, 8-speaker meeting finds no claim that the linked segment does not
   support.
5. The summary can be copied as Markdown and as plain text with one click.
6. The owner can regenerate a summary. Generation failures (LLM error, rate limit) show
   an error with a retry and keep the previous summary.
7. Transcripts are passed to the model as untrusted content; instructions inside a
   transcript ("ignore previous instructions…") do not change the output.
8. Summaries for seed meetings are generated once at seed time and shared by all
   visitors; visitors cannot regenerate them.
9. Command utterances (FR-14) are not summarised as discussion; only their effects
   (tasks, decisions, notes) appear in the summary.
10. Memory (FR-17) is used to spell names, projects and terms correctly in summaries.

### FR-05 — Action items and decisions — P0

Acceptance criteria:
1. Action items are extracted automatically with: the task, the owner **only if named in
   the call**, the due date **only if said in the call**, and a link to the moment.
   Nothing is inferred: if no owner or date was spoken, the field is empty.
2. Decisions are extracted the same way: the decision as stated, who stated it if clear,
   and a link to the moment.
3. Each action item has a checkbox. Ticking it persists immediately and shows as done
   everywhere the item appears.
4. "Copy" copies all action items (or the selected ones) as a Markdown checklist with
   owner and due date where present.
5. The owner can edit the text, owner and date, add an item manually, or delete one.
   Edited items are marked as edited; the original stays visible on hover.
6. On the seeded 60-minute, 8-speaker meeting, every extracted action item points to a
   segment where the task is actually discussed.
7. On seed meetings, ticks and edits are stored per workspace, so one visitor's ticks
   don't change what another visitor sees.
8. Tasks and decisions created by spoken or typed commands (FR-14) appear in the same
   lists, marked "by command", with the command's moment as their link.

### FR-06 — Highlights — P1

Acceptance criteria:
1. On the meeting page, the owner can mark a highlight by selecting one or more
   transcript segments (or a time range on the player) and giving it an optional label.
2. Highlights appear as markers on the player's timeline and in a "Highlights" list on
   the meeting page. Clicking either seeks to the highlight's start.
3. Highlights can be edited (range, label) and deleted.
4. On seed meetings, highlights are per workspace, like FR-05 criterion 7.
5. "AFK, highlight that" (FR-14) creates a highlight covering the previous speaker's
   turn, up to 60 seconds, ending at the command.

### FR-07 — Share a clip with no account needed — P1

Acceptance criteria:
1. From a highlight or any selected range, the owner can create a clip and get a share
   link.
2. Opening the link shows **only that clip** on a public page that needs no sign-in. The
   viewer sees the clip, its transcript excerpt, the meeting title and date, and only the
   speakers heard in the clip. The owner's name is not shown. The rest of the meeting is
   not reachable from that page, by URL or by scrubbing.
3. A clip of a **private meeting shares the transcript excerpt only** — no audio or
   video. The page says so.
4. A clip of a **seed meeting** plays audio limited to the clip's range. The player may
   load the full public audio file and restrict playback to the range; this is accepted
   because the recordings are public.
5. There is no download button.
6. Links are unguessable (at least 128 bits of randomness) and do not expire. The owner
   can see the clips they've shared and revoke any link at any time; revoking takes
   effect immediately.
7. A revoked link shows "This clip is no longer available", not an error.
8. The clip page meets NFR-02 (accessibility) and works on a phone.

### FR-08 — Search across meetings, opening at the moment — P1

Acceptance criteria:
1. A search box finds matches across the workspace's meeting titles, transcripts,
   summaries, action items, notes and decisions, plus the seed meetings.
2. Results show the meeting, the speaker, the matched text with context, and the moment.
   Clicking a result opens the meeting page at that moment (FR-03 criterion 8) with the
   segment highlighted.
3. Results return within 1 second for 500 meetings with full-text (keyword) search.
4. Results can be filtered by date range and by speaker.
5. P2: natural-language questions ("what did we decide about pricing?") answered from
   the transcripts, with every answer citing the moments it came from, and the question
   history kept (Fathom loses it, [research §7](research.md#7-search-and-ask-fathom)).
   FR-16 covers the same question asked during the call.

### FR-09 — Summary email after each meeting — P1

Acceptance criteria:
1. Emails are sent **from the owner's own Gmail to the owner**, using the Gmail
   connection in FR-18. No email is sent until Gmail is connected, and settings explain
   this.
2. When a meeting becomes *ready*, the owner receives one email within 5 minutes with:
   title, date, length, speakers, the Catch me up summary, action items (with owners and
   dates where said), decisions, the number of cards waiting for approval (FR-15), and a
   link to the meeting page.
3. Each summary point and action item in the email links to the meeting page at its
   moment.
4. A profile setting turns the email off.
5. If the meeting failed, no summary email is sent; the owner gets one email saying what
   failed and what to do.
6. Exactly one email per meeting, even if the "ready" event is received twice.
7. If the Gmail token is revoked or expired, the email is skipped, the owner sees a
   notice in the app to reconnect, and the email is sent once they do.
8. The email renders correctly in Gmail, Apple Mail and Outlook, in light and dark mode.

### FR-10 — Seeded with real meetings — P0

Acceptance criteria:
1. The seed data is five real research meetings from the **ICSI Meeting Corpus**,
   licensed **CC BY 4.0**, including one meeting of at least 60 minutes with eight
   distinct speakers. **No meeting, transcript, speaker or recording is invented.**
2. Seed meetings are audio only and are public to everyone, with or without a workspace.
   The ICSI audio is re-encoded to AAC (`.m4a`, about 16 MB per hour) with macOS's
   built-in `afconvert` by a small script under `tools/`, so no third-party tools are
   needed and each file stays under Supabase's 50 MB limit. The audio lives in private
   Supabase Storage and is served through server-signed URLs, so no bucket is public;
   signed-URL creation is rate-limited per workspace (NFR-08).
3. Speakers are labelled "Speaker A", "Speaker B", … in order of first appearance, since
   real names were never recorded. Nothing else is redacted.
4. The app credits the ICSI Meeting Corpus (attribution as required by CC BY 4.0) on
   every seed meeting page and on an "About the example meetings" page, which also lists
   every change we made to the originals (format conversion, trimming, speaker labelling,
   generated summaries, chapters and action items).
5. Seed data is loaded with a script into a fresh database so that a new environment is
   ready to demo without recording anything first. The script is idempotent.
6. The seed's README records the source, corpus meeting ID, date and licence of each
   recording.
7. The seeded meetings exercise every feature: summaries in all four templates, chapters
   and the who-spoke-when strip (FR-13), action items with and without owners and dates,
   decisions, at least three highlights, one shared clip and search results across
   several meetings. Seed meetings contain no commands, cards or memory.
8. The 60-minute, 8-speaker meeting is the benchmark for every performance criterion in
   this document.

### FR-11 — Accounts — P0

Acceptance criteria:
1. The only sign-in is **"Continue with Google"**. There is no password, email link or
   other provider.
2. Continuing with Google attaches the current guest workspace (FR-12) to that Google
   account. Nothing in the workspace is lost. Signing in on another device opens the same
   workspace.
3. If the Google account already has a workspace and the device has a guest workspace
   with content, the user is asked which to keep, or to merge the guest's meetings into
   the account's workspace. Nothing is deleted without that choice.
4. Each workspace is private. No user can see, search or share another workspace's
   meetings, recordings, transcripts, summaries, cards, memory or clips.
5. Seed meetings are visible to everyone; everything else requires a workspace.
6. Settings let the owner manage connections (FR-18), choose the Send bot default, set
   the summary-email preference, read and edit memory (FR-17), export their data and
   delete their account (NFR-03).

### FR-12 — No account needed: guest workspace — P0 — [AFK.ai addition]

A visitor can use AFK.ai without signing in. Their first action creates a private guest
workspace on that device.

Acceptance criteria:
1. The first action that produces something of the visitor's — sending the bot, pasting a
   link, ticking an action item on a seed meeting, typing a command, or editing memory —
   creates a guest workspace with no form or prompt. Browsing seed meetings does not.
2. A guest is a Supabase anonymous user. The guest workspace is bound to the device by
   that user's session cookie, which is unguessable, httpOnly and secure (NFR-07). It is
   not reachable from another device or browser until the guest continues with Google,
   which links the Google identity to the same user.
3. The guest sees a persistent, dismissable notice: "This workspace lives on this device.
   Continue with Google to keep it everywhere." It returns if the guest sends a bot or
   approves a card.
4. Everything in FR-01 to FR-10 and FR-13 to FR-24 works for a guest, except where a
   requirement says it needs a Google account (connections in FR-18 and therefore any
   card that sends; the summary email in FR-09).
5. A guest who never continues with Google is **deleted 30 days after their last
   activity**, with everything in NFR-03 criterion 5 applied to each of their meetings,
   including the Attendee deletion. "Activity" is any request made with the guest cookie.
6. Seven days before deletion, the guest sees a notice on the dashboard with the deletion
   date and a Continue with Google button. Since a guest has no email, no email is sent.
7. A deleted guest cookie opens a fresh, empty workspace on the next visit, with the same
   notice as in criterion 3.
8. Guest quotas are lower than account quotas (NFR-08), because sending a bot costs
   money and a guest is anonymous.

### FR-13 — Easier navigation of a long meeting — P1 — [AFK.ai addition]

Acceptance criteria:
1. **Chapters.** When the transcript is ready, the meeting is split into chapters, each
   with a short title, a start moment and an end moment. Chapters cover the whole
   recording without gaps or overlaps. A 60-minute meeting gets between 4 and 12
   chapters. Chapter titles are grounded: each is checkable against its range, and a
   spot check of every chapter on the seeded 8-speaker meeting finds no title the range
   doesn't support. Chapters are shown as a list and as sections on the timeline;
   clicking one seeks to its start. The owner can rename, merge or split chapters.
2. **Who-spoke-when strip.** Under the timeline, one row per speaker shows when they
   spoke. Hovering a block shows the speaker and time; clicking seeks there. On the
   seeded 8-speaker meeting the strip renders in under 200 ms and is readable at 375 px
   (rows collapse to a single colour-coded strip with a legend).
3. **Speaker filter.** The owner can pick one or more speakers; the transcript shows only
   their segments (with a count), the timeline dims everyone else, and playback with
   "skip others" on jumps over filtered-out segments. Clearing the filter restores the
   full transcript at the same position.
4. **Find in the meeting.** A find box searches the current transcript as the user types,
   shows "3 of 17", marks every match on the timeline, and steps between matches with
   Enter and Shift+Enter (and buttons). Selecting a match seeks the player to it. Matches
   are case-insensitive, and the search runs client-side in under 50 ms per keystroke on
   the seeded 8-speaker meeting.
5. All four work on seed meetings and in the PIN-shared view (FR-21), and are keyboard
   accessible (NFR-02).

### FR-14 — Spoken and typed commands from the sender — P0 — [AFK.ai addition]

During the call, the sender can talk to AFK.ai. After the call, the same commands can be
typed. Nobody else on the call can give commands.

Acceptance criteria:
1. A command is an utterance starting with "AFK" (also recognised: "A-F-K", "Hey AFK",
   "AFK,"), spoken by the sender. The following commands are supported:
   - **"AFK, task for Sam, …"** — creates an action item with the named owner and any
     date said (FR-05).
   - **"AFK, decision: …"** — creates a decision (FR-05).
   - **"AFK, note: …"** — creates a note attached to the meeting at that moment.
   - **"AFK, highlight that"** — creates a highlight (FR-06 criterion 5).
   - **"AFK, remember …"** — adds an entry to memory (FR-17), marked as told by the
     owner.
   - **"AFK, draft an email to … about …"** — creates an email card (FR-15).
   - **"AFK, schedule a follow-up …"** — creates a calendar-invite card (FR-15).
   - **"AFK, remind me …"** — creates a reminder card (FR-15).
   - **"AFK, tell the team on Slack …"** — creates a Slack-post card (FR-15).
2. **Only the sender can command.** The sender is identified on the call by matching the
   meeting platform's participant name to the owner's profile name (or to the name the
   owner chose when sending the bot). Commands spoken by any other participant are
   ignored; nothing is created and nothing is acknowledged. If no participant matches the
   sender, spoken commands are off for that meeting, the live meeting page says so, and
   typed commands still work. The sender is never identified by voice.
3. **Capture commands apply at once.** Tasks, decisions, notes and highlights appear on
   the live meeting page within 10 seconds of being spoken, and in the transcript marked
   as commands (FR-03 criterion 11).
4. **Draft commands create cards, not sends.** Each draft command produces a card within
   60 seconds, filled from what was said, the transcript so far and memory (FR-17).
   Nothing is sent until the owner approves (FR-15).
5. **Acknowledgement.** The sender sees each command acknowledged on the live meeting
   page ("Task for Sam added"). Nothing is posted in the meeting chat for commands (chat
   is used only for answers, FR-16).
6. A command that AFK.ai cannot understand is recorded as a note with the text "Couldn't
   run this command" so nothing said is lost, and the owner can turn it into the right
   thing afterwards.
7. **Typed commands.** The meeting page has a command box that accepts the same commands
   without the "AFK" prefix, during or after the call, and gives the same results.
   Typed commands are shown in the meeting's activity, not in the transcript.
8. Commands are English only in this release. Command text is treated as untrusted
   input (NFR-04); a command cannot read or change anything outside the owner's own
   workspace.
9. Every command is logged in the meeting's activity with who gave it, how (spoken or
   typed), when, and what it produced, so the owner can undo it.
10. Commands are detected with a cheap keyword match on the live transcript before any
    model is called (NFR-09).

### FR-15 — Nothing leaves without approval: cards — P0 — [AFK.ai addition]

Acceptance criteria:
1. Every outbound action — email, calendar invite, reminder, Slack post, and "Share the
   notes" (FR-20) — is a **card** with a state: `waiting → approved → sent | failed`, or
   `dismissed`. Nothing is sent from a card that is not approved.
2. A card shows: the type, what will happen in one sentence ("Email to Sam Lee and Priya
   N."), the full content, every recipient or channel with the **reason it was chosen**
   (FR-18 criterion 5), when it will happen (for invites and reminders), which account
   will send it, and a link to the moment that created it.
3. **Approve once, run at most once.** Approval is a single click. The action runs within
   60 seconds and is idempotent: a retry, a double click or a repeated job never sends
   twice. A failed send shows why and offers a retry, still with at most one successful
   delivery.
4. **Send back with a note.** The owner can return a draft with a note ("shorter, and
   mention the deadline"). A rewritten version replaces the draft within 30 seconds and
   the previous versions stay viewable. Up to 5 rewrites per card (NFR-08).
5. The owner can edit any field directly (text, recipients, time, channel) before
   approving. A card with an empty required field (no recipient, no channel, no time for
   an invite) cannot be approved until the owner fills it.
6. Cards appear in three places: on the meeting page they came from, on the dashboard
   ("3 waiting for approval"), and on a **Tasks** page listing every card in the
   workspace with filters by state and type. Changes in one place show in all three.
7. Cards whose connection is missing (no Gmail, no Slack) show "Connect Gmail to send
   this" with a button, and stay waiting.
8. Sent cards keep a record of what was sent, to whom, when, and the provider's message
   ID. Dismissed cards are kept for 30 days in a "Dismissed" filter, then deleted.
9. **Reminder cards** send an email from the owner's Gmail to the owner at the time
   said, or at 9:00 the next morning in the owner's time zone if no time was said. The
   time is shown on the card and can be changed.
10. **Calendar-invite cards** create a Google Calendar event on the owner's calendar with
    the attendees named (addresses from memory, with reasons), the time if said, otherwise
    a proposed slot the owner must confirm. Attendees are emailed by Google Calendar only
    when the card is approved.
11. **Slack-post cards** post as the owner to the channel named, or to the channel memory
    knows as "the team"; if none is known, the card asks for a channel and remembers the
    choice for next time (FR-17).
12. Seed meetings never produce cards.

### FR-16 — Answers during the call — P1 — [AFK.ai addition]

Acceptance criteria:
1. The sender can ask, out loud, "AFK, what did we decide about pricing?", "AFK, recap",
   "AFK, what's left?", or any question starting with "AFK" that is not a command
   (FR-14). Only the sender is answered (same identification as FR-14 criterion 2).
2. The answer is posted by the bot **in the meeting chat** within 15 seconds, visible to
   everyone on the call, and also shown on the live meeting page. The sender knows this
   from the consent text (FR-01 criterion 4) and a note on the live meeting page.
3. Answers use only **this meeting's transcript so far** — not memory, not other
   meetings — and are at most 600 characters.
4. Every answer cites the moment: a timestamp like "[00:23:14]" after each claim, which
   on the meeting page is a link to that moment.
5. If the topic wasn't discussed, the answer is "That hasn't come up in this meeting so
   far." with nothing added. A spot check of 20 questions on a recorded call finds no
   answer that the cited segments don't support.
6. "AFK, recap" returns the chapters so far (FR-13) in one line each, with timestamps.
7. Questions are logged in the meeting's activity with their answers, and are kept after
   the call (unlike Fathom, [research §7](research.md#7-search-and-ask-fathom)).
8. Up to 20 questions per meeting (NFR-08); past that, the chat reply says the limit was
   reached.

### FR-17 — A memory the user can read, edit, download and erase — P0 — [AFK.ai addition]

Acceptance criteria:
1. Memory has five sections: **Profile** (name, role, company, time zone, signature),
   **People** (name, email, Slack handle, role, relationship, how they're referred to),
   **Projects** (name, aliases, what it is, who's on it), **Words** (terms, product
   names, spellings, acronyms), and **How I like things written** (tone and conventions
   for emails, invites and Slack posts, each with an example).
2. **Every entry has a source.** A source is one of: told by the owner (typed or "AFK,
   remember …"), a quote from a meeting with a link to its moment ("learned from *Pricing
   sync*, 12 Oct, 00:14:02: 'Sam owns the pricing page'"), or a connected account (a
   calendar invite or Slack directory, named). An entry with no source cannot exist.
   **AFK.ai never invents an entry.**
3. After each meeting, AFK.ai proposes new entries from what was said. Proposals appear
   on the wrap-up (FR-20) and in memory marked **New**, each with its quote. The owner
   can accept, edit or discard. New proposals are not used in drafts until accepted,
   except Words, which are used at once to spell things right and can be undone.
4. The owner can read every entry, edit it inline, delete it, delete a whole section, or
   **erase all memory** with one confirmed action. Deleted entries are gone from every
   prompt and cache (NFR-06).
5. **Download** exports all memory as JSON and as Markdown, including sources.
6. Memory is used in: summaries (spelling), drafts (recipients, tone, signature,
   conventions), Slack channel choice, and command interpretation ("Sam" → Sam Lee). The
   wrap-up and each card say which entries were used.
7. Memory is per workspace and is never shared, included in clips, PIN shares, "Share the
   notes" emails, or used for another workspace (NFR-06).
8. Memory holds at most 2,000 entries (NFR-08); the page says so when near the limit.

### FR-18 — Gmail, Google Calendar and Slack connections — P0 (Slack P1) — [AFK.ai addition]

Acceptance criteria:
1. Settings show three connections — **Gmail** (send), **Google Calendar** (read events,
   create events), **Slack** (post as the user) — each with Connect, Disconnect, the
   account connected, and the exact permissions requested in plain words.
2. Connections need a Google account (FR-11); a guest is asked to Continue with Google
   first. Gmail and Calendar use that same Google account with incremental scopes;
   Slack connects with Slack OAuth as the user (not a bot token).
3. **Approved drafts send from the user's own accounts**: emails from their Gmail,
   invites from their Google Calendar, Slack posts as them. AFK.ai never sends from its
   own address or as a Slack bot.
4. Disconnecting revokes the token with the provider, deletes it (NFR-07), and leaves
   waiting cards in place with "Connect … to send this".
5. **Addresses are never filled in silently.** Recipient emails, Slack handles and
   channels come only from memory (FR-17), and each is shown on the card with its reason
   ("sam@acme.com — from the invite to *Pricing sync*, 12 Oct"). If memory has nothing,
   the field is empty and the card asks the owner. If memory has two candidates, both are
   shown and the owner picks.
6. A connection that stops working (token revoked, scope removed) shows a reconnect
   notice in settings and on affected cards, and no card fails silently.
7. Connection state is shown on the first-run checklist (FR-23).
8. The Google OAuth client is kept in **Testing mode**, not published. Testing allows up
   to 100 test users, and Google tokens expire after seven days, so each Google
   connection shows **"reconnect by <date>"** (seven days after connecting) and turns to
   "reconnect now" when due; affected cards say "Reconnect Gmail to send this". The
   landing page collects Gmail addresses to add as test users (FR-25).

### FR-19 — Join from the calendar — P1 — [AFK.ai addition]

Acceptance criteria:
1. With Google Calendar connected, the dashboard shows **this week's meetings** that have
   a Zoom, Meet or Teams link, grouped by day, with title, time, attendees count and
   whether AFK.ai will join. Meetings without a link are not shown.
2. Each meeting has **Send AFK** to schedule the bot ahead of time, and the dashboard has
   a switch **Join every meeting** (the FR-01 default set to all). Turning it off leaves
   meetings already scheduled as they are and says so.
3. A meeting switched on shows "AFK will join at 10:00"; the bot joins per FR-01
   criterion 5. The consent text (FR-01 criterion 4) is shown on first use.
4. Calendar changes are reflected within 5 minutes: a moved meeting moves the bot, a
   cancelled meeting cancels the bot, a new link is picked up.
5. Without a calendar connected, the week view shows one card: "Connect Google Calendar
   to see your week" plus the paste-a-link form.
6. Meetings in the past week with a recording link to their meeting page; those with no
   recording are shown dimmed with "Not recorded".

### FR-20 — A wrap-up after each meeting — P1 — [AFK.ai addition]

Acceptance criteria:
1. When a meeting becomes *ready*, a **wrap-up** appears at the top of its meeting page
   and on the dashboard until dismissed. It shows: the Catch me up summary, the cards
   waiting for approval with Approve and Send back on each, proposed memory entries
   (FR-17 criterion 3), and **"How was the meeting?"**.
2. "How was the meeting?" is a 1–5 rating with an optional note. Rating is optional and
   takes one click. Ratings are stored per meeting and shown on the meetings list; they
   are used for nothing else in this release.
3. **Reminder for waiting cards.** If a card has waited more than 24 hours, the owner
   gets one reminder: a dashboard notice, and an email from their Gmail if connected.
   One reminder per card, never more.
4. **"Share the notes"** is one card that emails the Catch me up summary, decisions and
   action items (with owners and dates where said) to everyone on the call, from the
   owner's Gmail, after one approval. Recipients are the call's attendees from the
   calendar invite or participant list, each with its reason shown; attendees without a
   known address are listed as "no address" and the owner can add one. The email contains
   the notes only — no link into the owner's workspace and nothing from memory.
5. The wrap-up for a failed meeting shows what failed and the retry.
6. Dismissing a wrap-up hides it; the meeting page keeps everything in it.

### FR-21 — Share a whole meeting behind a PIN — P1 — [AFK.ai addition]

Acceptance criteria:
1. The owner can create a **private link** to a meeting protected by a **four-digit PIN**
   that the owner sets or has generated. The owner shares the link and PIN separately.
2. A viewer with the link and PIN sees: the recording (played through server-fetched
   Attendee links, FR-03 criterion 2), the transcript with FR-13 navigation, and the
   Catch me up summary. **Nothing else of the owner's**: no action items, notes, cards,
   memory, highlights, other meetings, or the owner's name. No download button.
3. A viewer needs no account. Entering the PIN once keeps access on that device for 30
   days (httpOnly cookie, NFR-07).
4. Five wrong PINs lock that link for 15 minutes; after 20 wrong PINs in a day the link
   is disabled and the owner is told. Attempts are rate-limited per IP as well.
5. The owner can change the PIN, see when the link was last opened, and **revoke** the
   link at any time; revocation takes effect immediately, including for devices that
   entered the PIN. A revoked link shows "This meeting is no longer shared".
6. One link per meeting at a time; creating a new one revokes the old one.
7. PIN shares work for seed meetings too (no PIN needed, since they're public), and the
   PIN page meets NFR-02 and works on a phone.

### FR-22 — Urdu and Hindi transcribed in Roman Urdu — P1 — [AFK.ai addition]

Acceptance criteria:
1. Speech in Urdu or Hindi is transcribed in **Roman Urdu** (Urdu/Hindi words in Latin
   script, e.g. "kal meeting hai"), with the speaker and moments like any segment.
2. English words inside an Urdu or Hindi sentence stay in English spelling; a sentence
   that is entirely English is transcribed as English.
3. Summaries, chapters, action items, decisions, notes, answers and drafts are **in
   English**, translating what was said. Quotes shown as sources (FR-17) keep the Roman
   Urdu text.
4. Search (FR-08) and find in the meeting (FR-13) match Roman Urdu text, and match common
   spelling variants ("nahi"/"nahin", "hai"/"hain") case-insensitively.
5. Accuracy: on a real mixed Urdu and English call run by the owner once the bot works,
   at least 90 % of Urdu words are rendered recognisably in Roman Urdu, and no Urdu
   passage is rendered in Devanagari or Nastaliq script.
6. Commands (FR-14) and questions (FR-16) remain English only in this release.
7. Bots use Deepgram's multilingual mode when the Summon form's language is "English and
   Urdu" and Deepgram is on (FR-01.14). Any segment that still arrives in Devanagari or
   Arabic script goes through the Claude transliteration step before anything else uses
   it.

### FR-23 — First-run checklist — P1 — [AFK.ai addition]

Acceptance criteria:
1. A new workspace's dashboard shows a checklist: *Send AFK to a meeting (or open an
   example)*, *Continue with Google*, *Connect Google Calendar*, *Connect Gmail*,
   *Connect Slack*, *Tell AFK about yourself* (fills the memory Profile), *Approve your
   first card*.
2. Each step links to where it's done and disappears on its own as soon as it is done,
   including when done from elsewhere in the app. Steps show "3 of 7 done".
3. When every step is done, the checklist is gone and never returns. The owner can also
   dismiss it early; it doesn't come back.
4. The checklist is per workspace and survives Continue with Google (with the "Continue
   with Google" step then ticked).

### FR-24 — A light game layer — P2 — [AFK.ai addition]

Acceptance criteria:
1. **Levels.** The workspace has a level computed from real activity: meetings that
   reached *ready*, approved cards, commands used, memory entries accepted. The level
   and what unlocks the next one are shown on the **Player card**, which is reached from
   one line under the Quest log's list — not from the sidebar.
2. **Weekly streak.** A streak counts consecutive weeks (Monday to Sunday, owner's time
   zone) with at least one meeting that reached *ready*. The current and best streak are
   shown.
3. **Badges.** At least eight, for example: *First meeting*, *First command*, *First
   approval*, *Eight voices* (a meeting with 8+ speakers), *Marathon* (a meeting over 60
   minutes), *Ten meetings*, *Clean desk* (no cards waiting for 7 days), *Four-week
   streak*. Each shows the meeting or action that earned it, with a link.
4. **Counted from real meetings only.** Seed meetings, failed meetings, deleted meetings
   and test data never count. Deleting a meeting recomputes everything.
5. Nothing is competitive or social: no leaderboard, no sharing, nothing visible to
   anyone else. There are no notifications beyond a line in the wrap-up (FR-20).
6. The panel can be hidden in settings with one switch.

### FR-25 — Landing page and test-user request — P0 — [AFK.ai addition]

Acceptance criteria:
1. The landing page opens with a full-screen hero: a twelve-second video whose playhead
   is the visitor's scroll (scrolling forward plays it, scrolling back rewinds it), the
   chair mark, one line, and two buttons (Try the Tutorial, Summon AFK). Visitors who
   prefer reduced motion get the poster and a play button.
2. The poster image is the page's largest contentful element and paints first; the
   video loads afterwards, muted and inline. The page meets NFR-01.1 with the video.
3. Below the hero, a "How it works" timeline of four steps, each pinned as the video
   reaches it, then the five Tutorial meetings, then a footer with Privacy and the ICSI
   credit.
4. A form takes one Gmail address with a consent line so the owner can add the visitor
   as a Google test user (FR-18.8). It stores the address once (unique), nothing else,
   and confirms in plain words. Addresses are visible only to the owner and are deleted
   on request.
5. Placeholder video and mark until the owner supplies the final assets.

---

## Non-functional requirements

### NFR-01 — Speed — P0

1. Meetings list: first contentful paint under 1.5 s on a mid-range laptop over a
   typical home connection; Largest Contentful Paint under 2.5 s.
2. Meeting page for the 60-minute, 8-speaker meeting: usable (player and transcript
   visible) under 2 s; playback starts under 1 s after pressing play; seeking from a
   transcript click responds within 200 ms.
3. Attendee playback links are renewed before their expiry (read from the signed URL, see
   FR-03 criterion 2) with no pause,
   buffering restart or position loss visible to the user.
4. Transcript rendering handles 2,000+ segments without jank (virtualised if needed);
   scrolling stays at 60 fps. Chapters, the who-spoke-when strip and find (FR-13) meet
   the timings in that requirement.
5. A meeting is *ready* within 10 minutes of a 60-minute call ending (FR-01). Summary
   generation with a different template completes in under 30 seconds and streams as it
   generates.
6. Search returns in under 1 s (FR-08).
7. Live: capture commands apply within 10 s and answers post within 15 s (FR-14, FR-16),
   measured from the end of the utterance.
8. Nothing long-running happens inside one web request; bots, transcription, commands,
   summaries and card sends are driven by webhooks and background jobs with stored state.

### NFR-02 — Accessibility — P0

1. WCAG 2.2 AA across the app, the seed meeting pages, the clip page and the PIN page.
2. Every feature is usable with the keyboard alone, with a visible focus ring, including
   the player, transcript navigation, chapters, the speaker strip, find, cards and
   checkboxes.
3. The player has accessible controls and exposes the transcript as captions or an
   equivalent text track.
4. Colour is never the only way information is conveyed (speaker identity, meeting state,
   card state, done/undone). Contrast meets AA in light and dark mode.
5. Async changes (bot state, command acknowledged, summary generated, card sent, item
   ticked) are announced to screen readers via live regions.
6. Works at 375 px wide and at 200 % zoom with no horizontal scrolling.
7. Automated checks (axe) run in CI with zero serious or critical violations, and one
   manual screen-reader pass (VoiceOver) per release on the meeting page and the Tasks
   page.

### NFR-03 — Privacy — P0

1. Recordings and transcripts are private to the workspace. Nothing is shared unless the
   owner explicitly creates a clip link (FR-07), a PIN link (FR-21) or approves a "Share
   the notes" card (FR-20). A clip of a private meeting shares the transcript excerpt
   only.
2. The bot joins as "AFK.ai Notetaker" so everyone on the call can see it, and the send
   form carries the consent text in FR-01 criterion 4. Where the platform allows, the bot
   posts a short recording notice in the meeting chat when it joins. Answers (FR-16) are
   posted in the chat and are therefore visible to everyone on the call.
3. Meeting content and memory are never used to train models — not by AFK.ai, not by
   Attendee and not by the AI provider. This is stated in the privacy policy and enforced
   by provider settings.
4. Transcript contents, command text, card content and memory never appear in logs,
   error reports or analytics.
5. Meetings are kept until the owner deletes them (or the guest expires, FR-12). Deleting
   a meeting removes the transcript, summaries, chapters, action items, notes, highlights,
   clips, PIN links, cards that haven't been sent, activity log and search index entries,
   **tells Attendee to delete the recording and transcript**, and makes every share link
   stop working immediately. The Attendee deletion is confirmed and retried until it
   succeeds. Memory entries learned from the meeting are kept but lose their link, and
   the owner is told how many.
6. The owner can export all their data (transcripts, summaries, action items, notes,
   cards, memory) and delete their account, which deletes every meeting as in criterion
   5, erases memory, and revokes the Google and Slack tokens.
7. OAuth scopes are the minimum needed: profile for sign-in, calendar read and event
   create for FR-01/FR-19/FR-15, Gmail send-only for FR-09/FR-15/FR-20, Slack
   chat:write as the user for FR-15. Tokens are handled per NFR-07.
8. Seed meetings are public by design and carry the CC BY 4.0 credit (FR-10).
9. People in memory are third parties. AFK.ai stores about them only what was said in the
   owner's meetings, what the owner typed, or what a connected account shows (an invite
   attendee list, a Slack directory), and shows the source (NFR-06).

### NFR-04 — Security — P0

1. Authentication (a Google session or a guest cookie) is checked on the server for
   every page, server action and route handler. Authorization is checked against the
   workspace, never trusted from the client. Seed meetings are the only resources
   readable without a workspace, and they are read-only for visitors.
2. Row-level security is enabled on every table with policies scoped to the workspace,
   and a test proves workspace A cannot read or write workspace B's rows, including
   cards, memory and activity.
3. Recordings are served only through Attendee's short-lived links, requested by the
   server for the owner or a PIN viewer with a valid PIN cookie. Seed audio is in a
   private Supabase Storage bucket served through server-signed URLs; no bucket is
   public. Clip pages expose only the clip's own range and
   transcript excerpt.
4. Every webhook (Attendee, Google, Slack) is verified by signature before it is parsed,
   and duplicate deliveries are safe.
5. Secrets (Attendee, Anthropic, Google OAuth client secret, Slack client secret,
   database service role, webhook secrets, token-encryption key) exist only on the
   server; none is exposed to the client bundle.
6. All input is validated on the server with a schema, including LLM output (summaries,
   chapters, commands, drafts, memory proposals) before it is stored, shown or acted on.
7. Transcripts, command text and memory entries are untrusted input to prompts (FR-04
   criterion 7). A command or transcript line cannot cause a send, a deletion, or access
   to anything outside the owner's workspace; the only path to a send is an approved
   card.
8. Endpoints that cost money (bot launch, summary generation, commands, answers, card
   sends) have per-workspace rate limits and quotas (NFR-08).
9. Dependencies are scanned for known vulnerabilities in CI; no untrusted code or hooks
   run during install or build.

### NFR-05 — Cost — P1

1. Every service runs on a free tier. Fixed cost is **US$0 per month**. The variable
   costs are Claude (summaries, chapters, action items, decisions, one-line summaries,
   commands, answers, drafts, memory proposals), Attendee after its five free bot hours
   (**US$0.50 per bot hour**), and transcription after Deepgram's free credit (NFR-09.6).
   *Decision pending:* US$0 fixed holds only on Vercel's Hobby plan, which is restricted
   to non-commercial use. If AFK.ai is commercial, hosting is Vercel Pro at US$20 per
   month. This must be decided before a public launch.
2. Ceiling: **US$1.00 per 60-minute meeting**, all variable costs included, with the
   additions (NFR-09). Reference point: the first real call (2 min 44 s) cost about
   US$0.066 in Claude usage before the additions.
3. The Anthropic API key has a spending limit set in the Anthropic console, and the app
   records Claude token usage and cost per request, per meeting and per workspace,
   visible in an internal admin view alongside Attendee bot hours.
4. Summaries use the cheapest model that meets FR-04's grounding criterion; the model is
   configurable without a deploy. Long, stable prompt prefixes use prompt caching.
5. Summaries for each template are generated on demand and cached; the same template is
   never generated twice for an unchanged transcript. Seed summaries and chapters are
   generated once at seed time (FR-04 criterion 8).
6. Recordings stay in Attendee's storage and cost AFK.ai nothing to store. Seed audio is
   the only media AFK.ai stores.
7. Per-workspace quotas protect the budget (NFR-08), each adjustable without a deploy,
   with a clear message when reached.

### NFR-06 — Privacy of memory — P0 — [AFK.ai addition]

1. Memory belongs to one workspace. It is never read for another workspace, never
   included in anything shared (clips, PIN views, "Share the notes", answers in chat), and
   never used to improve any model.
2. Memory is put into a prompt only for the owner's own meetings and cards, and only the
   sections the task needs (spelling needs Words; an email needs People, Profile and
   writing preferences). Each use is recorded so the wrap-up and cards can say which
   entries were used (FR-17 criterion 6).
3. Every entry carries its source, and an entry with no source is rejected on write.
   Proposed entries are shown to the owner before they influence drafts (FR-17 criterion
   3).
4. Deleting an entry or erasing memory takes effect on the next prompt immediately, and
   any cached prompt prefix containing it is invalidated within 24 hours.
5. Memory is exportable in full (FR-17 criterion 5) and is deleted with the workspace
   (account deletion, NFR-03; guest expiry, FR-12).
6. Memory about other people is limited to what NFR-03 criterion 9 allows. If a person
   asks the owner to be forgotten, deleting their People entry removes them from every
   draft default from then on.
7. Memory is stored encrypted at rest and never logged (NFR-03 criterion 4).

### NFR-07 — Token safety — P0 — [AFK.ai addition]

1. Google and Slack OAuth tokens are stored encrypted at rest with a key held outside
   the database (an environment secret), decrypted only on the server at the moment of
   use, and never written to logs, error reports, the client bundle or responses.
2. Refresh tokens are used only by server jobs. A token that fails to refresh is marked
   broken and the owner is asked to reconnect (FR-18 criterion 6); AFK.ai never retries
   indefinitely.
3. Disconnecting a connection or deleting the account revokes the token with the
   provider and deletes it locally in the same operation.
4. A token is used only to execute a card the owner approved (FR-15), to read the
   calendar (FR-01, FR-19) or to send the owner's own summary email (FR-09). A test
   proves that no code path sends through a token without an approved card or one of
   those two reads.
5. Scopes are the minimum in NFR-03 criterion 7; adding a scope requires a new consent.
6. The guest session cookie (FR-12, a Supabase anonymous-user session set httpOnly
   through `@supabase/ssr`) and the PIN cookie (FR-21) are at least 128 bits of
   randomness, httpOnly, Secure, SameSite=Lax, and are rotated on Continue with Google.
   Guest sessions are invalidated on deletion; PIN cookies are invalidated on revocation.
   If browser Realtime needs the session, the page gets a short-lived token from a Server
   Component or polls; the session cookie is never made readable by scripts.
7. Share links (FR-07, FR-21) and card approval requests are unguessable and
   single-purpose; approving a card requires the workspace's own session, never a link
   alone.
8. Webhook secrets and signing keys are rotated without downtime, with two keys valid
   during a rotation.

### NFR-08 — Limits — P0 — [AFK.ai addition]

All limits are per workspace, adjustable without a deploy, enforced on the server, and
shown to the user with a plain message when reached. Defaults:

| Limit | Guest | Google account |
|---|---|---|
| Bot hours per month | 2 in total, ever | 20 |
| Bots running at once | 1 | 3 |
| Spoken or typed commands per meeting | 50 | 50 |
| Live questions per meeting (FR-16) | 20 | 20 |
| Rewrites per card (FR-15) | 5 | 5 |
| Cards waiting at once | 25 | 100 |
| Card sends per day | 0 (needs Google) | 50 emails, 20 invites, 50 Slack posts |
| Memory entries | 500 | 2,000 |
| Summary generations per meeting per day | 8 | 8 |
| PIN attempts | 5 per 15 min per link; 20 per day disables (FR-21) | same |
| API requests per minute (any endpoint) | 60 | 120 |

1. A guest who reaches the bot-hour limit is asked to Continue with Google; a Google
   account that reaches a limit sees the limit and the reset date.
2. Paid actions (bot launch, generation, sends) check the limit atomically so concurrent
   requests cannot exceed it.
3. Limits are logged when hit, without content, so abuse can be spotted.

### NFR-09 — Cost of the additions — P1 — [AFK.ai addition]

1. The **US$1.00 per 60-minute meeting** ceiling (NFR-05) includes transcription,
   commands, answers, chapters, drafts and memory proposals. Budget guide per 60-minute
   meeting: Attendee bot US$0.50; transcription US$0 during Deepgram's free credit, then
   about US$0.35; Claude under US$0.40 in total for summaries, chapters, action items,
   memory proposals and up to 10 commands and 5 answers; everything else under US$0.10.
   *Decided (decision 17):* keep Sonnet for every call, with captions as the default
   transcription because they are free. The Claude estimate is US$0.45–0.57 and the
   all-in figure after free credits is US$0.95–1.07 with captions or US$1.30–1.42 with
   Deepgram ([docs/architecture.md](architecture.md)). The first real two-minute call
   cost about seven cents. The ceiling stays and is revisited with real cost data once
   the bot works.
2. Command detection is a keyword match on the live transcript (FR-14 criterion 10); a
   model is called only for utterances that start with "AFK".
3. Every call uses Claude Sonnet with a JSON schema and no tools (decision 16). The model
   ID comes from the `CLAUDE_MODEL` environment variable, so switching to Haiku later
   needs no code change (decision 17).
4. Live answers (FR-16) send only the transcript so far, and the stable part of the
   prompt (instructions and the transcript already sent) uses prompt caching.
5. Memory in prompts is limited to the sections needed (NFR-06 criterion 2) and to 4,000
   tokens; the largest entries are summarised rather than dropped.
6. Transcription is **not** included in Attendee's bot hour. **Platform captions are the
   default** because they are free. Deepgram is switched on by the
   `TRANSCRIPTION_PROVIDER` environment variable and is used for calls in English and
   Urdu on our own key: US$0 while Deepgram's US$200 credit lasts (about 570 hours), then
   about US$0.35 per hour. The cost is recorded per meeting. Roman Urdu (FR-22) adds a
   Claude transliteration pass for any non-Latin segment, at most about US$0.26 per
   fully-Urdu hour with Sonnet.
7. Cost per workspace per month is tracked, and a workspace whose cost exceeds US$20 in
   a month is flagged in the admin view. Guest cost is bounded by the 2-bot-hour limit
   (NFR-08).

---

## Decisions

Recorded 2026-10-16 from the product owner's answers to the v1 open questions. Rows
marked *amended* were changed by the AFK.ai additions in v3.

| # | Decision |
|---|---|
| 1 | Seed data: five real ICSI Meeting Corpus meetings, CC BY 4.0, one of 60 min with eight speakers. Speakers labelled "Speaker A", "Speaker B", … in order of first appearance. Credit the corpus in the app and list our changes. Nothing else to redact. |
| 2 | *Amended by FR-11/FR-12:* many users, each with a private workspace. No account is needed; a guest gets a workspace on their first action, and "Continue with Google" (the only sign-in) keeps it on every device. Guests are deleted after 30 days. Seed meetings are public to everyone. |
| 3 | Google Calendar only. |
| 4 | Bot provider: Attendee. Five free bot hours, then $0.50/hour. The bot leaves on its own after 5 min in a waiting room, 10 min of silence, or 3 hours. |
| 5 | The bot records whether or not the sender is on the call. It joins as "AFK.ai Notetaker" with no camera image. The send form shows the consent text in FR-01 criterion 4. |
| 6 | Four templates: Catch me up, General, Project update, Brief. No custom templates. |
| 7 | The bot records video (MP4, speaker view, 720p) kept in Attendee's storage and played through short-lived links the page renews. *Amended by decision 16:* the links were assumed to last 30 minutes; Attendee documents them only as "short-lived", so the page reads the expiry from the URL. Seed meetings are audio only. |
| 8 | Speaker names come from the platform's participant names. Drop-and-rejoin is merged automatically; duplicate names are numbered ("Sam (2)"). No manual confirm or merge. |
| 9 | Summary email to the owner only, from their own Gmail once connected. A profile setting turns it off. |
| 10 | Clips: no expiry, revocable at any time, no download. Viewer sees the clip, transcript excerpt, meeting title and date, and only the speakers heard. Owner's name hidden. Private-meeting clips share transcript only; seed clips play the public audio limited to the range. |
| 11 | Retention: until the owner deletes the meeting. Deletion also tells Attendee to delete the recording and transcript. |
| 12 | $0/month fixed. Claude costs cents per meeting (2:44 call ≈ $0.066). Spending limit on the API key. $1.00 per hour-long meeting is the ceiling, now including the additions (NFR-09). |
| 13 | *Amended by FR-22:* English, plus Urdu or Hindi speech transcribed in Roman Urdu. Notes stay in English. |
| 14 | *Amended by FR-14/FR-16:* during the call, AFK.ai takes the sender's commands and answers the sender's questions in the chat. Everything else is after the call. |
| 15 | AFK.ai additions (v3): guest workspaces, long-meeting navigation, spoken and typed commands, approval cards, live answers, memory, Gmail/Calendar/Slack connections, join from the calendar, wrap-up, PIN share, Roman Urdu, first-run checklist, game layer. |
| 16 | Stack (v5, see [docs/architecture.md](architecture.md)): Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, shadcn/ui. Supabase: Postgres with RLS on every table, anonymous sign-in for guests, Google sign-in, private Storage for audio. Vercel with a daily cron that keeps Supabase from pausing. Attendee, recording video, transcribing with Deepgram or the platform's captions as fallback. Claude Sonnet, every call with no tools and a JSON schema, the transcript treated as data, every output checked against the transcript before it is stored. No worker and no queue: jobs in a Postgres table with leases, run by the app's own functions after a response, with a kick route that chains a new function. Zod at every boundary. Vitest, PGlite running the real migrations, Playwright with an accessibility scan. State changes in SQL functions; signed, idempotent webhooks; secrets only in env; logs with ids and counts; rate limits in the database; sends at most once. Rejected: a separate worker or container (a service to run and pay for), a queue service (Postgres leases are enough), any paid tier (nothing beyond Claude). Amends decision 7 (link lifetime is "short-lived", not confirmed 30 min) and decision 12 (transcription is a separate cost; Sonnet-only cost is open question 1 in the architecture). |
| 17 | Build plan answers (v6, see [docs/plan.md](plan.md)): Sonnet for every call from `CLAUDE_MODEL`; captions the default transcription, Deepgram by `TRANSCRIPTION_PROVIDER` for English and Urdu; Attendee and Deepgram usage costs accepted; Vercel Hobby non-commercial for the build and demo, decided again before any public launch; one Supabase project and one Vercel project; placeholder chair SVG, final icons, favicon and social image from one SVG; the landing hero is a twelve-second video scrubbed by scroll with a play button under reduced motion; Roman Urdu committed with a language choice on the Summon form; the Player card reached from one line under the Quest log, not the sidebar; Google OAuth kept in Testing mode with "reconnect by" dates and a test-user form on the landing page; ICSI audio re-encoded to AAC with `afconvert` under `tools/`; `.agent-logs/` committed with every commit. |

## Open questions

- **Q15 — Identifying the sender on the call.** FR-14 matches the platform participant
  name to the owner's profile name. What should happen when the owner joins under a
  different name, by phone, or from a shared room device? Proposed: the send form lets the
  owner type the name they'll appear as, and a mismatch turns spoken commands off with a
  notice.
- **Q16 — Where answers go.** FR-16 posts answers in the meeting chat, visible to
  everyone, as asked. Should there be an option to answer only on the sender's live
  meeting page instead, for calls with clients?
- **Q17 — "Remind me" delivery.** Proposed: an email from the owner's Gmail to
  themselves at the time said, or 9:00 next morning. Alternatives are a calendar event or
  a dashboard-only reminder.
- **Q18 — "The team" on Slack.** Proposed: a channel learned once and remembered, with
  the card asking the first time. Confirm, and whether DMs to a person ("tell Sam on
  Slack") are in scope.
- **Q19 — Guest bot allowance.** Proposed 2 bot hours in total before Continue with
  Google, one bot at a time (NFR-08). Is that enough to try the product, and is the cost
  exposure (about $1 per guest after the free Attendee hours) acceptable?
- **Q20 — Roman Urdu transcription.** Attendee's transcription provider may output Urdu
  in Nastaliq or Hindi in Devanagari rather than Roman script, which would need a
  transliteration pass by Claude. Accept that approach, and its cost, if the provider
  can't do it directly? Also confirm Hindi should be romanised with Urdu conventions
  rather than "Hinglish" conventions.
- **Q21 — PIN share plays private recordings.** FR-21 lets a PIN viewer play the
  recording of a private meeting, while FR-07 keeps private clips transcript-only.
  Confirm this difference is intended.
- **Q22 — "Share the notes" content.** Proposed: Catch me up summary, decisions and
  action items, with no link. Should recipients get a PIN link (FR-21) as an option?
- **Q23 — "How was the meeting?"** The rating is stored and shown but used for nothing
  else. Is it product feedback for us, or should it feed the game layer or memory?
- **Q24 — Memory from connected accounts.** NFR-03 criterion 9 allows learning people's
  addresses from calendar invites and the Slack directory, with the source shown. Confirm
  both are acceptable sources.
