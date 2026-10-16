# Data flows

Every product feature from its first input to its last output, in plain English, as
built. Each flow names what goes in, what happens where, and what comes out. Who may do
each step is in [system-design.md](system-design.md); the tables, functions and pages
are in [architecture.md](architecture.md); the acceptance criteria are in
[requirements.md](requirements.md).

The pieces are:

| Piece | Role |
|---|---|
| The browser | Pages, the player, the transcript sync, Find |
| The web app on Vercel | Pages, route handlers, the proxy, and the job runner inside its functions |
| Postgres on Supabase | The policy engine: every table under Row Level Security, state changes as SQL functions |
| Supabase Storage | The private `audio` bucket for the seed recordings |
| Attendee | The meeting bot; it keeps a bot meeting's video |
| The Claude API | Every AI call (`CLAUDE_MODEL`, default `claude-sonnet-5-5`, on `ANTHROPIC_API_KEY`) |

Code comments cite these sections by number (for example `§28` in
`src/app/api/wrap-up/route.ts`). Keep the numbers stable: add new flows at the end.

## 1. Seed meetings enter the product

**Input:** the owner runs `pnpm import:seed` (`scripts/import-seed.ts`). The inputs are
five meeting files (`data/meetings/<id>.json`: title, date, speakers, turns with start
and end times), the re-encoded audio (`data/audio/<id>.m4a`, under 50 MB) and, when
present, the notes generated earlier (`data/ai/<id>/analyze.json` and `summarize.json`).

The audio is not in the repository: `data/audio/` is gitignored. To run the import
locally, download each meeting's mixed headset channel `<Id>.interaction.wav` from the
ICSI corpus site (https://groups.inf.ed.ac.uk/ami/icsi/), encode it with
`tools/icsi/encode_audio.sh <in.wav> data/audio/<id>.m4a` (macOS `afconvert`, 64 kbps
AAC), then run `pnpm import:seed`. The deployed project already holds the audio.

**What happens:** a meeting whose audio file is missing is refused with a clear error
before anything is written; the others go on and the script exits with a failure. The
file is validated (no inverted or out-of-range times, no unknown speaker, no duplicate
id, no duplicate label), or the whole meeting is refused with the reason. The meeting row
is written. `ingest_transcript()` stores the speakers and turns
in one transaction and skips an unchanged transcript by its hash. The audio is uploaded
to the `audio` bucket under a content-addressed path and the meeting is marked ready. If
the exported notes were made from this exact transcript, `import_generated()` loads them
while a job is waiting for them (a re-import never replaces items, so visitors' ticks
survive) and records the meeting as analysed and summarised; otherwise the notes are
generated the first time the meeting is opened.

**Output:** a ready public meeting (no owner) with its transcript, audio and notes,
visible to anyone.

## 2. Reading a meeting, signed out

**Input:** a visitor opens `/samples` (Tutorial) or `/meetings/<id>`, with an optional
`?t=` moment, `?tab=` and `?template=`.

**What happens:** the proxy (`src/proxy.ts`) runs first on every request: it sets a
Content-Security-Policy with a fresh nonce, refreshes any session and throttles the
public read paths per client (a keyed hash of the address, never the address). The page
reads as the visitor under Row Level Security, which shows public meetings to everyone
and private ones only to their owner. The audio plays through a short-lived signed link
from `GET /api/meetings/<id>/media`: six hours for a public recording, one hour for a
private one, 60 renewals a minute per client.

**Output:** the meeting page: the notes beside the transcript, the player docked below,
chapters, speaker chips, a who-spoke-when scrubber, and the transcript following the
audio. Nothing is written.

## 3. Playback, transcript sync and find

**Input:** the recording's current time (the seed audio, or a bot meeting's video above
the notes), a click on a line, a chapter or a cited moment, a speaker chip, or a word
typed into Find.

**What happens:** all of it is in the browser. The current line is the latest-starting
turn under the playhead (or the last turn that started), computed from the source
timings. Clicking a line seeks the recording. The chosen moment, tab, template and find
term live in the URL, so a refresh or a shared `?t=` link lands at the same place. Find
counts matches among the visible lines and marks them on the timeline. A video's link
lasts thirty minutes (`RECORDING_LINK_SEC`): two minutes before it expires the page
fetches a fresh one and swaps it under the player, which keeps its place and its playing
state.

**Output:** the marked line kept in view, the player at the chosen moment, and a URL
that reproduces the view.

**Known gaps:** the playback speed is not persisted. When a renewed link's expiry fails
to parse, the renewal can repeat without backoff.

## 4. Search across meetings

**Input:** a query in the search box (cut to 200 characters).

**What happens:** the proxy throttles `/search` per client (60 a minute). The page calls
`search_meetings()` as the visitor: full-text search over turns, notes and titles,
ranked, at most 120 hits (`SEARCH_LIMIT`), under the visitor's own readability (a
signed-in person searches only their own meetings; a visitor the samples).

**Output:** results grouped by meeting, each hit with a snippet, the speaker and the
time, opening the meeting at that moment with the term marked and Find started there.

## 5. A visitor becomes a guest

**Input:** the first write a visitor makes: a tick, a highlight, a clip, an access
request, or sending the bot.

**What happens:** the browser signs in anonymously with Supabase once (30 new identities
an hour per address, `anonymous_users` in `supabase/config.toml`) and keeps the session
in a cookie. Every later write is made as that identity. Row Level Security treats the
guest like any owner: their rows are theirs and nobody else's.

**Output:** a private workspace that lives in this browser; the dashboard says so and
offers Continue with Google. A guest who never links is purged after thirty days with
everything they own (flow 24).

## 6. Ticking an action item

**Input:** a click on an action item's checkbox.

**What happens:** `PUT /api/items/<id>/state` with `done`. The route writes the
visitor's own row in `item_states` (the database checks they may read the meeting). The
write counts against the limit of 60 a minute per identity, enforced by a trigger
(`visitor_writes`).

**Output:** the tick, private to that identity, surviving a refresh; "Copy all" copies
the list.

## 7. Highlights and clips

**Input:** a text selection or the playhead, the H key or the Highlight button; later a
nudge of the start or end, a note, or Delete.

**What happens:** `POST /api/highlights` writes the owner's row in `highlights` with the
clip's range. A trigger clamps it inside the recording and caps an identity at 300
highlights. Edits go through `PATCH /api/highlights/<id>` (the route reports a row that
vanished meanwhile) and `DELETE`.

**Output:** the highlight in the panel and on the timeline, kept across refreshes.

## 8. Sharing a clip

**Input:** Share on a highlight.

**What happens:** `POST /api/highlights/<id>/share` inserts a row in `share_links`. The
database mints the 64-character token itself (two UUIDs, trigger
`share_links_mint_token`) and keeps one live link per highlight (at most 50 per
highlight, revoked ones counted). Opening `/share/<token>` calls `get_shared_clip()`,
which returns only the clip's range, its turns, the speakers heard in it, the meeting's
title and date, and, for a public meeting, the audio path. A private meeting's clip is
transcript-only. The proxy throttles share-link opens per client (120 a minute).
`DELETE /api/highlights/<id>/share` revokes the link.

**Output:** a page for someone who was not on the call, showing that minute and nothing
else; a revoked or wrong link shows a clear page.

## 9. Asking to be added as a test user

**Input:** a Gmail address typed on the landing page.

**What happens:** `POST /api/access-requests` inserts the lower-cased address into
`access_requests` as the visitor (a guest identity is made if needed). The table's
trigger counts the write against the visitor's limit, and `cap_access_requests()` allows
three requests per identity (a fourth answers 429). A repeat answers like a first, so
the list cannot be probed.

**Output:** "You're on the list." The owner reads the table and adds the address to
Google's test users ([going-live.md](going-live.md)). No email is sent.

## 10. Continue with Google

**Input:** the Continue with Google button on `/sign-in`.

**What happens:** if the browser already holds a guest identity, Supabase links the
Google account to that same identity, so every row comes along; otherwise a normal
Google sign-in. `/auth/callback` checks the `next` path is on this site and sets the
session cookie. The first time a Google user arrives, `/welcome` writes a `profile.md`
from five skippable questions (`POST /api/memory/onboarding`).

**Output:** a Google user with the same workspace on every device, plus memory files and
connectors, which guests do not get.

## 11. Sending the bot

**Input:** on `/send` (Summon AFK), a Zoom, Meet or Teams link, an optional title, the
language of the call, and the sender's name in the call (required for a guest; a Google
user's name is known).

**What happens:** `POST /api/bot` validates the link
(`src/features/capture/meeting-url.ts`): https only, and the host must be `zoom.us`,
`zoom.com`, `meet.google.com`, `teams.microsoft.com` or `teams.live.com`, or any
subdomain of one. Every link must also have a meeting path (Teams: `/l/meetup-join/…` or
`/meet/<id>`), so a bare host never takes a slot of the day's cap. The route then inserts the meeting row with the sender's names and a keyed
hash of their address (`sender_key`). The database's trigger enforces, under one advisory lock: one active bot
sent now per identity (a bot scheduled from the calendar joins at its time whatever else
is in a call), five a day per identity, five a day per place, and the deployment's daily
allowance (`bot_daily_cap` in `app_settings`, 20), of which guests together may use half,
counted in `bot_requests`. The route
then asks Attendee to create the bot, with the webhook address of the production site,
video recording (MP4, speaker view, 720p) and live transcription on (the platform's
captions, or Deepgram when `ATTENDEE_TRANSCRIPTION` says so), and stores the bot id.

**Output:** a meeting in the Requested state on the person's dashboard, and a bot
joining the call as "AFK.ai Notetaker".

**When the bot id does not reach the row** (audit F3): a failed write of the id takes
the bot back at once (`deleteBot` for a scheduled one, `leaveBot` otherwise) and marks
the row failed. A create that timed out after Attendee took it, or a function cut off
between the two calls, leaves a bot no row knows; its events carry the meeting id it was
made for (`bot_metadata`, signed with the rest), and the webhook's `adoptOrphanBot()`
gives a row still waiting for its bot the id. Any other bot made for the meeting is
taken back: its row failed (the sender was told to send again; the row then records its
id, so a delete purges what it recorded), the meeting was deleted (Attendee is then also
told to forget what it recorded), or the row has another bot. A bot Attendee no longer
has (404, 410) counts as taken back; any other refusal is tried again on the bot's next
event. A create that timed out fails only a row still without its
bot: when the bot's first event placed it meanwhile, the send succeeded.

## 12. During the call: live utterances and answers

**Input:** Attendee posts each caption to `POST /api/webhooks/attendee` as it is spoken,
and a state change when the bot starts recording.

**What happens:** the webhook verifies the HMAC signature over the exact bytes, then
calls `record_live_utterance()`: the line is stored once in `live_utterances` (keyed by
Attendee's idempotency key). If the speaker's name matches the sender and the line
starts with the wake word followed by a question or a recap request, the same call
creates a live command and an `answer_in_meeting` job, and the webhook kicks the job
runner after answering. The runner sends what has been heard so far to Claude, and
nothing of the host's memory: the chat is read by everyone in the call. An answer with no surviving citation becomes "That wasn't
discussed yet." The text is posted to the meeting chat once (`start_job_effect()`: a
retry after a post answers on the card only), and spoken if the profile says "AFK speaks
in calls: yes"; `finish_live_answer()` records it on the command. Twenty seconds after
the question the webhook calls `claim_live_fallback()`. If the answer has not started
(no run holds the job on a live lease, nothing was posted, the command is still
`detected`), the chat gets "I'll answer this after the call." and the job is stamped, so
the answer that comes later lands on the card only. An answer that is merely slow posts
itself and no fallback goes out: one chat line per question, never two.
Someone other than the sender who says the wake word is told once, in the chat, that
only the sender can give commands. The sender is matched as after the call, with the tie
rule over the names heard so far (`live_speaker_names()`, `isLiveSender()`): when a
second speaker under another name also matches, neither gives commands, and the once-a-
meeting notice says why (its own flag, `tie_noticed_at`, migration 55, so a stranger
told earlier does not silence it). A redelivered line is stored once and acknowledged
once.

**Output:** an answer in the chat within seconds, and a card for it on the Tasks tab. A
command of any other kind spoken by the sender gets one chat line saying it was heard
and where its result will be; the command itself waits for the final transcript.

**Known gaps:**

- The tie is decided over the speakers heard so far: a participant under a second
  matching name who speaks to AFK before the sender has said anything is taken for the
  sender until the sender speaks. Two people under one identical name cannot be told
  apart live.

## 13. After the call: the recording comes in

**Input:** Attendee's "ended" webhook.

**What happens:** `mark_bot_finished()` moves the meeting to Transcribed and queues an
`ingest_media` job; the webhook kicks the runner. The runner fetches the transcript and
the recording's link from Attendee. The recording itself is never downloaded: it stays
at Attendee, and the runner reads its length from the MP4 header in a few small range
requests (or from the last thing said when the header is unreadable). It merges
consecutive captions per speaker except where a command starts, romanizes where needed
(flow 34), and calls `ingest_transcript()`, which stores the turns and queues
`detect_commands`. `finish_ingest()` marks the meeting Ready with the bot id as its
`video_ref`, the address the page mints links from. A changed transcript clears the
meeting's notes marks (`analyzed_at`, `summarized_at`).

**Output:** a ready private meeting with its transcript and its video; the processing
view, which refreshes every ten seconds, turns into the meeting page.

## 14. Commands the sender spoke

**Input:** the stored transcript of a bot meeting.

**What happens:** the `detect_commands` job finds the sender among the speakers by name
(or, only when no name is known for the sender, as the only speaker: a lone speaker
whose name is not the sender's is someone else, and gives no commands), then every turn
of theirs that starts with the wake word.
Decisions, notes, highlights and remembers are applied word for word. Tasks, email
drafts, follow-ups and reminders go to Claude in one call with the transcript, and the
parse is grounded: owners must be speakers or named in the sentence, dates and
recipients must be words from it. `apply_commands()` writes the commands
(`meeting_commands`) and what they create (items, a highlight, a dated memory line) in
one transaction and, while the meeting has no notes yet, queues `analyze` and
`summarize`. Past twenty spoken commands, the next twenty are recorded as skipped. A
guest's "remember" is refused with the reason.

**Output:** action items marked "said on the call", decisions, notes, a clip, lines in
memory, and cards on the Tasks tab waiting for approval.

## 15. The notes

**Input:** the transcript, the host's memory files (data, never instructions) and the
items the host stated with commands.

**What happens:** the `analyze` job asks Claude for a headline, chapters, action items
and decisions, each citing turns. The output is validated against a schema the API
enforces and then grounded: a citation must be a real turn, an owner a speaker or a name
in the cited turn, a date only when said there; what fails is dropped and reported.
`apply_analysis()` stores it (`meeting_items`, `item_citations`, `chapters`) and the
meeting records `analyzed_at`. The `summarize` job does the same for the four templates;
`apply_summaries()` stores the points, a line goes into the owner's
`history/meetings.md`, the meeting records `summarized_at`, and for a Google user a
`learn` job is queued. The transcript is the cached first block of every call, so the
four runs read one cached prefix.

**Output:** the Catch me up, General, Project update and Brief summaries, each point a
click from its moment; action items that say "No owner mentioned" when none was;
decisions; chapters.

Re-running the analysis replaces the items; `apply_analysis()` puts each visitor's tick
back on the new action with the same text (case and outer spaces aside, migration 54).

**Known gap:** an action the new analysis rewords is a new item and starts unticked.

## 16. What AFK learns

**Input:** the transcript and the memory files of a Google user whose meeting was just
summarised.

**What happens:** the `learn` job asks Claude for at most ten facts, each citing a turn
and quoting at least three of its words; a line whose quote is not in its turn is
dropped. `append_memory_lines()` adds the kept lines, dated and ending with the meeting
and the moment, under "Learned by AFK" in the people, projects or glossary file, never
above the user's own text, trimming the oldest learned lines first when a file passes
32 KB. A guest gets no learn job.

**Output:** new lines on the Memory page (Lore), each deletable.

## 17. Typed commands on the Tasks tab

**Input:** a slash command typed on a meeting's Tasks tab, with the playhead's moment.

**What happens:** `POST /api/meetings/<id>/commands` parses the command. `/task`,
`/decision`, `/note`, `/highlight`, `/remember` and `/slack` apply at once through
`apply_typed_command()`, which inserts the row and fills it in one transaction under the
meeting's lock (a guest's `/remember` is refused). `/email`, `/followup`, `/remind`,
`/ask` and `/recap` are recorded as detected and a job is queued for the model; the
route kicks the runner. Twenty typed commands a meeting, counted by a trigger under a
lock.

**Output:** the item, clip, memory line or card at once, or a card once the model has
parsed it; `/ask` after the call answers on the card.

A draft typed, or a card sent back, while a `detect_commands` job is already running is
not read by that job (it read its waiting rows when it started), and the one-active-job
index refuses a second; when the running parse finishes, a waiting row changed after it
started queues one more (`requeue_late_drafts()`, migration 53, audit F8).

## 18. Approving a command that leaves the meeting

**Input:** the confirmed details on a card: addresses, the date and time, the message,
the Slack channel; Approve, or Dismiss.

**What happens:** `POST /api/commands/<id>` reads the command as the owner, refuses one
that runs nothing (a failed live answer), validates the details against the kind's
schema, refuses a message carrying a meeting address that is off or was replaced (a
"Share the notes" draft holds the code and PIN as they were), checks the app is
connected and granted (a guest cannot have one), and calls `approve_command()`, which stores the approved arguments and
inserts at most one `run_command` job. The runner loads the connector's sealed token
(bound to its row), refreshes a Google access token, then passes the at-most-once gate
`start_command()` before calling the one adapter: Gmail send, Calendar insert with an id
derived from the command, or Slack post. Email and Slack never retry; calendar retries
find the event already there. `finish_command()` records the result and a line in
`history/actions.md`, and learns the people the card went to as contacts (flow 25).
Dismiss calls `dismiss_command()`, which removes the item or highlight the command
created (a line a remember added to memory stays, for the Memory page); a command
that ran cannot be dismissed, the database refuses it and the route says why.

**Output:** the mail sent, the event created, the message posted, from the owner's own
accounts, with the result on the card and in the history file.

A Slack card is approved with the channel picked on it (`canApproveWith()`: Slack only
has to be connected); the channel saved on the Connectors page is its default.

## 19. Connecting an app

**Input:** Connect Google (Gmail and Calendar, one consent) or Connect Slack on the
Connectors page (Loadout); later Disconnect, or a Slack channel choice.

**What happens:** `/connectors/<provider>/start` sets a signed, short-lived state cookie
bound to the user and the provider (with PKCE for Google) and sends the person to the
provider's consent screen. `/connectors/<provider>/callback` checks the state, exchanges
the code server-side, seals the refresh or bot token with AES-256-GCM under
`CONNECTOR_TOKEN_KEY` and the row's binding, and `store_connector()` writes the row
(`connectors`) and the secret (`connector_secrets`, which no user role can read).
Disconnect (`DELETE /api/connectors/<provider>`) revokes the token at the provider and
deletes the row. The channel picker (`GET /api/connectors/slack/channels`) lists the
workspace's public channels, paged; the choice is saved with `PATCH`.

**Output:** a card saying which account is connected, what AFK may do through it and
when to reconnect; a `tools.md` rendered from it on the Memory page.

## 20. Memory

**Input:** edits on the Memory page (Lore), Download all, Forget everything, the welcome
questions.

**What happens:** a save (`PUT /api/memory/<path>`) calls `save_memory_file()`, one
statement that refuses a version newer than the one being edited (409), so AFK's
appends and the user's edits never overwrite each other. Download all
(`GET /api/memory`) zips the files the user has rows for plus a `tools.md` rendered from
the connectors: between one and ten entries, since a file is stored only once it is
saved or AFK writes to it (the history files appear after AFK's first line). Forget everything
(`DELETE /api/memory`) deletes them all and brings the welcome back. All of it runs as
the user under Row Level Security; memory is Google users' only, on every verb.

The profile and the three skills open as fields. `parseFields()` reads every
"- Key: value" line of the user's zone as a labelled input, a yes/no line as a choice,
grouped under the "##" heading above it, with the template's "(…)" value as the
placeholder it gets back when emptied. `setField()` rewrites that one line and nothing
else, the learned zone included. The Markdown view is a click away and holds the rest
(the guidance, lines without a colon). A link can open a tab with a field focused
(`/memory?tab=profile.md&field=Name%20in%20calls`): the first-run checklist and the
Tasks tab's "couldn't tell which speaker was you" note use it.

**Output:** the files as the user wrote them, with AFK's dated lines below the rule.

**Known gaps:**

- None of the earlier ones: since migration 51 the history files are refused by the
  route, by `save_memory_file()` and by the insert and update policies (audit D8), and a
  file opened from its template is saved as "create", so a row AFK made meanwhile is a
  409, never overwritten (audit F13).

## 21. The dashboard

**Input:** opening `/dashboard` (Quests), with an optional `?after=` cursor.

**What happens:** `list_meetings()` returns twenty of the person's own meetings as the
caller (keyset pagination, newest first), grouped into Today, Yesterday, This week and
so on. The record (`/dashboard/record`, the Player card) counts XP, levels, a streak and
badges from the person's own rows, nothing estimated.

**Output:** the Quest log and the player card; a guest sees the same with the guest
notice.

**Known gap:** meeting dates and the day groups always use `America/Los_Angeles`
(`MEETING_TIME_ZONE`), not the viewer's zone.

## 22. Deleting a meeting

**Input:** Delete on an owned meeting.

**What happens:** `DELETE /api/meetings/<id>` reads the meeting as the owner, tells the
bot to leave if it is still in the call, deletes the row (which cascades to turns, jobs,
items, commands, highlights, share links and the meeting's link), then the audio
object, and tells Attendee to forget the bot's recording and transcript. A job finishing
late finds nothing to publish.

**Output:** the meeting gone from the list, search and any share link.

**Known gap (suspected, untested):** `meeting_commands_turn_fk` (migration 09) has no
delete action, so deleting a meeting that has a spoken command probably fails with a 500
while the cascade removes its turns (audit S1).

## 23. How processing gets run

**Input:** an event that created a job, or a kick. Jobs are created by the seed import,
the Attendee webhook, a typed command, an approval, a rewrite (`rewrite_command()` queues
`detect_commands`), `complete_job()` after a summary (`learn`), the notes trigger (`notify_owner`) and the daily
keep-alive's scheduling. The runner is kicked after the response by the webhook, the
typed-command, approval and rewrite routes, the meeting page while notes or cards are
pending, a pinger on `POST /api/jobs/kick` with `CRON_SECRET`, and the daily keep-alive.

**What happens:** the function answers first, then runs the job runner
(`src/server/jobs.ts`) with the time it has (270 seconds of Vercel's 300).
`claim_job()` leases one job of `processing_jobs` at a time under a token, the kicked
meeting first and live answers and approved commands before notes. A run that ends on
its budget with work still due posts once to the kick route so a fresh function carries
on, until nothing is due. A rate limit or outage releases a job without spending an
attempt; a missing or refused API key releases it for ten minutes and ends the run;
output `complete_job()` refuses, or a transcript `ingest_transcript()` refuses, fails the
job at once; a handler with nothing to do
skips it; anything else counts one of at most three attempts. After a failed attempt the
job is due again after one minute, then four minutes; the third failure is final. A job
that fails for good triggers its follow-ups in one place (`job_failed_for_good()`): a
failed ingest fails the meeting, a failed parse queues `analyze` and `summarize`, a
failed answer or run fails its command. The
meeting page kicks the runner only when something can be claimed: a queued job, or a
running one whose lease has gone stale.

**Output:** every queued job done or failed with a report (tokens, cost, what grounding
dropped), visible on `GET /api/health` as counts.

A parse that fails for good queues `analyze` and `summarize` only when the meeting has no
notes yet, and marks the drafts that waited for it not understood; the owner's note goes
out once per meeting, the first time its notes are written (migration 50, audit F5).

## 24. The daily keep-alive

**Input:** Vercel Cron at 06:17 UTC (`vercel.json`) calling `/api/cron/keepalive` with
`CRON_SECRET`.

**What happens:** one real query keeps the Supabase project from pausing. The write-limit
log, finished jobs (after thirty days), stale live utterances (after a day) and PIN
tries (after a day) are pruned. `sweep_stale_bots()` closes as failed a meeting still
Scheduled, Requested or Recording six hours after its call was due: its scheduled time,
or the request for a bot sent now. A bot leaves a call within three hours, so a meeting
still recording at that point has lost its bot, and a scheduled bot in its call is never
closed. Guests older than thirty days who never continued with Google
are purged: the rows first, then their audio, then Attendee is told to forget their
bots, except a guest whose bot is in a call. The auto-join bots are scheduled (flow 33).
Whatever is still queued is run with the time left. A row in `cron_runs` records the
counts.

**Output:** a project that stays awake and a database that does not grow without bound.

**Known gaps:**

- A purged guest's scheduled bots are not removed at Attendee.

## 25. Who AFK knows: contacts

**Input:** a card approved with addresses on it, the host's people file, the calendar
invite of a meeting AFK is sent to, "Import Google contacts" on the Connectors page,
Delete beside a person on the Memory page.

**What happens:** `finish_command()` passes the confirmed addresses, paired with the
names AFK heard when that is clear (one name and one address, or a name whose words are
in the address), to `learn_contacts()`: a new address is kept in `contacts` with its
source; a known one counts a use and keeps the new name as another name. The import
(`POST /api/connectors/google/contacts`) reads the saved contacts and Google's "other
contacts" through the People API (read-only, names and addresses, at most three pages of
a thousand each) and learns them without counting a use. When AFK is sent to a meeting,
the sender's Google Calendar is read (`src/server/calendar-invitees.ts`) for the event
it was scheduled from, else the event whose link this is, within 36 hours of the send,
and only an event the sender organised or accepted (a stranger's invite would put the
names and addresses they chose in the address book); everyone on that invite but the host and the rooms (at most 50) is learned with the
source `calendar`, unused, with the name the invite gives. The platforms give a bot
names, never addresses, which is why the invite is the source. The people file is parsed
as written on every page, the host's own zone only: a line under "Learned by AFK" holds
what anyone on a call said and the meeting's title, so it is never an address source.

A card resolves each heard name against all of it: the file first, then the most used,
then the most recent. The best guess goes in the field with its reason ("used 3 times,
last 12 Oct", "from your People file", "on a calendar invite with you", "someone you've
written to"), the other matches are one click away, and an unknown name says so and
leaves the field empty. "Everyone" adds the people on the call. Rows are the Google
user's alone (RLS), written only through the function, and deleted by the host on the
Memory page (`DELETE /api/contacts/<id>`).

An address said in the call is taken too: the parser returns it as a normal address,
grounding keeps it only when the transcript or the sentence holds it, written out or
spelled out ("shumail at example dot com"), and the card puts it first, "said in the
call", paired with the heard name it belongs to, the book's guess one click away. The
draft leaves with the host's name in the sign-off and the first recipient's first name
in the greeting, filled in code from the profile's "Name" line (else the name the meeting
was sent under), never a placeholder when the name is known.

**Output:** the To, Copy and Invite fields filled in with a reason the host can see,
never sent to without approval; a list of the people AFK knows, each deletable.

## 26. Skills: how AFK writes for each app

**Input:** edits to `skills/email.md`, `skills/slack.md` and `skills/calendar.md` on the
Memory page. Each template is a settings section of "- Key: value" lines (a value in
parentheses is a placeholder and counts for nothing) and, below it, the guidance AFK
follows in numbered lists: how an email opens, what it holds and how it closes, what
stays out, how "next Tuesday at three", "Friday morning" or "end of day" are read, how a
Slack post finds its channel. The host rewrites any of it.

**What happens:** the parser gets the user's zone of each skill as data, under
`<host_skills>`, and follows its settings and guidance for the form of a draft: tone,
length, structure, subject, greeting and sign-off for an email (with "{first name}" and
"{my name}" filled from the recipient and the profile), the default length, working
hours and days, time zone and the meaning of "morning" for a follow-up or reminder. The
card reads the same lines: "Always copy" pre-fills Copy, "Always invite" and "Default
length" pre-fill an invite, and a "topic: #channel" line in the Slack skill picks the
channel when the message mentions the topic, else the channel chosen on the Connectors
page stands. A Slack post itself is the host's own words after the command word; no
model rewrites it, and the Slack skill says so. The shared notes (flow 31) sign off as
the email skill says, "{my name}" filled from the profile's Name line, else the Google
name. The facts still come from the transcript and the sentence. Migration 36 installs
these templates in every account that has not edited its skills.

**Output:** drafts that read the way the host writes, with the people and channels they
would have chosen, confirmed on the card as before.

## 27. Approvals away from the meeting, and sending a draft back

**Input:** the dashboard or the Tasks page (`/tasks`, Spells); "Rewrite" with a note on
a draft.

**What happens:** the dashboard and the Tasks page load the proposed commands across
the host's meetings with the connectors, the address book and the skills, and render the
same cards as the meeting's Tasks tab, grouped under the meeting each came from; approve,
dismiss and rewrite call the same routes. The sidebar counts them. Rewrite
(`POST /api/commands/<id>/rewrite`) calls `rewrite_command()`, which, for the meeting's
owner and only a proposed or unparsed draft of a kind the model writes, spoken or typed,
puts the command back in the parser's queue with the note in its arguments. The parse
runs after the response, reads every command waiting for it by its id (spoken commands
it recorded before are not parsed again), reads "host's note on the last draft", writes
it again, and the card comes back proposed. The meeting page refreshes itself while a
card is being drafted. Each draft can be sent back three times: `rewrite_command()`
counts them in `meeting_commands.rewrites` and refuses a fourth, and it counts every
rewrite against the visitor's write limit itself, so a call through the Data API is
bounded the same way. The card hides Rewrite after the third; typing the command again
starts a new card under the typed cap.

**Output:** nothing waits behind a meeting page; a draft the host did not like is
written again to their note, one parse per note, at most three per draft.

## 28. The wrap-up: after every meeting

**Input:** a meeting whose notes were just written; the owner opening any page of the
app.

**What happens:** every signed-in page (the app shell, and the owner's meeting page)
asks `GET /api/wrap-up` once: the owner's newest ready meeting with `summarized_at` set
and `reviewed_at` null, read under Row Level Security with its headline, its counts of
action items and decisions, the proposed commands and what their forms need. The dialog
opens over the page: the title and headline, the numbers, the same approvable cards as
the dashboard, and "How was the meeting?" with Good or Not great and a word on why.
Approve, dismiss and rewrite work inside it. Later closes it for that visit only
(session storage), so it returns on the next page or tab until Done, which calls
`POST /api/meetings/<id>/review` and `review_meeting()`: for the owner and a ready
meeting only, it stamps `reviewed_at` and keeps the verdict. Nothing is auto-approved; a
card left behind stays on the dashboard with the badge.

**Output:** no written-up meeting goes unseen and no card waits unnoticed; a verdict on
the notes per meeting, kept for evaluating the notes.

## 29. The note to the owner

**Input:** a meeting's notes being written (`summarized_at` set).

**What happens:** a trigger (`meetings_owner_note`, function `queue_owner_note()`)
queues a `notify_owner` job for a Google user's meeting. The runner reads the profile
("Email me after each meeting: no" ends it), the Google connection with Gmail allowed
(none ends it), the headline and the counts, and sends one short email from the owner's
own address to the same address: what was written up, how many action items and
decisions, how many cards wait for approval, and the link. No Claude. The send passes
`start_job_effect()` first, so a retry after Gmail took the message does not send it
again.

The trigger fires on any change of `summarized_at`, so a meeting whose notes are
written again sends the owner another note (audit S3; see flow 23 for the path where
that is unintended).

**Output:** a note in the owner's inbox within a minute of the notes, so nothing is
written up unseen even when the app stays closed.

## 30. The nudge for stale cards, and approving by keyboard

**Input:** a card that has waited a day; the Spells entry; Cmd/Ctrl+Enter on a card.

**What happens:** with no fresh wrap-up to show, `GET /api/wrap-up` looks for the oldest
proposed card older than a day on a meeting not nudged for a day (`nudged_at`) and
returns it in "nudge" mode: the dialog says "Still waiting for you" without the rating.
Later and Done both call `POST /api/meetings/<id>/snooze` and `snooze_wrap_up()`, so it
asks again tomorrow. The sidebar's badge carries since when the oldest card has waited,
and the Tasks page heading says it. Cmd/Ctrl+Enter in any field submits the form, so
five cards clear in seconds; Enter alone in a one-line field does nothing, since one
address typed and Enter pressed must not send an email (in the rewrite note, Enter
sends the note back).

**Output:** no card waits unnoticed for more than a day; approvals take a keystroke.

## 31. Sharing the notes with the people on the call

**Input:** "Email the notes" (the Share the notes feature) on an owned, ready meeting.

**What happens:** `POST /api/meetings/<id>/share-notes` reads the stored notes as the
owner (the headline, the decisions, the action items with owners and dates, the default
template's points) and builds a plain email, signed off as the email skill says, with
the meeting's address and PIN while the link is on (flow 35). The recipients are the
speakers but the host, by name. It inserts one proposed email card into
`meeting_commands` (no Claude) and the page opens its Tasks tab, where the card resolves
each name to an address as any email card does, and the host approves once (flow 18).

**Output:** the notes in everyone's inbox, from the host's own address, after one
approval.

One card for the notes waits per meeting: a second click, a retried request or another
tab gets the waiting card back (a partial unique index, migration 49, audit F4); once it
is approved, sent or dismissed, the notes can be shared again.

## 32. The first-run checklist

**Input:** a dashboard visit by an owner.

**What happens:** the page checks what exists: Google connected with Gmail and Calendar,
a Slack channel chosen, a "Name in calls" line in the profile, one meeting with a bot.
Each open item is a link to where it is done; the section disappears when all are done.
A guest sees two items: one test call, and continuing with Google.

**Output:** a new account finds its four setup steps in one place, and the list goes
away by itself.

## 33. Joining from the calendar

**Input:** a Google user with Calendar connected opens the dashboard; "Send AFK" beside
a calendar meeting; the switch "Join the meetings I accept"; the daily keep-alive.

**What happens:** the dashboard reads the next seven days of the primary calendar with
the calendar scope already granted and keeps the events with a Zoom, Meet or Teams link
(`listUpcomingEvents()`, the link found in the conference data, the location or the
description), each marked accepted when the user organised it or said yes
(`isAccepted()`); the others read "not accepted". Send AFK posts to `POST /api/bot` with the event's time and id: the
meeting row is Scheduled (`scheduled_for`, `calendar_event_id`, one per event), the
Attendee bot is created with `join_at`, and the processing view shows the Scheduled
step with its time. A scheduled bot does not block another; it joins by itself, and the
webhook carries it through Recording like any bot. One that never joins, or whose call
never reports an end, is swept six hours after its time (flow 24). Delete on a scheduled meeting deletes the bot at Attendee. The
switch (`POST /api/calendar/autojoin`) writes the profile line through the
conflict-checked save; the keep-alive then reads every profile that says yes, lists the
next thirty-six hours for each such user through their own connection
(`src/server/calendar-autojoin.ts`), and schedules a bot per accepted event, at most
twenty a run, under the same daily caps. An invite the user has not accepted (declined,
maybe, or never answered) is never joined on its own: anyone can put an invite on
someone's calendar, and the bot would join a stranger's call under the user's name.

**Output:** AFK is in the meetings on your calendar without the Send page, one click
ahead of time or all of them by a switch.

**Known gap:** there is no cap on how many scheduled bots one user can hold at once;
only the daily caps of flow 11 apply.

## 34. Urdu in a call

**Input:** a speaker who switches to Urdu (or Hindi) during a call that is otherwise in
English. The Send page asks for the language of the call: "English and Urdu" (the
default, remembered in the browser) sends the bot in Deepgram's multilingual mode
(`multi`, Nova-3), which transcribes those words as Hindi in Devanagari script;
"English" sends it in English-only mode with the "AFK" key term boosted, which Deepgram
offers for English alone. A bot sent from the calendar uses the deployment's default
(`ATTENDEE_DEEPGRAM_LANGUAGE`, `multi` when unset).

**What happens:** during the call, a live answer reads the Devanagari as it is (the
answer prompt says so) and answers in English. After the call, the ingest converts the
transcript and, before storing it, hands the turns written in Devanagari or Arabic
script to `romanizeTurns()`: chunks of about 6 KB, each one Claude call with a JSON
schema, run in parallel, at most 60 KB per meeting. The model transliterates into Roman
Urdu ("kaise ho, aaj ka kya agenda hai"), never translating; only the ids asked for are
accepted, one non-empty line each, and only a line that can be the same words
(`isFaithfulRomanization()`): the original's Latin words kept in order, no wake word,
address or link it did not have, at most three times its length. Any other line stays
as transcribed, so an instruction in one turn cannot rewrite another speaker's turn into
a command. A chunk that fails, no time left in the run, or no
API key leaves those turns as transcribed and the ingest goes on; the job's report
carries the counts and the spend. The analysis, the summaries and the command parser are
told the transcript may hold Roman Urdu or Devanagari and write the notes in English,
keeping names and quoted phrases as they appear. Commands stay English: the wake word
and the command grammar are unchanged.

**Output:** a transcript in Latin letters throughout, searchable by its Roman words;
notes in English that cover what was said in Urdu; a sender matched by name whatever the
script of the name.

## 35. A meeting's address

**Input:** a meeting being created; the owner's Share panel on the meeting page (Copy,
Turn the link off or on, New link and PIN); a visitor opening `/m/<code>` and typing the
PIN; "Share the notes".

**What happens:** the trigger `meetings_make_link` runs `make_meeting_link()` after
every meeting insert and writes one `meeting_links` row: a twelve-character code from a
32-letter alphabet (`new_link_code()`, built from `gen_random_uuid()`) and a four-digit
PIN (`new_link_pin()`). The owner reads their row under RLS; nobody writes it from the
browser. `POST /api/meetings/<id>/link` calls `rotate_meeting_link()` or
`set_meeting_link_enabled()` as the owner. Switching the link off suspends every grant
(each read checks the link is enabled); switching it back on re-admits the grants made
earlier, since a grant is bound to the code (audit D20). "New link and PIN" mints a new
code and PIN, which ends every earlier grant, and also switches the link on (audit
D23). A visitor at `/m/<code>` sees a PIN form
whatever the code is. `POST /api/m/<code>/pin` calls `open_meeting_link()` with the PIN
and a keyed hash of the visitor's address: under an advisory lock, a right PIN on an
enabled link of a ready meeting clears the visitor's tries and answers the meeting id; a
wrong one, an unknown code or a switched-off link counts a failure in
`meeting_link_tries`, the fifth locks that code and visitor for fifteen minutes, and the
answer says only "wrong" or "locked". Every fifth wrong try locks, so a lock that ran
out gives five tries again; the count itself goes on, for the budget across clients
(audit F17). The route then sets a grant cookie named for the
code: the expiry and an HMAC under a key derived from the server secret, seven days,
HttpOnly. With a grant, the page calls `get_shared_meeting()` with the service role:
the meeting, its speakers and turns, the summary points and the notes said on the call
(a note the owner typed is left out), nothing else of the meeting and nothing of the
owner. The recording plays through the
same short-lived links, renewed through `GET /api/m/<code>/media`, which checks the
grant and the link. The proxy counts `/m/<code>` and the PIN route in the share bucket
and the media route in the media bucket. The keep-alive forgets tries older than a day
(`prune_link_tries()`). "Share the notes" (flow 31) carries the address and the PIN
while the link is on. Deleting the meeting cascades to its link.

An email draft shares it too: the command parser is given the meeting's link and PIN as
data when the link is on, with the rule to write them into a draft that shares the
recording, the transcript or the notes and never a placeholder; any placeholder such as
"[add meeting link]", "[link]" or "{PIN}" a draft still carries is filled in code before the card is stored.

**Output:** one address per meeting, the owner's to pass on and to take back; a page for
anyone with the link and the PIN that shows the call and nothing else.

**Limits and known gaps:** the code carries 56 random bits (fifteen hex digits of a UUID
v4, one of them the fixed version digit), so it cannot be guessed; the PIN guards a code
that leaked. Besides the lock per visitor, fifty wrong PINs on one code, summed over
every address that tried it in the last day, switch the link off (migration 47); switching it back on clears
its count. Switching
a link off and on again does not end the grants already given (audit D20).
