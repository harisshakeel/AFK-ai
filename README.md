# AFK.ai

Away from keyboard: the bot sits in your meetings so you don't have to.

AFK.ai is an AI meeting notetaker, inspired by [Fathom](https://fathom.ai) and built for a
24-hour "rebuild a live product" exercise. It is designed for the person who wasn't fully
there. Picture an hour-long call with eight people. You get the gist first ("Catch me
up"), then any moment, word for word, with one click from a summary point to the second it
was said. Then AFK does the follow-up work you asked for during the call.

## Try it

- **Live:** https://afk-ai-tau.vercel.app. No account is needed.
- **Code:** https://github.com/harisshakeel/AFK-ai
- **Seed data:** five real research meetings from the
  [ICSI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/icsi/) (CC BY 4.0). One is an hour
  long with eight speakers. Credits and our changes are in [data/README.md](data/README.md).

### A two-minute tour, signed out

1. Open the hour-long, eight-person meeting:
   https://afk-ai-tau.vercel.app/meetings/bmr007.
2. Pick **Catch me up**, then click any point: the player jumps to the second it was said
   and the transcript follows.
3. Press `/` and find a word; press `H` to highlight the moment, then share the clip and
   open the link in a private window.
4. Search across all five meetings from the header.
5. **Send AFK to your call** (top right) with a Zoom, Meet or Teams link: the real bot
   joins, and the notes and any "AFK, …" commands land in your guest workspace.

**Guest or Google.** Everything above works as a guest. Memory, the Gmail, Calendar and
Slack connectors, calendar joining and approvals that send need Google sign-in, and the
Google app is in Testing: only addresses on its test-user list can sign in (ask through
"Get added to test users" on the landing page). **Limits you may meet:** five bots a day
per guest and per address, guests together half of the twenty a day the deployment
allows, three rewrites per draft.

What you can do:

- **Read the summary** in four templates (Catch me up, General, Project update, Brief) and
  switch instantly. Every point plays the moment it came from.
- **Watch or listen with the transcript following along.** Jump by chapter, filter by
  speaker, find words in the meeting, and see who spoke when on the scrubber.
- **Tick action items**, privately, and copy them all.
- **Highlight a moment** (press `H`) and share it as a link that plays only that clip.
- **Search every meeting** and open a result at the moment it was said.
- **Send AFK to a Zoom, Meet or Teams call.** No account needed: a guest's first send
  creates a private workspace in their browser, the real bot joins and records video, and
  the recording, transcript, notes and tasks land there. Continue with Google to keep the
  workspace on every device; guests who never do are cleared after thirty days.
- **Let AFK join from your calendar.** With Google Calendar connected, the week's meetings
  with a link sit on the dashboard; send AFK to one ahead of time, or switch on joining
  every one.
- **Give commands in the call.** "AFK, task for Sam: send the deck by Friday", "AFK,
  decision: …", "AFK, highlight that", "AFK, remember: …" land at once. "AFK, draft an
  email to Sam", a follow-up, a reminder or a Slack post wait on a card for one approval,
  then go out from your own Gmail, Calendar or Slack. "AFK, what did we decide about
  pricing?" is answered in the meeting chat.
- **Pass a meeting on.** Every meeting has an address, `/m/<code>`, behind a four-digit
  PIN, showing the recording, transcript and summary and nothing else of yours.
- **Own a memory.** Nine markdown files AFK reads before working and appends to
  afterwards, on a Memory page you can edit, download and erase.
- **Catch up after the call.** A note in your inbox, and a wrap-up with the cards
  waiting for you on your next visit.

## What is real and what is simulated

| | |
|---|---|
| Transcripts, audio, speakers of the samples | Real ICSI meetings. Speakers are anonymous in the corpus and labelled "Speaker A", "Speaker B" and so on |
| Summaries, action items, decisions, chapters | Real Claude output (the Claude API, Sonnet by default), checked against the transcript. The samples' output is committed in `data/ai/` |
| Meeting bot | Real (Attendee) for anyone, guests included, recording video that plays on the meeting page. "Show me what happens" on the Send page is a labelled demo |
| Commands and approvals | Real on your own meetings. Every sample meeting's Tasks tab shows example cards, labelled as examples |
| Calendar connection | Real: Google Calendar on the Connectors page, the week's meetings on the dashboard, scheduled bots |
| Gmail and Slack sends | Real, from your own accounts, after your approval |
| Memory for a visitor | A labelled demo profile; Google users get their own files |
| Highlighting | Real, on the meeting page during playback, or "AFK, highlight that" in the call. Highlighting during a replayed call is not built |

The full list of decisions, simulated behaviour and known gaps is in
[docs/plan.md](docs/plan.md); the open defects found by a static audit of the code are in
[docs/audit.md](docs/audit.md).

## How it works

```
Vercel (Next.js) ── Supabase (Postgres + RLS, Auth, Storage)
      │                   │ processing_jobs (leased, run by the app's own functions,
      │                   │ chained through /api/jobs/kick; /api/health shows the queue)
      ├── Claude API (no tools, a JSON schema, the transcript as data)
      ├── Gmail, Google Calendar, Slack (only after an approval)
      └── Attendee bot ── signed webhook (/api/webhooks/attendee)
```

There is no worker: the webhook, the meeting page, the typed-command, approval and rewrite
routes, the kick route and the daily keep-alive run the waiting jobs after their
response, each under a lease, within the function's own time limit.

| Document | What it holds |
|---|---|
| [docs/assignment.md](docs/assignment.md) | The brief, verbatim |
| [docs/requirements.md](docs/requirements.md) | What it must do, with acceptance criteria |
| [docs/architecture.md](docs/architecture.md) | The system as built: data model, processing, pages |
| [docs/system-design.md](docs/system-design.md) | Who can do what, security controls, limits, known gaps |
| [docs/data-flows.md](docs/data-flows.md) | Each feature from its first input to its last output |
| [docs/design.md](docs/design.md) | The look: fonts, tokens, pages, accessibility |
| [docs/conventions.md](docs/conventions.md) | Folder structure and code rules |
| [docs/plan.md](docs/plan.md) | Decisions, simulated behaviour, status, next steps |
| [docs/going-live.md](docs/going-live.md) | The owner's setup steps for every outside service |
| [docs/setup.md](docs/setup.md) | The owner's setup steps for every environment variable and CLI login |
| [docs/audit.md](docs/audit.md) | A static audit of the code against these documents, with findings to fix |
| [docs/research.md](docs/research.md) | The Fathom research the product was shaped against |

## Running it locally

You need Node 24, pnpm 10, the Supabase CLI and a Supabase project. Encoding the seed
audio needs macOS (the script uses its built-in `afconvert`).

The seed audio is not in the repository: `data/audio/` is gitignored. The live project
already holds it. To run the import against your own project, first download each
meeting's mixed headset channel, `<Id>.interaction.wav`, from the
[ICSI corpus site](https://groups.inf.ed.ac.uk/ami/icsi/) for the five meetings
(`bmr007`, `bed017`, `bmr021`, `bro007`, `bro015`), and encode each one to 64 kbps AAC:

```sh
tools/icsi/encode_audio.sh <Id>.interaction.wav data/audio/<id>.m4a
```

Then:

```sh
pnpm install
cp .env.example .env.local                    # fill in the Supabase URL and keys
supabase link --project-ref <your-project-ref>
supabase db push                              # apply the migrations
pnpm import:seed                              # load the five meetings and their AI output
pnpm dev                                      # http://localhost:3000
```

The import stops with a clear error if an audio file is missing, before it writes that
meeting. Every environment variable and CLI login is explained in
[docs/setup.md](docs/setup.md).

The bot, the connectors and the AI jobs are optional: without their keys the pages say
the service is not set up and the rest works. The bot reports to the production site
only, so a local server cannot receive its webhooks.

| Command | What it does |
|---|---|
| `pnpm dev` | The dev server on http://localhost:3000 |
| `pnpm check` | Lint, typecheck, format check, unit and database tests (what CI runs) |
| `pnpm e2e` | Playwright journeys on desktop and phone, with an axe accessibility scan |
| `pnpm build` | Production build |
| `pnpm import:seed` | Load the seed meetings and their AI output into Supabase |

## Deploying

Vercel builds `main` on every push. Set the environment variables listed in
[.env.example](.env.example):

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Everything |
| `NEXT_PUBLIC_SITE_URL` | Share links and the address the bot reports to |
| `CRON_SECRET` | The daily keep-alive and `/api/jobs/kick` |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (optional) | The notes, command parsing, learned lines and live answers; without the key AI jobs wait and the page says so |
| `ATTENDEE_API_KEY`, `ATTENDEE_WEBHOOK_SECRET`, `ATTENDEE_API_URL` (optional), `ATTENDEE_TRANSCRIPTION`, `ATTENDEE_DEEPGRAM_LANGUAGE` | The meeting bot |
| `CONNECTOR_TOKEN_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Gmail, Google Calendar and Slack |

Supabase needs the Google provider, the redirect URLs and anonymous sign-ins switched on;
until the Google provider is on, the app hides its sign-in links. Every step, for
Supabase, Vercel, Google Cloud, Slack and Attendee, is in
[docs/going-live.md](docs/going-live.md).

## Seed data credit

The sample meetings come from the ICSI Meeting Corpus (International Computer Science
Institute, Berkeley), distributed by the University of Edinburgh under the
[Creative Commons Attribution 4.0 licence](https://groups.inf.ed.ac.uk/ami/icsi/license.shtml).
The changes we made (transcript conversion, removed digit-reading spans and non-speech
annotations, re-encoded audio, generated notes) are listed in
[data/README.md](data/README.md).
