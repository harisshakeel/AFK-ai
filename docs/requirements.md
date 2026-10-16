# AFK.ai requirements

AFK.ai is an AI meeting helper built for the person who wasn't fully there: they were
double-booked, half-listening, or absent, and need to catch up in minutes without asking
anyone to repeat themselves. It goes beyond a notetaker: it takes spoken commands during
the call, drafts the emails, invites, reminders and Slack posts that follow, and sends
them only after the user approves. Every output leads back to the moment in the recording
where it was said, so the user can check anything they don't trust.

This document states the requirements of AFK.ai as built, as of 2026-10-16. It is based on
a hands-on run of Fathom and on [docs/research.md](research.md). The Fathom-derived core
(the bot, the meetings list, synced playback, summary templates, action items, highlights,
clip sharing, search, the email after a meeting) is the baseline. Requirements that go
beyond Fathom are marked **[AFK.ai addition]**. How the system is built is in
[docs/architecture.md](architecture.md) and [docs/system-design.md](system-design.md);
each flow end to end is in [docs/data-flows.md](data-flows.md); the look is in
[docs/design.md](design.md); decisions, simulated behaviour and status are in
[docs/plan.md](plan.md). The brief is in [docs/assignment.md](assignment.md), verbatim.
Defects found by a read-only audit of the code are cited by their id there, for example
"(audit F1)", and listed in [docs/audit.md](audit.md).

Live: https://afk-ai-tau.vercel.app. Repository: https://github.com/harisshakeel/AFK-ai.

## 1. Purpose and who it is for

Picture an hour-long call with eight people. The user gets the gist first ("Catch me up"),
then any moment, word for word, with one click from a summary point to the second it was
said. Then AFK does the follow-up work: the sender says "AFK, draft an email to Sam"
during the call and approves the draft once afterwards.

What a user can do:

- Read the summary in four templates and switch instantly. Every point plays the moment
  it came from.
- Watch or listen with the transcript following along. Jump by chapter, filter by
  speaker, find words in the meeting, see who spoke when on the scrubber.
- Tick action items, privately, and copy them all.
- Highlight a moment (press `H`) and share it as a link that plays only that clip.
- Search every meeting and open a result at the moment it was said.
- Send AFK to a Zoom, Meet or Teams call. No account is needed: a guest's first send
  creates a private workspace in their browser; the real bot joins, records video, and
  the recording, transcript, notes and tasks land there.
- Let AFK join from the calendar: the week's meetings with a link sit on the dashboard;
  send AFK ahead of time, or switch on joining every one.
- Say "AFK, task for Sam: send the deck by Friday", "AFK, decision: …", "AFK, highlight
  that", "AFK, remember: …", "AFK, draft an email to Sam", "AFK, schedule a follow-up
  next Tuesday at three with Sam", "AFK, remind me …", "AFK, tell the team on Slack …",
  "AFK, what did we decide about pricing?" (answered in the meeting chat while the call
  is on). Internal effects land at once; anything that leaves the meeting waits on a
  card for one approval.
- Give every meeting an address, `/m/<code>` behind a four-digit PIN, to pass the
  recording, transcript and summary to someone who was not there.
- Own a memory: nine markdown files AFK reads before working and appends to afterwards,
  shown on a Memory page the user can edit, download and erase.
- Connect Gmail, Google Calendar and Slack so approved drafts go out from the user's own
  accounts.

Who uses it:

| Caller | Reads | Writes | AI runs |
|---|---|---|---|
| Visitor with no workspace yet | The sample meetings, shared clips, `/m/<code>` pages with the PIN, the empty dashboard, labelled demos of every signed-in surface | Nothing; the first write creates their identity | None |
| Guest **[AFK.ai addition]**: an anonymous Supabase identity made in the browser on the first write (a tick, a highlight, a bot, an access request) | The above plus their own meetings, commands and highlights; the Memory page as a demo; the Connectors page locked | Own highlights, clips, ticks, one access request; send the bot (5 a day, one active at a time); typed commands except `/remember`; dismiss commands; delete own meetings. Never a connector, never a memory file | Their own meetings: notes, items, parsed commands, live answers; no learned lines |
| Google user: a guest who continued with Google (same identity) or a direct sign-in | Everything a guest reads, plus their memory files, their connectors (never the token), the people AFK knows | Everything a guest writes, plus `/remember`, approve external commands, connect and disconnect Gmail, Calendar and Slack, edit, export or erase memory, delete contacts | Their own meetings, learned lines too |
| Job runner (service role, inside a function after its response) | Everything, including sealed connector tokens (opened in its process only) | Job state, transcripts, AI output, commands, highlights it makes for the owner, command results, history lines; sends mail, creates events, posts to Slack only through approved `run_command` jobs | Yes, on the owner's Anthropic key |
| Attendee webhook | Nothing | Advances one bot meeting's state; never creates or revives a meeting; then kicks the runner | None itself |

A guest who never continues with Google is purged after thirty days with everything they
own. A guest workspace is one browser; the dashboard says so. Memory files and connectors
belong to Google accounts only, and the database refuses them to guests. Nothing lists
users; no row of one user's is readable by another. Jobs are created only by the seed
import, the Attendee webhook, a typed command, an approval, a rewrite (`rewrite_command()`
queues `detect_commands`), `complete_job()` after a summary (`learn`), the notes trigger (`notify_owner`) and the daily
keep-alive's scheduling (the bots it schedules queue their jobs through the webhook), so
the bot caps, the command caps and three rewrites a draft bound how many Claude calls
anyone can cause.

## 2. Priorities

| Priority | Meaning |
|---|---|
| P0 | The core. The product does not work without it. |
| P1 | Built once the core worked. |
| P2 | Needs a product decision before it is built. |
| Deferred | Wanted, not built; the gap is covered another way. |
| Dropped | Considered and rejected. |
| Out | Deliberately not built. |

## 3. Definitions

| Term | Meaning |
|---|---|
| Workspace | Everything one identity owns: meetings, highlights, ticks, commands and, for a Google user, memory and connectors. A guest gets one on the first write; "Continue with Google" links the same identity to a Google account. |
| Owner | The identity a meeting belongs to: the one who sent the bot. |
| Sender (host) | The owner as a participant in the call: the speaker matched by name to who sent the bot (C1). Only the sender gives commands. |
| Seed meeting | One of the five ICSI Meeting Corpus meetings (section 11). Public: anyone can open them, with or without a workspace. |
| Turn | One transcript line (`transcript_turns`): speaker, `start_sec`, `end_sec`, text. |
| Moment | A time in the recording, in seconds from the start (`?t=` in a link). |
| Ready | Meeting status `ready`: the recording and transcript are stored. Notes may still be being written; the page says so. |
| Item | A summary point, action item, decision or note (`meeting_items`), citing turns (`item_citations`). |
| Highlight, clip | A stored range of a meeting (`highlights`); shared through a `/share/<token>` link (`share_links`). |
| Command | A sentence of the sender's starting with the wake word, or a typed slash command (`meeting_commands`). |
| Card | A command shown on the Tasks tab, the dashboard or `/tasks`; a card for an external effect waits in status `proposed` for approval. |
| Memory | The nine markdown files AFK keeps for a Google user (`memory_files`). |
| Meeting address | `/m/<code>` behind a four-digit PIN (`meeting_links`). |
| Job | One unit of background work (`processing_jobs`), leased and run inside the app's functions. |

## 4. Scope

- The Fathom-derived core is a bot that joins calls, a meetings list, a meeting page with
  synced playback and transcript, summaries in templates, action items, highlights, clip
  sharing, search across meetings and an email after each meeting. Everything else here
  is an AFK.ai addition.
- Notes are written in English. Urdu or Hindi speech is transcribed and romanized into
  Roman Urdu (W7); the notes stay in English. The wake word and the command grammar are
  English.
- During the call, AFK listens for the sender's commands (C1) and answers the sender's
  questions in the meeting chat (L2). Every other feature happens after the call.
- AI runs through the Claude API (`ANTHROPIC_API_KEY`; model `claude-sonnet-5-5` by
  default, `CLAUDE_MODEL` to change it) inside the web app's own functions. There is no
  worker process, queue service or container: Postgres leases the jobs.
- The meeting bot is Attendee (attendee.dev). The bot records video (MP4), which stays at
  Attendee and plays on the meeting page through short-lived links. The seed meetings are
  audio.
- Sign-in is Google only. Guests need no account.

## 5. Functional requirements

Each requirement names its user outcome and its acceptance criteria. The criteria describe
the product as built.

### 5.1 The core: meetings, playback, notes, clips, search, the bot

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| F0 | Import pipeline, run by the operator | Real meetings with checked AI output | P0 | One run (`pnpm import:seed`) turns a recording (`data/audio/<id>.m4a`, which is gitignored and not in the repository: the operator encodes it from the corpus with `tools/icsi/encode_audio.sh`, and the import stops with a clear error before writing anything if a file is missing) and its transcript (`data/meetings/<id>.json`: title, date, speakers, turns with start and end seconds) into a meeting. Audio is under 50 MB, uploaded to a private bucket under a content-addressed path. The importer rejects a transcript with negative or inverted times, times past the meeting's length, unknown speakers, duplicate ids or duplicate labels, and stops that meeting with a readable report. Overlapping speech is kept, ordered by start then end. Turns are stored by `ingest_transcript()` in one transaction; an unchanged transcript (by hash) is skipped; re-running creates no duplicates and never replaces items, so visitors' ticks survive. Committed AI output (`data/ai/<id>/analyze.json`, `summarize.json`) is loaded only when it was made from this exact transcript; otherwise the notes are generated the first time the meeting is opened. |
| F1 | Meetings list | Pick the right meeting quickly | P0 | Newest first, with title, date, length, speakers and a one-line headline; one click opens a meeting. Loading, empty and error states, with retry. The dashboard shows only the caller's own meetings, grouped by period (Today, Yesterday, This week, …), twenty a page with a keyset cursor in `?after=` and a plain "Older meetings" link; its empty state leads to Send AFK and to the samples. `/samples` lists the public seed meetings for anyone, paged the same way. |
| F2 | Playback with synced transcript | Move through a recording by its words | P0 | Clicking a line plays from there. The current line is the latest-starting turn with start ≤ t < end, else the last turn that started; it is highlighted and kept in view. Scrolling away stops auto-scroll and shows "Back to now". Speeds 1× to 2×. A `?t=` link reopens at that moment, after a refresh too. A bot meeting plays its video above the notes (above the tabs on a phone) with the same sync; the samples are audio, docked below. Player shortcuts are off while typing. |
| F3 | Navigating a long meeting **[AFK.ai addition]** | Find one moment in an hour with 8 people | P0 | Chapters with times. A who-spoke-when strip on the scrubber. Speaker chips that filter the transcript. Find within the meeting with a match count, next and previous, and matches marked on the timeline. Speakers are told apart by colour plus a letter mark (twelve colours). In the long seed meeting a decision is reachable in three actions or fewer from opening the page. |
| F4 | Summary and templates | The gist, in the shape needed | P0 | Four templates, "Catch me up", "General", "Project update" and "Brief", switch with no loading. Every point has a timestamp that seeks the player. The chosen template survives a refresh (`?template=`). Notes the host stated with commands are pinned and marked "said on the call". The action items are offered at the end of the summary as potential tasks. If AI output is missing or still being written, the page says so and the player and transcript still work. |
| F5 | Action items and decisions | Know what was agreed and who owns it | P0 | Each item shows the task, the owner or "No owner mentioned", a due date only if one was said, and a timestamp link. Ticking an item done is private to the caller's identity (`item_states`) and survives a refresh. "Copy all" copies the list. Decisions have the same timestamp links. |
| F6 | Highlights and clips | Keep a moment | P0 | Made from a transcript selection, from the playhead, with the Highlight button or the `H` key. Start and end can be adjusted, a note added, the highlight deleted. It appears in a panel and on the timeline and survives a refresh. The database clamps a clip inside the recording and caps an identity at 300 highlights. |
| F7 | Share a clip | Send one moment to someone who wasn't there | P0 | One action makes and copies a link, `/share/<token>`, the token minted by the database (64 hex characters), one live link per highlight, revocable. Opened signed out, it shows only that clip: its range, its transcript excerpt (every turn that overlaps, in full), the meeting title and date, the speakers heard in it. A public meeting's clip plays the audio limited to the range; a private meeting's clip is transcript-only, because any media link would expose the whole recording. A revoked or wrong link shows a clear page. The share page never shows tasks, commands, memory or anything of the owner's. |
| F8 | Search across meetings | Find where something was said | P0 | Full-text search over transcripts, titles and notes (at most 200 characters, 120 hits), under the caller's own readability: a visitor searches the samples, an identity only its own meetings. Results grouped by meeting with snippet, speaker and time. A result opens the meeting at its moment with the term marked and Find started there. The query lives in the URL. A no-results state suggests a next step. |
| F9 | Send AFK to a meeting | AFK gets into meetings | P1 | The Send page takes an https link on a Zoom, Meet or Teams host (any subdomain of the listed hosts is accepted; the path must name one meeting, Teams included: `/l/meetup-join/…` or `/meet/<id>`), an optional title, the sender's name in the call (required for a guest), and the call's language ("English and Urdu", the default, remembered in the browser, or "English"). Anyone's request sends a real Attendee bot named "AFK.ai Notetaker" that joins audio-only, records video (speaker view, 720p) and transcribes from the platform's captions or Deepgram (`ATTENDEE_TRANSCRIPTION`). A guest's first send creates their workspace **[AFK.ai addition]**. The meeting shows Requested, Recording, Processing, then Ready or Failed, refreshing itself every ten seconds while the tab is visible, and arrives in the list with its summary, action items and decisions once the jobs have run. Caps, enforced in one database trigger under a lock: one active bot per identity, 5 requests a day per identity, 5 a day per place (a keyed hash of the sender's address), and a deployment-wide daily cap (`app_settings.bot_daily_cap`, 20), of which guests together may use half (a guest past it is told to continue with Google or try tomorrow); deleting a meeting gives nothing back. "Show me what happens" plays the steps as a labelled demo without sending; a "What you can say" panel lists the commands. If the bot is not configured, the page says so and keeps the demo. The recording stays at Attendee and plays on the meeting page through the thirty-minute links Attendee mints, renewed by the page two minutes before expiry without losing the player's place. A bot that never reports back is closed as failed six hours after its time by the daily keep-alive, which frees the sender's active slot. The sweep times every bot row from when its call was due, `coalesce(scheduled_for, created_at)` (migration 40), so a scheduled bot that joined is never closed mid-call. |
| F9a | Join from the calendar | AFK is in the user's meetings without a Send page | P1 | A Google user with Calendar connected sees the next seven days' events that carry a Zoom, Meet or Teams link on the dashboard, each with Send AFK. Sending schedules the bot for the event's time (`joinAt` in the request, `scheduled_for` on the meeting; status Scheduled; one scheduled bot per calendar event per owner, `calendar_event_id`). A scheduled bot does not count as the one active bot, joins by itself, and is swept six hours after its time if it never joins or never reports an end; Delete removes the bot at Attendee. A switch "Join the meetings I accept" writes the profile line "AFK joins my calendar meetings: yes", and the daily keep-alive schedules a bot for each such user's events in the next thirty-six hours that they organised or accepted (never an invite they declined or did not answer), at most twenty a run, under the same caps. Invitees are learned only from such events. Events not accepted show "not accepted" on the dashboard. |
| F9b | Delete a meeting | Nothing outlives the owner's choice | P0 | Delete on an owned meeting tells the bot to leave if it is still in the call, deletes the row (cascading turns, jobs, items, commands, highlights, links, the meeting address), then the audio object, and tells Attendee to forget the bot's recording and transcript (best effort, logged when refused). A job finishing late finds nothing to publish. A meeting with spoken commands deletes like any other (audit S1, disproved by a database test). |
| F10 | Live highlight during a replayed call | Highlight a moment mid-call | Out | Not built. Highlights are made on the meeting page during playback. |
| F11 | Ask AFK on the meeting page | An answer with timestamps | P2 | Not built as a page feature; the spoken and typed `/ask` command covers it (5.2). |
| F12 | Recording upload | Bring a recording | Out | Not built. |

### 5.2 Commands: the sender speaks, AFK acts **[AFK.ai addition]**

The sender gives commands by starting a sentence with the wake word. Nobody else's words
are commands. Internal effects are immediate; external effects wait for one approval. The
command table is one registry that the detector, the typed parser, the Tasks tab, the Send
page and the database's kind list all read. It holds the eleven kinds a user can give; the
database and the detector also know a twelfth, internal kind, `unknown`, for a sender's
wake-word sentence AFK did not understand, which shows as a "not understood" card (C8):

| Kind | Typed | Spoken trigger words after the wake word | Effect | Needs approval | Needs the model |
|---|---|---|---|---|---|
| task | `/task` | action item, action, task, to do, todo | An action item with the owner and due date said, marked "said on the call" | No | Yes |
| decision | `/decision` | decision, we decided, decided | The decision word for word, cited to the moment | No | No |
| note | `/note` | note | A note pinned at the top of the summary | No | No |
| highlight | `/highlight` | highlight, clip, mark that, mark this | A clip from the start of the previous speaker's turn to the command, at most 60 s | No | No |
| remember | `/remember` | remember | A dated line appended to people, projects or glossary (chosen by the words), cited to the turn; refused for a guest | No | No |
| email | `/email` | email, e-mail, mail | An email draft, sent by Gmail on approval (`mailto:` and Copy without Gmail) | Yes | Yes |
| followup | `/followup` | schedule a follow-up, follow up, schedule | A calendar event at the time said with the people named, invitations on approval | Yes | Yes |
| remind | `/remind` | remind me, reminder, remind | A reminder event on the host's own calendar, on approval | Yes | Yes |
| slack | `/slack` | tell the team on slack, post to slack, post on slack, … | The host's own words after the command word posted to the chosen channel, on approval; no model rewrites it | Yes | No |
| ask | `/ask` | what, who, when, where, why, how, did we, do we, does, is there, are we, has anyone, ask | Answered in the meeting chat from what was said so far while the call is on; typed after the call, the answer lands on the card | No | Yes |
| recap | `/recap` | recap, summarise, summarize, catch me up, what did I miss (checked before ask) | A few lines on the meeting so far, in the chat while the call is on | No | Yes |

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| C1 | Wake-word detection | Say "AFK, …" and be understood | P0 | A deterministic pattern, no AI: an optional "hey", "hi", "ok" or "okay", then "AFK", "A F K", "A-F-K" or "A.F.K", optionally "bot", case-insensitively, at the start of an utterance, followed by a comma, colon, other punctuation or nothing. It ignores every utterance that is not the sender's: the sender is the speaker matched by name to who sent the bot (the Google name, the profile's "Name" and "Name in calls", or the name typed on the Send page); only when no name is known at all is a lone speaker taken as the sender, so a stranger speaking alone in a meeting the owner skipped gives no commands; the platform's host flag confers nothing. After the call two matching speakers count as nobody; during the call the same tie rule applies over the names heard so far (migration 52), so a participant whose display name also matches ("Haris" in Haris Shakeel's call) gives no commands once both have spoken (audit F2). When the sender cannot be told apart, the Tasks tab says so with a link to set "Name in calls". The detector yields the command kind and the rest of the sentence; a sender's turn with the wake word but no known command becomes a "not understood" card (kind `unknown`). Unit tests cover every variant and the guest case, and a test over every seed transcript finds no false wake word with everyone treated as the host. |
| C2 | Grounded parsing | AFK fills in exactly what was said | P0 | One Claude run per meeting parses the arguments of every detected model-needing command against a JSON schema. Owners must be a speaker or named in the sentence; dates, times and recipients must be words from the sentence or the surrounding minute of transcript; an address said in the call is kept only when the transcript holds it, written or spelled out. Ungrounded arguments are dropped and reported in the job report. The run has no tools and only the transcript, the host's memory, the host's skills, the meeting's link and PIN (when on) and the command list as input. At most 20 spoken commands a meeting are parsed; the next twenty are recorded as skipped with the reason. |
| C3 | Internal commands | Explicit items beat inferred ones | P0 | `/task`, `/decision`, `/note` create items marked "said on the call" with the sentence's timestamp; `/highlight` clips as above; `/remember` appends its line. Items appear in the existing notes tabs, cited to the sentence. Applying is one transaction (`apply_commands()`): all of a meeting's internal commands land, or none and the job retries. The analysis prompt is given the explicit items and told not to restate or contradict them. |
| C4 | External commands, the Tasks tab, the cards | Approve with one click, see what happened | P0 draft, P1 send | The meeting page's Tasks tab lists every command as a card: the quoted sentence with a timestamp button, the parsed arguments as a form the host confirms (To, Copy, subject, body for an email; date, time, length, invitees for a follow-up; time and text for a reminder; channel and message for Slack), a preview, Approve and Dismiss, then the result (recipient, subject, event time, link, the time it ran) or the failure in plain words. Email cards pre-fill Copy from the email skill; follow-ups take their default length and "always invite" from the calendar skill; a Slack card picks its channel from the Slack skill's topic lines, else the channel chosen on the Connectors page. A draft can be sent back with a note ("Rewrite"), one new parse per note, spoken or typed; `rewrite_command()` queues the `detect_commands` job and the route kicks the runner. Dismiss removes what the command created and leaves no trace in the notes; a command that ran cannot be dismissed. Approve and Dismiss are owner-only, rate limited, within 300 ms. The tab never appears on a share link or a meeting address. The processing page says "AFK heard N commands". The same cards show first on the dashboard ("Awaiting your approval") and on `/tasks`, approvable there; the sidebar's Spells entry counts them and says since when the oldest has waited. ⌘/Ctrl+Enter in any field approves; Enter alone in a single-line field does nothing, because approving sends something that cannot be taken back (in the rewrite note, Enter sends the note back). |
| C5 | Typed commands | Didn't catch it? Type it | P0 | The Tasks tab has an input that accepts the same slash syntax. A typed command applies with the same rules, cited to the playhead's turn, marked "typed"; model-needing kinds queue a parse and the page refreshes until the card arrives. At most 20 typed commands a meeting, counted by a trigger under a lock. Owner-only, validated with the same schemas. |
| C6 | Visitor demo | A visitor sees what commands do | P0 | On every seed meeting the Tasks tab shows example cards labelled as examples with the approval moment visible but disabled. The Send page's "What you can say" panel lists the commands with an example each. Nothing runs for a visitor. |
| C7 | Execution, at most once | Approved means done, never done twice | P1 | `approve_command()` stores the approved arguments and inserts at most one queued or running `run_command` job per command (partial unique index). `start_command()` marks `executed_at` under the command's row lock before the adapter is called and refuses a second attempt for email and Slack ("ambiguous: check your Sent folder, then retry or dismiss"). Calendar inserts carry an id derived from the command, so a retry reads the existing event back (three attempts). `finish_command()` records the result, writes a line in `history/actions.md`, and learns the confirmed recipients as contacts. A failed command may be approved again only when `executed_at` is null or the kind is a calendar one. |
| C8 | Help and errors | Know why a command didn't work | P0 | A heard but unparsed command shows as a card with "AFK didn't understand this" and the sentence, so it can be typed. A failed run shows the reason and a Retry (a new approval) where it is safe. |
| C9 | Allowed speakers | Let a colleague give commands | Out | Not built. |

### 5.3 Memory: what AFK knows about the user **[AFK.ai addition]**

Nine markdown files per Google user, 32 KB each, each with the user's zone above a `---`
rule and a "## Learned by AFK" zone below it. AFK never changes anything above the rule;
the database refuses such a write.

| Path | Tab |
|---|---|
| `profile.md` | Profile |
| `context/people.md` | People |
| `context/projects.md` | Projects |
| `context/glossary.md` | Glossary |
| `history/meetings.md` | Meetings |
| `history/actions.md` | Actions |
| `skills/email.md` | Email skill |
| `skills/slack.md` | Slack skill |
| `skills/calendar.md` | Calendar skill |

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| M1 | Profile | AFK knows who the user is | P0 | Created when the welcome is finished or skipped, from the Google profile (name and email), in a fixed template with headed sections ("Who I am", "How I like things", "Who may give AFK commands") and the lines Name, Name in calls, Email, Role and company, Timezone, Language (English), Notes, Email sign-off, "AFK speaks in calls: no", "Email me after each meeting: yes", "AFK joins my calendar meetings: no". Guests have no memory. The profile is loaded into every run for the user's meetings. |
| M2 | Context files and skills | AFK knows the user's people, projects, words and voice | P0 | The three context files and the three skills are created with the profile from templates. Each skill is a settings section of "- Key: value" lines (a value in parentheses is a placeholder and counts for nothing: tone, length, greeting, sign-off, always copy, always invite, default length, working hours, time zone, channel per topic) followed by the guidance AFK follows (how an email opens and closes, what stays out, how "Friday morning" or "end of day" is read, how a Slack post finds its channel). The parser reads the user's zone of each skill as data under `<host_skills>`. A later template change reaches accounts whose copies were never edited. |
| M3 | Learned lines | AFK gets better after each meeting | P1 | After a Google user's meeting is summarised, one Claude run (`learn` job) proposes at most ten lines across the context files, each a single dated line ending with the meeting title and moment, each citing a turn and quoting at least three of its words; a line whose quote is not in its turn is dropped and reported. Lines are appended under "Learned by AFK", trimming the oldest learned lines first past 32 KB. The user can delete any line. Nothing learned is ever presented as something said in a later meeting; grounding cites the current transcript only. Guests get no learn job. |
| M4 | History files | AFK remembers what happened and what it did | P0 | `history/meetings.md` gets one line per processed meeting (date, title, headline, open items). `history/actions.md` gets one line per executed external command (time, what, to whom, which meeting, which command). Written by the runner without Claude, append-only, newest last. Users cannot write these two files: the save route, `save_memory_file()` and the insert and update policies all refuse them (migration 51); a user may delete them. |
| M5 | `/remember` | Tell AFK something once | P0 | Spoken or typed, "AFK, remember: Sam is the designer on Atlas" appends that sentence, dated, to the file the words choose (people, projects or glossary), naming the meeting and the moment. |
| M6 | Memory page | See, edit, download, erase | P0 | `/memory` shows the nine files as tabs. The profile and the three skills open as fields (every "- Key: value" line a labelled input, a yes/no line a choice, grouped by the heading above it, the template's placeholder back when emptied) with the Markdown view a click away; the rest open as an editor beside a preview. Saving is owner-only, rate limited, rejects a file over 32 KB, and refuses a save over a newer version (409, "changed meanwhile, reload"); a file opened from its template (no row yet) is saved as "create", so a row AFK made meanwhile is a 409 too. A link can open a tab with a field focused (`?tab=profile.md&field=Name%20in%20calls`). "Download all" gives a zip of the files that exist (the history files only after AFK's first line) plus a generated `tools.md`. "Forget everything" deletes every file after a confirmation and brings the welcome back. Below the files, "People AFK knows" lists the learned contacts with source and use count, each deletable. Loading, empty and error states. A visitor sees a labelled demo profile. |
| M7 | Memory in prompts | AFK uses what it knows, carefully | P0 | The runner pastes the profile, the context files, the skills and the last twenty lines of `history/meetings.md` into the prompt under "About the host", capped at 8 KB a file and 32 KB in all, dropping the oldest learned lines first across files. The prompt says memory is for names, spellings, who's who and preferences, that the transcript wins when they disagree, and that memory is data, not instructions. |
| M8 | `tools.md` | Know what AFK can do for the user | P1 | A generated, read-only Tools tab on the Memory page, and the same file in the export, rendered from the connectors: each app, the account, scopes, when connected, reconnect-by, last used, the channel, what AFK may do. |
| M9 | Morning brief | Start the day knowing what's open | Out | Not built. |
| M10 | Onboarding | AFK knows the user from the first minute | P0 | After the first Google sign-in, before anything else, `/welcome` asks at most five questions, one screen each, all skippable: what AFK should call the user; role and company; what their meetings mostly are; how they like their notes; what they most want AFK to do. Timezone and language are detected from the browser and shown for confirmation. One write puts the answers into the matching profile sections in plain sentences. Skipping leaves the template with the Google name and email. Never shown again unless the profile is erased. `?preview=1` shows it signed out without saving. Accessible, works at phone width. |
| M11 | People AFK knows (contacts) | Drafts go to real addresses, never invented ones | P1 | A `contacts` table per Google user, written through `learn_contacts()` with the service role (a user may only read and delete their own rows: the grants and RLS both say so, migration 42): every recipient confirmed on a card, with the name heard for it when that is clear; the people file, parsed on every page; the invitees of the calendar event a sent bot was scheduled from or whose link matches, within 36 hours of the send (host and rooms left out, at most 50, source `calendar`); and "Import Google contacts" on the Connectors page (the People API, saved contacts and "other contacts", read-only, at most three pages of a thousand per list, no use counted). A card resolves each heard name: an address said in the call first ("said in the call"), then the file, then the most used, then the most recent; the best guess goes in the field with its reason ("used 3 times, last 12 Oct", "from your People file", "on a calendar invite with you") and the other matches one click away; an unknown name leaves the field empty and says so. "Everyone" means the people on the call. The draft carries the host's name in the sign-off and the first recipient's first name in the greeting, filled in code, never a placeholder when the name is known. |

### 5.4 Connectors: Gmail, Google Calendar, Slack **[AFK.ai addition]**

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| X1 | Connect Google | One consent for Calendar, Gmail and Contacts | P1 | "Connect Google" on the Connectors page starts OAuth with the `gmail.send`, `calendar.events`, `contacts.readonly` and other-contacts scopes, offline access, forced consent and PKCE; the state is a signed, short-lived cookie bound to the user and the provider. The callback exchanges the code server-side, seals the refresh token with AES-256-GCM under `CONNECTOR_TOKEN_KEY` bound to the row, and stores it in a table no user role can read (`connector_secrets`). The token never reaches the browser, the session cookie or a log. A second connect replaces the first. One connector per provider per user; guests are refused in RLS, the start route and the approve route. |
| X2 | Disconnect and expiry | Control over access | P1 | Disconnect revokes at the provider and deletes the row and its secret. While the Google app is in Testing the page shows "reconnect by <date>" seven days after connecting; an `invalid_grant` on refresh marks the connector expired and fails the command with "Reconnect Google". |
| X3 | Read tools during drafting | Real addresses | Deferred | No tools in Claude runs. Addresses come from M11; free slots are not read. |
| X4 | Gmail send | Mail leaves from the user's own address | P1 | On approval the adapter sends the approved draft (to, cc, subject, body) as an RFC 5322 message from the host's Gmail; the result records the message id and recipients. At most once per approval. At most 5 To and 5 Cc recipients. |
| X5 | Calendar create | Follow-ups and reminders land on the user's calendar | P1 | `/followup` creates the event at the time said with the people named as invitees (`sendUpdates=all`, at most 10); `/remind` creates a reminder for the host only. Client-generated event ids make retries safe. |
| X6 | Outgoing webhook | Wire AFK to anything | Out | Not built. |
| X7 | Slack | `/slack` posts to a chosen channel | P1 | A Slack app with the bot scopes `chat:write`, `chat:write.public`, `channels:read`; the Connectors page lists the workspace's public channels, paged, and saves the choice. The post is the host's words, at most 2,000 characters, once. GitHub is not built. |
| X8 | Connectors page | Know what AFK may act through | P1 | `/connectors` shows three cards, Gmail, Google Calendar (one Google connection) and Slack: who each is connected as, what it may do, reconnect-by, connect, reconnect, disconnect, the channel picker, "Import Google contacts". Locked for a guest with the Continue with Google button. "Not set up on this deployment" when the OAuth client is missing from the environment. |

### 5.5 Live presence in the call **[AFK.ai addition]**

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| L1 | Live transcript | AFK hears the call as it happens | P1 | The bot is created with the real-time transcript trigger. Each utterance reaches the webhook, which verifies the signature and stores it once in `live_utterances` (keyed by Attendee's idempotency key, at most 2 KB, no user grants), answering within 1 s. Replays are ignored. Live utterances are deleted when the final transcript is ingested, else after 24 hours. Nothing in them is shown to visitors. Someone other than the sender who says the wake word is told once, in the chat, that only the sender can give commands; any other command the sender speaks gets one chat line saying it was heard and where its result will be. |
| L2 | In-call answers | Ask AFK a question in the meeting | P1 | A sender's `/ask` or `/recap` in the live transcript creates a live command and an `answer_in_meeting` job in the same transaction; the webhook kicks the runner. The answer is written from the utterances so far, and nothing of the host's memory (the chat is read by everyone in the call), with one Claude call, keeps only citations that exist (an answer with none becomes the fixed "That wasn't discussed yet."), is posted to the meeting chat once (an attempt after one that reached the chat posts nothing), and lands on the command's card. Twenty seconds after the question, if the answer has not started (no run holds its job on a live lease and nothing was posted), the chat gets "I'll answer this after the call" and the later answer lands on the card only; a slow answer posts itself with no fallback, so the chat gets one line per question. Targets: first chat text within 6 s median, 10 s at the 95th percentile. |
| L3 | Voice | AFK speaks when asked | P1 | With text-to-speech credentials in the Attendee project, replies are also spoken when the profile says "AFK speaks in calls: yes". Without credentials, chat only. The bot speaks only in reply to a sender's command. `/timer` is not built. |
| L4, L5 | A face, a talking face | | Dropped | Audio only. The bot joins with no camera image and its name contains "AFK". |
| L6 | Routines | AFK does it every week | Out | Not built. |

### 5.6 A meeting's address **[AFK.ai addition]**

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| A1 | `/m/<code>` behind a PIN | Pass a meeting on to someone who was not there | P1 | Every meeting has an address from the moment it exists: a twelve-character code from a 32-letter alphabet and a four-digit PIN, both minted by a database trigger with the meeting row (`new_link_code()`, `new_link_pin()`), readable by the owner alone and never written from the browser. The code carries 56 random bits (one of the fifteen hex digits it is cut from is the UUID's fixed version digit). The owner's Share panel on the meeting page shows code and PIN with Copy, a switch to turn the link off and on, and "New link and PIN". A visitor at `/m/<code>` sees a PIN form whatever the code; a right PIN on an enabled link of a ready meeting sets a signed grant cookie named for the code (seven days, HttpOnly, an HMAC of code and expiry under a key derived from the server secret); five wrong PINs lock that code for that visitor for fifteen minutes, and a lock that ran out gives five tries again; an unknown or switched-off code answers like a wrong PIN ("wrong" or "locked", nothing more). With a grant the page shows the recording (played as on the meeting page, renewed through its own media route, no download), the transcript with playback and find, and the summary with its templates and the notes said on the call; nothing of the owner's (no action items, tasks, commands, highlights, memory, no link into the app), and the page says so. Switching the link off suspends every grant; switching it back on re-admits grants minted earlier; "New link and PIN" ends them and also switches the link on. The page, the PIN route and the media route sit in the public read limits. Tries are forgotten after a day. "Share the notes" and email drafts that share the recording carry the address and the PIN while the link is on. Deleting the meeting deletes the address. |

### 5.7 After the meeting

| ID | Requirement | User outcome | Priority | Acceptance criteria |
|---|---|---|---|---|
| W1 | The wrap-up **[AFK.ai addition]** | No written-up meeting goes unseen | P1 | Once a meeting's notes are written, the next page the owner opens (the app shell and the owner's meeting page ask `GET /api/wrap-up` once) shows a dialog: the title and headline, the counts of action items and decisions, the cards waiting for approval (approvable, dismissable, rewritable in place) and "How was the meeting?" (Good or Not great, a word on why, optional). Later closes it for that visit (session storage) and it returns on the next; Done records `reviewed_at`, the rating and the note and ends it. Nothing is auto-approved; cards left behind stay on the dashboard. |
| W2 | The note to the owner | Nothing is written up unseen even with the app closed | P1 | When a Google user's meeting's notes are written, a `notify_owner` job sends one short email from the owner's own Gmail to the same address: what was written up, the counts, how many cards wait, the link. No Claude. Ends silently when the profile says "Email me after each meeting: no" or Gmail is not connected. Sent at most once per job, under `start_job_effect()`. The trigger fires on any change of `summarized_at`, so a re-summarised meeting sends a second note (audit S3, and F5 below). |
| W3 | The nudge **[AFK.ai addition]** | No card waits unnoticed for more than a day | P1 | With no fresh wrap-up to show, the wrap-up route returns the oldest proposed card older than a day on a meeting not nudged for a day, in "nudge" mode ("Still waiting for you", no rating); Later and Done both snooze it a day. The Spells badge and the Tasks page heading say since when the oldest card has waited. |
| W4 | Share the notes **[AFK.ai addition]** | The notes in everyone's inbox after one approval | P1 | "Share the notes" (the button reads "Email the notes") on an owned ready meeting builds a plain email from the stored notes (headline, decisions, action items with owners and dates, the default template's points), signed off as the email skill says, addressed by name to the speakers but the host, inserts one proposed email card without Claude, and opens the Tasks tab where the host approves once. |
| W5 | The first-run checklist **[AFK.ai addition]** | A new account finds its setup steps in one place | P1 | The dashboard checks what exists: Google connected with Gmail and Calendar, a Slack channel chosen, a "Name in calls" line, one meeting with a bot. Each open item links to where it is done; the section disappears when all are done. A guest sees two items: one test call, and continuing with Google. |
| W6 | The record (game layer) **[AFK.ai addition]** | Coming back feels like progress | P1 | Under the dashboard list, one line of the record (level, progress to the next, streak) leads to the Player card at `/dashboard/record`: the level card, twelve weeks of calls as bars, the action ring, commands, the streak, the longest calls and the badge album, all counted from the user's own rows, nothing estimated. XP: 50 per meeting, 1 per recorded minute, 10 per decision, 5 per action item, 15 per command, 25 per executed command, 5 per highlight. Levels: Lurker 0, Attendee 100, Delegator 300, Decision-maker 700, Chief AFK Officer 1,500, AFK Legend 3,000. The streak counts consecutive ISO weeks with a call, the current week not breaking it. The Quest log line under the dashboard title shows the counted numbers (quests, time played, open side quests, spells awaiting your cast). |
| W7 | Urdu in a call **[AFK.ai addition]** | A bilingual call is transcribed, not lost | P1 | The bot is sent in Deepgram's multilingual mode by default (`ATTENDEE_DEEPGRAM_LANGUAGE`, `multi` or `en`), which transcribes Urdu or Hindi in Devanagari. After the call, before storing, turns in Devanagari or Arabic script are handed to `romanizeTurns()`: chunks of about 6 KB, one Claude call each with a JSON schema, in parallel, at most 60 KB per meeting; the model transliterates into Roman Urdu, never translating; only the ids asked for are accepted. A failed chunk, no time left or no API key leaves those turns as transcribed and the ingest goes on; the report carries counts and spend. The analysis, summaries and parser are told the transcript may hold Roman Urdu or Devanagari and write the notes in English. The wake word and the command grammar stay English. |

### 5.8 Processing: how AI output is made

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| P1 | Leased jobs in Postgres | P0 | `processing_jobs` rows per meeting with kind (`ingest_media`, `detect_commands`, `analyze`, `summarize`, `learn`, `run_command`, `answer_in_meeting`, `notify_owner`), status, `lease_until`, `claim_token`, attempts, a report. A job has at most 3 attempts: after a failed attempt it is due again after 1 minute, then 4 minutes; the third failure is final. Jobs are created by the import, the webhook, a typed command, an approval, a rewrite, the notes trigger and the keep-alive's scheduling (section 1). `claim_job()` takes one job under `for update skip locked`, the kicked meeting first and live answers and approved commands before notes. `complete_job()` publishes only while its claim token holds; an expired lease is enforced by the next `claim_job()` sweep, not by `complete_job()` (audit F24). Input or output the database refuses ends the job at once ("rejected"): output `complete_job()` refuses, and a transcript `ingest_transcript()` refuses, so neither is fetched and paid for again. A parse that fails for good queues `analyze` and `summarize` again even when the notes exist, which re-sends the owner's note and adds a second history line (audit F5). A rate limit or outage at Anthropic releases the job without using an attempt; a missing or refused API key releases it for ten minutes and ends the run. A changed transcript retires jobs running against the old one and clears the meeting's notes marks. Done and failed jobs are pruned after thirty days; a meeting records `analyzed_at` and `summarized_at` for itself. |
| P2 | The runner inside functions | P0 | The runner is a function of a client, a config and a time budget (270 s of Vercel's 300 s; a Claude call gets what is left, up to about 245 s). It runs after a response in: the webhook, the meeting page while notes or cards are pending, the typed-command, approval and rewrite routes, `/api/jobs/kick` (cron secret; a POST body may name a meeting, kinds and the hop) and the daily keep-alive. A run that ends on its budget with due jobs left posts once to the kick route so a fresh function carries on until nothing is due; a run that stopped for a reason a new function would not change does not chain. A ready meeting's page re-kicks a job still running six minutes after its claim lost its lease. `GET /api/health` reports the queue in numbers (due, scheduled, running, failed today, the oldest wait), the last keep-alive and what is configured, 503 when a due job has waited over thirty minutes; public, counts only. |
| P3 | Claude calls | P0 | Every call has no tools, a JSON schema the API enforces, the transcript as the first (cached) block of the message, memory and commands labelled as data, the instruction last. `analyze` returns a headline, chapters, action items and decisions, each citing turns; `summarize` returns the four templates; both are validated against a schema, then grounded: a citation must be a real turn of the meeting (the database proves it), an owner must be a speaker or named in the cited turn, a due date must be said there; what fails is dropped item by item and reported, and whatever survives is published. There is no failure threshold: a `summarize` whose every template is dropped stores an empty list as a success. The four runs read one cached prefix. Every job report records tokens and an estimated cost. |
| P4 | The Attendee webhook | P0 | HMAC-SHA256 over Attendee's canonical JSON with a constant-time compare, numbers kept as the signer wrote them; 503 without a secret, 401 on a bad signature; idempotent; never creates or revives a meeting; answers within 1 s; kicks the runner after answering. "Ended" moves the meeting to `transcribed` and queues `ingest_media`, which fetches the transcript and the recording's link, reads the recording's length from the MP4 header in a few range requests (never downloading it), merges consecutive captions per speaker except where a command starts, romanizes where needed, stores the turns and marks the meeting `ready` with the bot id as its `video_ref`. |
| P5 | The daily keep-alive | P0 | Vercel Cron at 06:17 UTC (`/api/cron/keepalive`) with the cron secret: one real query keeps Supabase from pausing; prunes the write-limit log, finished jobs after thirty days, live utterances after a day, PIN tries after a day; sweeps bots that never reported back six hours after their call was due (`coalesce(scheduled_for, created_at)`, migration 40); purges guests older than thirty days who never continued with Google (rows, then their audio, then Attendee is told to forget their bots; never a guest whose bot is in a call); schedules the auto-join bots; runs whatever is queued with the time left. One row in `cron_runs` records the counts. |

## 6. Pages

The app shell speaks in gaming words. The sidebar entries are Quests (`/dashboard`),
Spells (`/tasks`), Lore (`/memory`), Loadout (`/connectors`), Tutorial (`/samples`) and
Summon AFK (`/send`).

| Route | What |
|---|---|
| `/` **[AFK.ai addition]** | The landing page, for everyone, always in the light palette: a twelve-second animation as the full-screen hero, played by scrolling (a play button under reduced motion), the nav floating over it; the claim with its second line typed by the scroll, beside three things to do (open the sample, sign in, a form that takes a Gmail address to be added as a Google test user); "the short version", a timeline of seven stops from the pasted link to the shared clip, its spine drawn by the scroll; a closing line; the footer. Signed in, its links lead to `/dashboard`. |
| `/dashboard` | Quests, in this order: the guest notice, the Quest log title, the first-run checklist (W5), the calendar week (F9a), the cards awaiting approval (C4), then the meetings list grouped by period (F1), then the record line (W6: the Player card summary, beside the list on a wide screen, linking to `/dashboard/record`); the wrap-up dialog over it (W1). |
| `/dashboard/record` | The Player card (W6). |
| `/samples` | Tutorial: the public seed meetings, paged. |
| `/meetings/[meetingId]` | Notes beside the synced transcript with the docked player (video above the notes for a bot meeting); tabs for the summary (with templates and potential tasks), action items, decisions, chapters, highlights, Tasks (owner only); the owner's Share panel (A1), "Share the notes" (W4), Delete (F9b); the processing view with its steps while not ready; URL state `t`, `tab`, `template`, `q`. Sample meetings are indexable with a canonical link; a user's own meeting is `noindex`. |
| `/search?q=` | F8. `noindex`. |
| `/share/[token]` | F7. `noindex`. |
| `/m/[code]` | A1: the PIN form, then the shared meeting view. |
| `/send` | Summon AFK: F9, the labelled demo, "What you can say". |
| `/sign-in` | Continue with Google: links the guest identity this browser has, or signs in to an existing one; its entry points are hidden while the Supabase project's Google provider is off (read from Supabase's public auth settings, cached five minutes). |
| `/welcome` | M10. |
| `/memory` | Lore: M6, M8, M11. |
| `/tasks` | Spells: every command across the user's meetings, the waiting ones first as approvable cards, then the record, each row linking to its meeting's Tasks tab. |
| `/connectors` | Loadout: X8. |
| `/privacy` | What is kept, for how long, and what the bot announces. |
| `/auth/callback`, `/auth/sign-out` | The OAuth round trip; sign-out is POST-only, or from the callback only with a PKCE verifier cookie proving the round trip started here. |
| `/connectors/[provider]/start`, `/connectors/[provider]/callback` | X1, X7. |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.svg`, `/apple-icon`, `/opengraph-image` | Generated; the sitemap lists the public pages and the sample meetings. The mark (an empty chair with an amber line) is drawn in `src/components/ui/logo.tsx`; `icon.svg`, `apple-icon.tsx` and `opengraph-image.tsx` carry their own copies of its paths, and `icon.svg` differs slightly from `logo.tsx` (one leg ends at x 18 and 49 rather than 17 and 50, stroke 9 rather than 8). |

Most data pages have a `loading.tsx` in the shape of what is coming; `/connectors`,
`/dashboard/record`, `/m/[code]`, `/sign-in`, `/welcome` and `/privacy` fall back to the
root `src/app/loading.tsx` ("Loading…"). Every page has an error state (the root
`src/app/error.tsx`) and an empty state where a list can be empty. Signed in, pages sit in the app shell (sidebar,
account, search in the top bar, one content column); signed out, under the public
header. Theme: light by default, a sun/moon toggle that sets `data-theme="dark"` and
keeps the choice in localStorage, restored before first paint by an inline script with the
CSP nonce.

## 7. API routes

| Route | Does |
|---|---|
| `POST /api/bot` | F9, F9a: validates the link, inserts the meeting under the caps, creates the Attendee bot (now or at `joinAt`). |
| `POST /api/webhooks/attendee` | P4, L1. |
| `GET /api/meetings/[meetingId]/media`, `GET /api/m/[code]/media` | A fresh short-lived recording link (signed audio: six hours public, one hour private; video: Attendee's thirty-minute link). |
| `DELETE /api/meetings/[meetingId]` | F9b. |
| `POST /api/meetings/[meetingId]/commands` | C5. |
| `POST /api/meetings/[meetingId]/link` | A1: rotate, enable or disable (the owner's page reads the link under RLS). |
| `POST /api/meetings/[meetingId]/share-notes` | W4. |
| `POST /api/meetings/[meetingId]/review`, `POST /api/meetings/[meetingId]/snooze` | W1, W3. |
| `POST /api/commands/[commandId]`, `POST /api/commands/[commandId]/rewrite` | C4, C7: approve or dismiss; rewrite with a note. |
| `PUT /api/items/[itemId]/state` | F5: a private tick. |
| `POST /api/highlights`, `PATCH/DELETE /api/highlights/[highlightId]`, `POST/DELETE /api/highlights/[highlightId]/share` | F6, F7. |
| `POST /api/m/[code]/pin` | A1. |
| `GET/DELETE /api/memory`, `PUT /api/memory/[...path]`, `POST /api/memory/onboarding` | M6, M10: export all as a zip, or erase all; save one file with the conflict check; the welcome's one write. |
| `DELETE/PATCH /api/connectors/[provider]`, `GET /api/connectors/slack/channels`, `POST /api/connectors/google/contacts` | X2, X7, M11. |
| `DELETE /api/contacts/[contactId]` | M11. |
| `POST /api/calendar/autojoin` | F9a: the switch. |
| `GET /api/wrap-up` | W1, W3. |
| `POST /api/access-requests` | The landing page's test-user form: inserts the lower-cased address as the visitor; a repeat answers like a first, so the list cannot be probed. |
| `GET/POST /api/jobs/kick`, `GET /api/health`, `GET /api/cron/keepalive` | P2, P5. |

Every route validates its input with Zod and acts as the visitor under RLS or makes its
own access decision before using the secret key. Every route that writes as a visitor
counts the write against the 60-a-minute limit. The exceptions: `POST /api/m/[code]/pin`
has no identity to count, and is bounded instead by the proxy's share read bucket (120 a
minute per client) and the database's PIN-try count; the webhook, the kick route and the
keep-alive authenticate with a secret; the owner-only link, review and snooze functions
do not count against the limit (audit F32).

## 8. Non-functional requirements

| Area | Target | How it is verified |
|---|---|---|
| Load | The long meeting's page shows its main content within 2.5 s on desktop and 4 s on a throttled phone (CPU 4× slower, slow 4G) | Playwright trace on the deployed build |
| Interaction | Seeking, tab and template switches respond within 100 ms; the highlighted line is at most 250 ms behind the audio | Browser performance trace |
| Scale | Smooth at 3 hours, 5,000 turns and 12 speakers | A generated test fixture, never seeded or shown as real |
| Sync | The highlighted line is always the turn under the playhead by the source timings | Unit tests at turn boundaries, plus a listen-through |
| Search | The server answers within 300 ms for 95% of searches over the seed data | Timed requests |
| Accessibility | WCAG 2.2 AA on every journey; axe finds no serious or critical issue; everything works by keyboard alone; player shortcuts off while typing; speakers told apart by more than colour; reduced motion respected | axe in Playwright, a keyboard-only run |
| States | Every view that loads data has loading, empty and error states | Playwright tests that force each one |
| Degradation | Missing AI output or failed media never blanks the page; the transcript stays usable and a retry is offered. No connector: drafts without addresses, `mailto:` instead of a send. No API key: jobs wait and the page says so | Tests that inject each failure |
| Persistence | Time, tab, template and search live in the URL; highlights, clips, ticks and the theme survive reloads | Reload and new-tab tests |
| Availability | Reachable for at least 30 days with no manual action; the daily cron keeps Supabase from pausing | A fresh-visitor check after a deploy and a week later |
| Visitor boundary | RLS stops any identity from reading or changing another's data or the seed data; share tokens have at least 128 random bits and can be revoked; Supabase's anonymous sign-in limit is on | Database tests with two identities |
| Limits | The table in section 9, all enforced in the database or by Supabase so they hold across instances | Rate-limit and database tests |
| Secrets | Credentials live only in Vercel and Supabase settings or untracked env files; never in browser code, the repo or the import output. Only `NEXT_PUBLIC_*` values reach the browser | Search the built code and the repo |
| Headless Claude | Every call has no tools, a JSON schema the API enforces, and content as data; only the database creates jobs | Review of `src/features/processing/`; tests on the job-creating routes |
| AI grounding | Every summary point, decision, action item, learned line and parsed argument cites a real turn of the current transcript; the rest is dropped and reported | Automatic checks with counts in the job report |
| No invented owners, dates or addresses | An owner must be a speaker or named in the cited turn; a due date must be stated there; an address must come from the host's people file, a confirmed card, an invite, the transcript or a Google import, and is shown with its reason | Automatic checks, review of the long meeting |
| AI quality | Of 20 items from the long meeting checked by hand, at least 90% are supported | Manual check, to be recorded in [plan.md](plan.md); not done yet (its status row says so) |
| Approval **[AFK.ai addition]** | No external effect without a `meeting_commands` row in the approved state created by its owner; the database refuses a run job for any other state | Database tests on the functions; a route test that a visitor cannot approve |
| At most once **[AFK.ai addition]** | A command has at most one queued or running job and at most one send; calendar inserts carry client ids; the owner's note and a chat line go out at most once | Database tests on the unique index and gates; adapter tests with a fake `fetch` |
| Token safety **[AFK.ai addition]** | Refresh and bot tokens only sealed in a table no user role can read; one-hour access tokens only in a function's process for one run; never in logs, the browser, cookies or job reports | Tests that read every log call; review |
| Memory privacy and size **[AFK.ai addition]** | Owner-only rules; refused to guests; no content in logs, seed data or share links; deleted with the account; 32 KB a file, 8 KB a file and 32 KB in all inside a prompt | Database tests with two users; e2e that a share link shows no Tasks or memory |
| Concurrency | A user's save over a newer version is refused; AFK's appends never lose a user's edit | A database test interleaving an append and a save |
| Webhook | Signed, idempotent, never creates or revives a meeting, answers within 1 s | Tests with replayed, forged and late events |
| Import resilience | Leased jobs, at most 3 attempts, outages released without an attempt, re-runs create no duplicates | Database tests on claim and complete; running the import twice |
| Processing portability | Processing runs inside the deployed app's functions with configuration only from environment variables; nothing runs on the operator's machine | The keys in Vercel |
| Security headers | A Content-Security-Policy on every HTML response with a per-request nonce and `strict-dynamic`, connections only to this site and the Supabase project, no objects, no framing (media may play from any https origin); `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` on every response | A test on the CSP builder; a deployed check |
| Observability | Every external effect appears on the card, in the job report and in `history/actions.md`; logs carry identifiers and counts only; every keep-alive run leaves a row; the health route shows the queue | A test that reads every log call |
| Retention | Live utterances until ingest or 24 h; bot requests a day; job rows 30 days; guests 30 days unlinked; memory and connectors until the user deletes them | Cleanup steps in the keep-alive; tests |
| Honesty in the call | The bot's name contains "AFK"; it shows no camera image; it speaks only in reply to a sender's command and only when the profile says so; the Send page says the bot announces itself and everyone on the call should consent | Review; a test call recording |
| Privacy | Only licensed or consented recordings, credited in the app; no third-party analytics; the anonymous identity holds no personal data; recordings served only through short-lived links | Review |
| Cost | $0 a month beyond the Claude API spend (cents per meeting: analyze, summarize, parse, learn, answers, romanize; a spending limit on the key); all services on free tiers; Attendee's free bot hours, then $0.50 an hour | Billing pages |

## 9. Limits

| What | Limit |
|---|---|
| Writes per identity | 60 a minute, counted in the database by a trigger on every visitor-writable table; the route limiter fails closed (503) when the check cannot run |
| Highlights per identity | 300; links per highlight 50, revoked ones counted |
| Access requests per identity | 3 |
| Clip length | At most 600 s (`highlights_max_length`, `MAX_CLIP_SEC`); a spoken highlight is 5 to 60 s |
| Commands per meeting | 20 spoken parsed (the next 20 recorded as skipped), 20 typed |
| Rewrites per draft | 3 |
| Bot requests | 1 active per identity (a scheduled bot is not active until it joins), 5 a day per identity, 5 a day per place, `bot_daily_cap` (20) a day in all, guests together at most half; one scheduled bot per calendar event; the auto-join schedules at most 20 a run, 36 hours ahead; a bot can be scheduled at most 90 days ahead |
| The bot in the call | Leaves after 60 s alone in the call, 5 minutes unadmitted in a waiting room, 10 minutes of silence (counted after the first 10), 3 hours at most |
| New guest identities | 30 an hour per address (Supabase's limit) |
| Guest retention | 30 days from creation without linking a Google account |
| A function's processing budget | 270 s; a Claude call up to about 245 s |
| Job attempts | 3; due again after 1 minute, then 4 minutes; the third failure is final |
| Function time limits | 300 s for the runner's routes and the meeting page; `POST /api/bot` 30 s; the Google contacts import 60 s |
| Search | 120 hits a query, 200-character query |
| Recording links | Audio signed for 6 hours (public) or 1 hour (private); video 30 minutes, renewed two minutes before expiry |
| Meetings lists | 20 a page, keyset cursor; `/tasks` shows at most 200 commands |
| Meeting addresses | One per meeting; five wrong PINs lock the code for that visitor for fifteen minutes, and a lock that ran out gives five tries again; fifty wrong PINs on one code, summed over every client that tried it in the last day, switch the link off; tries forgotten after a day; grants last seven days |
| Memory | 9 files of 32 KB per Google user; 8 KB a file and 32 KB in all inside a prompt |
| Connectors | One per provider per user; approved arguments at most 8 KB; email to 5 To and 5 Cc, follow-up to 10 invitees, Slack message 2,000 characters; email and Slack run once, calendar up to 3 attempts; the OAuth state cookie lasts 10 minutes; the Slack channel list reads at most 5 pages |
| Contacts | One row per address per user; a Google import of at most three pages of a thousand per list; at most 50 invitees learned per meeting |
| Public reads per client (a keyed hash of the address, never the address) | A minute: 60 searches, 120 share-link or meeting-address opens, 60 recording-link renewals, 60 health checks; 429 from the proxy before the page runs; 503 if the count cannot be checked |
| Live utterances | 2 KB each; kept until ingest or 24 h |
| Live answers | At most 600 characters in the chat |
| Ingest | The recording-length probe times out after 30 s; consecutive captions of one speaker merge within 1.5 s and up to 600 characters |

## 10. Out of scope, simulated, and accepted limitations

### Not built

Calendar sync beyond the Google connection; roles editable in the app and teams (sign-in
is Google only); CRM integrations; playlists and comments; transcript editing and
trimming; editing AI output text; languages other than English for commands and notes
(Urdu and Hindi speech is transcribed and romanized, the notes stay English); live
highlighting during a replayed call (F10); recording upload (F12); allowed speakers
beyond the sender (C9); the morning brief (M9); the outgoing webhook (X6); GitHub issues;
a face or a talking face for the bot (L4, L5); routines (L6); read tools during drafting
and free-slot search (X3); reading the host's mail; a photorealistic avatar.

### Simulated or demo-only

| Where | What |
|---|---|
| `/send` | "Show me what happens" is a labelled demo of the steps; nothing is sent. |
| The seed meetings' Tasks tabs | Example cards, labelled as examples, approval disabled. |
| `/memory` for a visitor or guest | A labelled demo profile. |

Everything else is real: the bot, the recording, the transcript, the Claude output, the
sends.

### Accepted limitations

- A shared clip of a seed meeting plays the full source file limited to the clip's range;
  the whole file can still be reached, which is acceptable for publicly licensed audio.
- A private meeting's clip is transcript-only.
- A clip's excerpt shows every overlapping turn in full.
- A guest workspace is one browser.
- A bot meeting's video lives in Attendee's storage for as long as Attendee keeps it.
- Who may command AFK is decided by a display name.
- Grounding proves turn ids, owners, dates and addresses, not the rest of an item's
  wording.
- `search_meetings()` is callable directly with the publishable key, where the proxy's
  read limit does not apply.
- Read limits are per address, so many people behind one office address share a count.
- A changed transcript on re-ingest deletes the meeting's commands, including the results
  of ones that ran (the history file keeps its line).
- Small buttons are 32 px tall (`sm`, `icon-sm`), under the 44 px often used for touch.

### Known gaps

Open defects; the ids in brackets are those in [docs/audit.md](audit.md).

| Area | Gap |
|---|---|
| C1, L2 | During the call the tie rule sees only the speakers heard so far: a second matching name that speaks to AFK before the sender does is taken for the sender until then (audit F2). |
| P1, F5 | Re-running analysis keeps a tick only on an action worded the same way; a reworded action starts unticked. |
| F9a | Scheduled bots have no per-user cap. |
| P5 | A purged guest's scheduled bots are not removed at Attendee. |
| F1 | Meeting dates always print in America/Los_Angeles, whatever the viewer's time zone. |
| F2 | The chosen playback speed is not persisted. |

## 11. Seed data

Five real research meetings from the ICSI Meeting Corpus (CC BY 4.0, University of
Edinburgh), human-transcribed, speakers anonymous in the corpus and labelled "Speaker A",
"Speaker B" and so on; audio is the corpus's mixed headset channel re-encoded to AAC under
50 MB.

| Meeting | Length | Speakers |
|---|---|---|
| `bmr007` | 60 min, about 1,070 turns | 8 |
| `bed017` | 39 min | 6 |
| `bmr021` | 37 min | 6 |
| `bro007` | 34 min | 4 |
| `bro015` | 17 min | 6 |

`bmr007` is the long meeting with many speakers and the benchmark for the performance
targets. Titles are the research group's name; dates are the corpus timestamps. The
digit-reading task and non-speech annotations are removed from the transcripts; the
audio is not cut. Credit and the list of changes are shown in the app and in
`data/README.md`. Summaries, chapters, action items and decisions are Claude output,
generated once and committed under `data/ai/`. Nothing is invented.

## 12. Vocabulary

| Thing | Words |
|---|---|
| Product, bot, wake word | AFK.ai; "AFK.ai Notetaker"; "AFK" |
| Sidebar | Quests, Spells, Lore, Loadout, Tutorial, Summon AFK |
| Dashboard, record, cards | Quest log; Player card; spells awaiting your cast |
| Templates | Catch me up, General, Project update, Brief |
| Meeting statuses (database) | scheduled, requested, recording, transcribed, ready, failed |
| Meeting statuses (page) | Scheduled, Requested, Recording, Processing (transcribed, notes being written), Ready, Failed |
| Item kinds, sources | point, action, decision, note; ai, command |
| Command kinds | task, decision, note, highlight, remember, email, followup, remind, slack, ask, recap; and the internal `unknown` ("not understood") |
| Command statuses | detected, applied, proposed, unparsed, approved, running, done, failed, dismissed, skipped |
| Job kinds | ingest_media, detect_commands, analyze, summarize, learn, run_command, answer_in_meeting, notify_owner |
| Memory | The nine paths in 5.3; zones: the user's zone, "Learned by AFK" |
| Levels | Lurker, Attendee, Delegator, Decision-maker, Chief AFK Officer, AFK Legend |
| The mark | An empty chair with an amber line |
