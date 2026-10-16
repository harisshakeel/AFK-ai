# Going live: the owner's steps

What only the owner can do to run AFK.ai on their own accounts, and to widen it from
"works for my test accounts" to "works for other people". Each outside service has a
section. Values that are secrets go into Vercel and `.env.local` only, never into the
repository or a chat. Every variable named here is listed in
[.env.example](../.env.example): the ones the app needs as entries, and the optional ones
that Vercel sets itself (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_REGION`) or that only
`supabase config push` reads (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`,
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`) as commented-out entries.

## 1. Supabase

The project holds the database, sign-in and the audio of the seed meetings. The settings
that live in the repository are in `supabase/config.toml`; `supabase config push` sends
only those, and everything else stays as set in the dashboard.

1. Create a project (the deployed one is in `ap-south-1`, near Vercel's `bom1`). Put its
   URL, publishable key and secret key into `.env.local` and Vercel as
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `SUPABASE_SECRET_KEY`.
2. Apply the schema: `supabase link --project-ref <your-project-ref>`, then
   `supabase db push`. The migrations are `20261016000001_meetings_and_turns.sql` to
   `20261016000039_meeting_links.sql`.
3. Load the samples. The seed audio is not in the repository (`data/audio/` is
   gitignored), so make it first: download each meeting's mixed headset channel
   `<Id>.interaction.wav` from the ICSI corpus site
   (https://groups.inf.ed.ac.uk/ami/icsi/), encode it with
   `tools/icsi/encode_audio.sh <in.wav> data/audio/<id>.m4a` (macOS `afconvert`, 64 kbps
   AAC), then run `pnpm import:seed`. A meeting whose audio file is missing is refused
   with a clear error before anything is written. The deployed project already holds the
   audio.
4. **Redirect URLs.** Authentication → URL Configuration: the site URL
   (`https://afk-ai-tau.vercel.app` for the deployed app) and the redirect URLs
   `<site>/auth/callback**` and `http://localhost:3000/auth/callback**`. The `**` lets the
   `?next=` path through.
5. **Google provider.** Authentication → Providers → Google: on, with the client id and
   secret of the sign-in client (section 4a). From the CLI, `supabase config push` reads
   them from `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. Until the provider is on, the app hides its
   sign-in links (it reads Supabase's public auth settings, cached five minutes).
6. **Anonymous sign-ins and manual linking.** Both on. Guests are anonymous users made on
   their first write, and Continue with Google links the guest identity so they keep
   what they made.
7. **Rate limit.** Authentication → Rate Limits: anonymous users at 30 an hour per IP
   address. A visitor needs one identity, so this only stops abuse.

## 2. The Claude API

Every owned meeting, a guest's included, gets its notes, command parsing, learned lines
and live answers from the Claude API inside the deployed app's own functions. Nothing
runs on the owner's machine.

1. Claude Console → API keys: create a key and put it into Vercel (Production) and
   `.env.local` as `ANTHROPIC_API_KEY`. Without it, AI jobs wait and the meeting page
   says so; the player and transcript still work.
2. Set a monthly spending limit in the Console. Each job's report in `processing_jobs`
   carries its tokens and an estimated cost, and the Console's usage page shows the total.
3. The model is `CLAUDE_MODEL`, default `claude-sonnet-5-5`; `claude-haiku-4-5` is the
   cheaper one. See [API prices](https://platform.claude.com/docs/en/about-claude/pricing).
   The transcript is cached across the calls for one meeting.

How much anyone can spend is bounded by the bot caps (one active bot per identity, five a
day per identity and per place, and `bot_daily_cap`, an `app_settings` row, 20 a day
across the deployment) and the command caps (20 spoken and 20 typed a meeting). Two gaps
remain: scheduled bots have no per-user cap, and `rewrite_command` has no cap.

## 3. Vercel

1. Import the GitHub repository. `vercel.json` builds only `main` (other branches are
   skipped) and runs functions in `bom1`.
2. Environment variables (Production, and Preview if you use previews): the Supabase
   three, `NEXT_PUBLIC_SITE_URL` (the production URL), `CRON_SECRET` (a long random
   string), `ANTHROPIC_API_KEY`, and the optional ones from sections 4 to 6. Redeploy
   after changing any of them.
3. **Cron.** `vercel.json` declares one cron, `/api/cron/keepalive` at 06:17 UTC daily.
   Vercel sends `CRON_SECRET` as a bearer token; without the variable the route answers
   401. The run keeps Supabase from pausing, prunes old rows, closes bots that never
   reported back, purges guests older than thirty days, schedules calendar bots and runs
   whatever is queued. Each run leaves a row in `cron_runs`.
4. The bot reports to the production origin (`VERCEL_PROJECT_PRODUCTION_URL`, else
   `NEXT_PUBLIC_SITE_URL`) at `/api/webhooks/attendee`, never to a preview or a dev
   server. It must be https.

## 4. Google Cloud

AFK.ai uses Google twice: sign-in, through Supabase's Google provider, and the
connectors (Gmail, Google Calendar and Contacts), through `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. One OAuth client can serve both; two clients in separate Google
Cloud projects let sign-in be verified on its own later (section 8).

### 4a. Sign-in

1. APIs & Services → Credentials → an OAuth client of type "Web application".
2. Authorised redirect URI: the callback shown in Supabase → Authentication → Providers →
   Google (it ends in `/auth/v1/callback` on the project's Supabase domain).
3. Authorised JavaScript origins: `https://afk-ai-tau.vercel.app` and
   `http://localhost:3000`.
4. Scopes: only `openid`, `email` and `profile`, so sign-in needs no scope verification
   and its sessions are not cut short in Testing.

### 4b. Connectors: Gmail, Calendar and Contacts

1. APIs & Services → Library: enable the **Gmail API**, the **Google Calendar API** and
   the **People API**.
2. On the client: authorised redirect URIs
   `https://afk-ai-tau.vercel.app/connectors/google/callback` and
   `http://localhost:3000/connectors/google/callback`.
3. OAuth consent screen → Data access: add these scopes, which the Connectors page asks
   for in one consent with offline access:

   | Scope | For |
   |---|---|
   | `openid`, `.../auth/userinfo.email` | Who the account is |
   | `https://www.googleapis.com/auth/gmail.send` | Approved emails and the note after each meeting |
   | `https://www.googleapis.com/auth/calendar.events` | Follow-ups, reminders, the week's meetings and calendar bots |
   | `https://www.googleapis.com/auth/contacts.readonly` | "Import Google contacts": saved contacts |
   | `https://www.googleapis.com/auth/contacts.other.readonly` | "Import Google contacts": Google's "other contacts" |

4. Put the client id and secret into Vercel and `.env.local` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. Generate `CONNECTOR_TOKEN_KEY` (32 random bytes, base64) and
   set it in both places too: it seals every token. Changing it makes every stored
   token unreadable, so users would have to reconnect. Redeploy.
5. On `/connectors`, press Connect Google and keep every box ticked; a box left unticked
   leaves the app without that permission, and the page says so.

### 4c. Testing mode and test users

The consent screen stays in **Testing**. Google's rules for that state
([OAuth 2.0 overview](https://developers.google.com/identity/protocols/oauth2)):

- **At most 100 test users**, and only listed test users can sign in or connect.
- **Refresh tokens expire after 7 days** unless the only scopes are name, email and
  profile. Sign-in is unaffected; the connectors are not. The Connectors page shows
  "reconnect by" seven days after connecting, and a refresh that fails with
  `invalid_grant` marks the connector expired and fails the command with "Reconnect
  Google".

To add people: the landing page's "Get added to test users" form stores each address in
`access_requests` (the app only inserts there; nobody reads it from the browser). Read
the list in Supabase → Table editor, then add each address under OAuth consent screen →
Audience → Test users. Add yourself first.

## 5. Slack

1. https://api.slack.com/apps → Create New App → From scratch, in your workspace.
2. OAuth & Permissions → Redirect URLs:
   `https://afk-ai-tau.vercel.app/connectors/slack/callback` and
   `http://localhost:3000/connectors/slack/callback` (Slack requires https except on
   localhost).
3. Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`.
4. Basic Information → App Credentials: put the Client ID and Client Secret into Vercel
   and `.env.local` as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Redeploy.
5. On `/connectors`, press Connect Slack and **choose a channel**. A Slack card cannot be
   approved until a default channel is saved there, even when the Slack skill names one
   (a known gap).
6. To let other workspaces install it: Manage Distribution → Activate public
   distribution. No directory review is needed.

## 6. Attendee

The bot is Attendee's (https://attendee.dev). Without its key and secret, the Send page
says the bot is not configured and keeps the labelled demo.

1. Attendee dashboard → API keys: create one and set `ATTENDEE_API_KEY`.
2. Settings → Webhooks: copy the project's webhook secret (base64, as Attendee shows it)
   into `ATTENDEE_WEBHOOK_SECRET`. The app gives each bot its webhook URL itself, so no
   webhook needs to be registered by hand. Without the secret the webhook answers 503.
3. `ATTENDEE_API_URL` is only for a self-hosted Attendee; the hosted service is the
   default.

The bot leaves on its own after five minutes in a waiting room, ten minutes of silence
or three hours. Its MP4 recording stays at Attendee and plays through thirty-minute
links; deleting a meeting tells Attendee to forget the recording and transcript.
Scheduled bots of a purged guest are not removed at Attendee (a known gap), so check the
dashboard for strays.

### 6a. Better transcripts: Deepgram

By default the bot transcribes from the platform's live captions: free, but they drop
words. Deepgram, streamed through Attendee, is far more accurate.

1. Deepgram console (console.deepgram.com): create a project and an API key.
2. Attendee dashboard → Settings → Credentials → Deepgram: paste the key. The key lives
   in Attendee, not in this app.
3. Set `ATTENDEE_TRANSCRIPTION=deepgram` in Vercel and `.env.local`, then redeploy. Bots
   created after that use it.

`ATTENDEE_DEEPGRAM_LANGUAGE` is `multi` by default, which catches Urdu or Hindi spoken
in an English call (the ingest writes those turns in Roman Urdu). `en` is English only,
with "AFK" boosted as a key term. Each call can also choose on the Send page; the
variable is the default for calendar bots.

### 6b. Voice in the call (optional)

The bot speaks a reply only when the host's `profile.md` says "AFK speaks in calls: yes",
and only if the Attendee project has Google text-to-speech credentials: Attendee
dashboard → Settings → Credentials → Google Text-to-Speech, with a service-account key
from a Google Cloud project that has the Text-to-Speech API enabled. The voice is
`en-US-Neural2-C`. Without the credentials, answers go to the meeting chat only.

## 7. The pinger and the health check

Jobs run after the responses that create them, and a run that uses its budget with jobs
still due posts to `/api/jobs/kick` to carry on in a fresh function. A job released by an
outage would otherwise wait for the daily keep-alive. Two optional, free additions:

- **A pinger on the kick route,** for pickup within minutes: any free cron or uptime
  service (cron-job.org, UptimeRobot) calling `GET` or `POST
  https://<site>/api/jobs/kick` every five minutes with the header
  `Authorization: Bearer <CRON_SECRET>`. The route answers 202 at once and runs after the
  response; when nothing is due it costs one query. Without `CRON_SECRET` the chain logs
  `jobs.chain_unconfigured` and stops.
- **A monitor on the health route,** `GET https://<site>/api/health`: 200 while the queue
  moves, 503 when a due job has waited over thirty minutes (no kick has reached it: the
  chain is broken or the pinger is missing) or the database cannot be read. It carries
  counts, the last keep-alive and which services are configured, nothing else, so it can
  be public.

## 8. Beyond your own test accounts

### Google: Testing, Production and verification

- **Published, unverified:** any Google user can sign in, but apps requesting sensitive
  scopes show an unverified-app warning and keep a cap of 100 users. Google discourages
  this state ([app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)).
- **Published, verified:** needed for a public app with sensitive scopes. `gmail.send`,
  `calendar.events` and the contacts scopes are **sensitive**, not restricted, so no paid
  security assessment is needed ([Gmail scopes](https://developers.google.com/gmail/api/auth/scopes)).
  Verification asks for a homepage, a privacy policy linked from it and from the consent
  screen (the app has one at `/privacy`), the domain verified in Search Console, a
  demonstration video of the OAuth flow, and a reason for each scope
  ([verification requirements](https://support.google.com/cloud/answer/13464321)).
- With sign-in and the connectors in separate Google Cloud projects, sign-in can go to
  Production with brand verification alone while the connectors stay in Testing.

### The bot and the AI for more people

Attendee's free hours and the Claude key are shared by every user. Widen the user base
only once both are budgeted, and keep the spending limit on the Claude key.

## 9. Free tiers

Figures from each provider's own page; check them before relying on them.

| Piece | Where | Free tier and its limits | Watch for |
|---|---|---|---|
| Web app | [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Non-commercial, personal use only; 100 GB fast data transfer a month; functions up to 300 s; [cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) once a day | Charging users means Pro |
| Database, auth, storage | [Supabase Free](https://supabase.com/pricing) | 500 MB database, 1 GB file storage, 5 GB egress, 50,000 monthly active users, two active projects; paused after a week of inactivity, which the daily keep-alive prevents | 5 GB egress is about 170 full plays of an hour-long sample |
| Meeting bot | [Attendee](https://attendee.dev/pricing) | Five free hours, then $0.50 an hour | Every test call spends minutes of the five hours; the app never copies a recording, so one Attendee drops is gone from the page (the transcript and notes stay) |
| Transcription | Deepgram | New accounts get free credit | Only used with `ATTENDEE_TRANSCRIPTION=deepgram` |
| AI | Claude API | No free tier; cents per meeting | The spending limit in the Console |
| Voice | Google Cloud Text-to-Speech | A monthly free allowance of characters | Credentials go into Attendee, not this app |
| Sign-in, connectors | Google Cloud, Slack | Free | Verification reviews cost time, not money |
