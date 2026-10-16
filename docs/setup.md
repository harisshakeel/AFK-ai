# Setup: every environment variable, and connecting the folder

A step-by-step guide for the owner. It covers each variable in [.env.example](../.env.example),
where to get its value, where it goes and how to confirm it works, then the terminal
commands that log in and link this folder to GitHub, Vercel and Supabase. The reasons
behind the settings are in [going-live.md](going-live.md); this document is the
clicks.

Rules that apply throughout:

- Copy `.env.example` to `.env.local` once (`cp .env.example .env.local`). `.env.local`
  is gitignored; never commit it, paste from it into a chat, or share a screenshot of it.
- "Public" means the value is compiled into the browser bundle (`NEXT_PUBLIC_*`). Treat
  everything else as secret.
- In Vercel, add each variable under Project → Settings → Environment Variables, tick
  **Production** (and **Preview** if you use previews), then redeploy: Deployments → the
  latest → ⋯ → Redeploy. A variable changed without a redeploy is not live.
- The app validates the environment at startup ([src/lib/env.ts](../src/lib/env.ts)). A
  value that is missing or malformed fails the first request with
  `Invalid environment configuration: <NAME>`, which names the variable to fix.
- No step here runs Node. The seed import (`pnpm import:seed`) is the one exception and
  is marked as such.

## 1. Supabase

Supabase holds the database, sign-in and the seed audio. The project is named `afk-ai`,
region `ap-south-1`. Start at https://supabase.com/dashboard → the `afk-ai` project.

### 1a. `NEXT_PUBLIC_SUPABASE_URL`

- **For:** the project's address. Every database read, sign-in and storage request goes
  there. Without it the app does not start: the environment check throws.
- **Where:** Project Settings (the gear in the left bar) → **API** (under Configuration)
  → **Project URL**. It looks like `https://<project-ref>.supabase.co`. The same `ref` is
  visible in the browser's address bar as `/project/<project-ref>`.
- **Goes in:** `.env.local` and Vercel. Public.
- **Check:** open `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/settings` in a browser. A JSON
  document with an `external` object means the URL is right. A page that does not load
  means the ref is wrong or the project is paused (Dashboard → Restore project).

### 1b. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

- **For:** the key the browser and the request handlers use. Row Level Security applies
  to everything it does. Without it the app does not start.
- **Where:** Project Settings → **API Keys** → the **Publishable key** tab → copy the
  value that starts with `sb_publishable_`. If the project only shows the legacy `anon`
  JWT, press **Create new API keys** on that page first; the app expects the new format.
- **Goes in:** `.env.local` and Vercel. Public.
- **Check:** the live site's meetings list loads signed out. If the key is wrong, the
  samples page shows its failure state and the browser console reports a 401 from
  `supabase.co`.

### 1c. `SUPABASE_SECRET_KEY`

- **For:** the server-only key that bypasses Row Level Security. Used by the seed import,
  the keep-alive, the health route, the webhook ingest and the job runner. Without it the
  app does not start.
- **Where:** Project Settings → **API Keys** → the **Secret keys** tab → **Create new
  secret key** → name it (`vercel`) → copy the value that starts with `sb_secret_`. It is
  shown once. Make a second one named `local` for `.env.local` so each can be revoked
  alone.
- **Goes in:** `.env.local` and Vercel. Secret. Never with a `NEXT_PUBLIC_` prefix.
- **Check:** `GET https://afk-ai-tau.vercel.app/api/health` returns JSON with
  `"queue"` not null. A 503 with `"queue": null` means the server could not read the
  database with this key.

### 1d. Anonymous sign-ins and manual linking

- **For:** guests. A visitor's first write (a highlight, a tick, sending a bot) creates
  an anonymous Supabase user; "Continue with Google" later links that identity so the
  guest keeps what they made. Without anonymous sign-ins every guest write fails with
  "Anonymous sign-ins are disabled". Without manual linking, a guest who signs in loses
  their rows.
- **Where:** Authentication → **Sign In / Providers** → the **User Signups** section:
  turn on **Allow anonymous sign-ins** and **Allow manual linking**. Save. Then
  Authentication → **Rate Limits** → **Rate limit for anonymous users**: 30 per hour.
- **Goes in:** the dashboard only. Also declared in
  [supabase/config.toml](../supabase/config.toml), which `supabase config push` applies.
- **Check:** open the live site in a private window, open a sample meeting, add a
  highlight. It saves without a sign-in prompt. In Authentication → Users a new row
  appears with **Anonymous** in the provider column.

### 1e. The Google provider

- **For:** "Continue with Google". Until the provider is on, the app hides every sign-in
  link (it reads the project's public auth settings and caches them five minutes).
- **Where:** Authentication → **Sign In / Providers** → **Google** → toggle **Enable
  Sign in with Google** → paste the **Client ID** and **Client Secret** from section 2
  → leave **Skip nonce check** off → Save. Copy the **Callback URL (for OAuth)** shown
  on the same panel; it ends in `/auth/v1/callback` and is needed in section 2d.
- **Goes in:** the dashboard. If you prefer `supabase config push`, export
  `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
  in the shell for that one command; they are read by `config.toml` and never stored.
- **Check:** `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/settings` shows `"google": true` under
  `external`. Within five minutes the live site shows "Continue with Google".

### 1f. Redirect URLs

- **For:** where Supabase may send the browser after Google sign-in. A URL not on the
  list is replaced by the site URL, so sign-in appears to "do nothing" or lands on the
  home page without a session.
- **Where:** Authentication → **URL Configuration**:
  - **Site URL:** `https://afk-ai-tau.vercel.app`
  - **Redirect URLs** → Add URL, twice:
    `https://afk-ai-tau.vercel.app/auth/callback**` and
    `http://localhost:3000/auth/callback**`. Keep the `**`; it lets the `?next=` path
    through so sign-in returns to the page it started from.
- **Goes in:** the dashboard (also in `config.toml`).
- **Check:** sign in from a meeting page. You come back to that meeting, not the home
  page, with your name in the header.

## 2. Google Cloud

One OAuth client serves both sign-in (through Supabase) and the connectors (Gmail,
Calendar, Contacts). Start at https://console.cloud.google.com and create or pick a
project named `afk-ai` in the project selector at the top.

### 2a. Enable the APIs

- **For:** the connectors. Without them Connect Google succeeds but the first email,
  event or contacts import fails with `accessNotConfigured`.
- **Where:** left menu → **APIs & Services** → **Library**. Search and press **Enable**
  for each of: **Gmail API**, **Google Calendar API**, **People API**.
- **Check:** APIs & Services → **Enabled APIs & services** lists all three.

### 2b. The consent screen in Testing mode

- **For:** the screen users see. In Testing only listed test users can sign in or
  connect, and refresh tokens for sensitive scopes expire after seven days (the
  Connectors page shows "reconnect by" accordingly). Sign-in is unaffected.
- **Where:** APIs & Services → **OAuth consent screen** (Google now calls this
  **Google Auth Platform**). If it is new: **Get started** → App name `AFK.ai`, support
  email your address → Audience **External** → contact email → agree → **Create**.
  Then **Branding**: App home page `https://afk-ai-tau.vercel.app`, Privacy policy
  `https://afk-ai-tau.vercel.app/privacy`. Under **Audience**, leave **Publishing
  status** as **Testing**.
- **Check:** Audience shows **Testing** and **External**.

### 2c. Test users

- **For:** who may sign in and connect. Anyone not listed sees "Access blocked: AFK.ai
  has not completed the Google verification process".
- **Where:** Google Auth Platform → **Audience** → **Test users** → **Add users** → one
  Gmail address per line → Save. Add yourself first. The landing page's "Get added to
  test users" form writes requests to the `access_requests` table; read them in Supabase
  → Table Editor → `access_requests` and add each address here. The cap is 100.
- **Check:** the added address can press Continue with Google on the live site and
  reaches `/welcome`.

### 2d. The OAuth client, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

- **For:** the client id and secret are pasted into Supabase for sign-in (section 1e)
  and set as these two variables for the connectors. Without the variables the
  Connectors page says the app is not set up, and no email, calendar or Slack command
  can be approved. Sign-in still works if Supabase has the credentials.
- **Where:** APIs & Services → **Credentials** → **+ Create credentials** → **OAuth
  client ID** → Application type **Web application** → Name `AFK.ai web`.
  - **Authorised JavaScript origins:** add `https://afk-ai-tau.vercel.app` and
    `http://localhost:3000`.
  - **Authorised redirect URIs:** add all four:
    1. the Supabase callback copied in section 1e
       (`https://<project-ref>.supabase.co/auth/v1/callback`)
    2. `https://afk-ai-tau.vercel.app/connectors/google/callback`
    3. `http://localhost:3000/connectors/google/callback`
    4. (optional, for a second Supabase project used in development) its own
       `/auth/v1/callback`
  - **Create**. A dialog shows the **Client ID** (ends in `.apps.googleusercontent.com`)
    and the **Client secret**. Copy both now; the secret can also be re-read later from
    the client's page.
- **Goes in:** both values in `.env.local` and Vercel. The id is not sensitive but has no
  `NEXT_PUBLIC_` prefix, so treat the pair as secret.
- **Check:** `/connectors` on the live site, signed in with Google, shows a **Connect
  Google** button instead of "not set up".

### 2e. Scopes

- **For:** what Connect Google may ask for. A scope missing here is refused by Google
  with `invalid_scope` when the Connectors page requests it.
- **Where:** Google Auth Platform → **Data Access** → **Add or remove scopes**. Tick, or
  paste into **Manually add scopes**, then **Update** and **Save**:

  | Scope | Used for |
  |---|---|
  | `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` | Sign-in and knowing which account connected |
  | `https://www.googleapis.com/auth/gmail.send` | Approved emails and the note after each meeting |
  | `https://www.googleapis.com/auth/calendar.events` | Follow-ups, reminders, the week's meetings, calendar bots |
  | `https://www.googleapis.com/auth/contacts.readonly` | Import Google contacts: saved contacts |
  | `https://www.googleapis.com/auth/contacts.other.readonly` | Import Google contacts: "other contacts" |

  The last four appear under **Sensitive scopes**; that is expected and needs no
  verification while the app is in Testing.
- **Check:** press Connect Google on `/connectors`. Google's consent screen lists Gmail
  send, Calendar events and Contacts. Keep every box ticked; the page reports any box
  left unticked.

## 3. The Claude API

### 3a. `ANTHROPIC_API_KEY`

- **For:** the notes, the command parse, the learned memory lines and the live answers.
  Without it AI jobs wait in the queue and the meeting page says so; the player,
  transcript and search still work. The health route reports `"ai": false`.
- **Where:** https://platform.claude.com → sign in → **Settings** (left bar) → **API
  keys** → **+ Create Key** → name `afk-ai-vercel` → pick the workspace → **Add** →
  copy the key (`sk-ant-api03-…`). It is shown once. Make a second key `afk-ai-local`
  for `.env.local` so the two can be revoked separately.
- **Goes in:** `.env.local` and Vercel. Secret. Every call is billed to this key.
- **Check:** `/api/health` on the live site shows `"configured": { "ai": true }`. Then
  on a meeting you own, wait for the notes to appear; the job's row in
  `processing_jobs` (Supabase → Table Editor) shows `done` with token counts.

### 3b. The spending limit

- **For:** a ceiling on what a shared key can cost. The Claude key is shared by every
  user of the deployment.
- **Where:** https://platform.claude.com → **Settings** → **Limits** → **Spend limits**
  → set a monthly limit (for a demo, a small figure such as $20) and a lower
  **notification threshold** with your email. Billing → **Usage** shows the running
  total.
- **Check:** the Limits page shows the figure. Usage reports cents per meeting.

### 3c. `CLAUDE_MODEL` (optional)

- **For:** the model every call uses. Default `claude-sonnet-5-5`; `claude-haiku-4-5`
  is the cheaper choice. Leave the line commented out to keep the default.
- **Where:** the model ids are listed at
  https://platform.claude.com/docs/en/about-claude/models.
- **Goes in:** `.env.local` and Vercel if set. Not secret.
- **Check:** the `model` column of a finished `processing_jobs` row, or the Usage page
  in the Console, names the model you set.

## 4. Attendee

The bot is Attendee's hosted service. Start at https://app.attendee.dev → sign up or
sign in → create a project named `AFK.ai`.

### 4a. `ATTENDEE_API_KEY`

- **For:** creating bots, fetching transcripts, minting the thirty-minute video links,
  posting in the meeting chat and deleting a meeting's data. Without it the Send page
  says the bot is not configured and keeps its labelled demo; the health route reports
  `"bot": false`.
- **Where:** Attendee dashboard → left bar → **API Keys** → **Create API Key** → name
  `vercel` → copy. Shown once.
- **Goes in:** `.env.local` and Vercel. Secret.
- **Check:** with 4b also set, `/api/health` shows `"bot": true` and `/send` shows the
  real form instead of the demo.

### 4b. `ATTENDEE_WEBHOOK_SECRET` and the webhook URL

- **For:** verifying the signature on every webhook Attendee sends (`x-webhook-signature`,
  HMAC-SHA256). Without it `/api/webhooks/attendee` answers 503 and no bot ever reports
  back, so meetings stay at "recording" until the keep-alive closes them.
- **Where:** Attendee dashboard → **Settings** → **Webhooks**. The page shows the
  project's **webhook secret**: copy it exactly as displayed, base64 (letters, digits,
  `+`, `/`, trailing `=`). The app rejects any other shape at startup. You do not need
  to register a webhook URL here: the app passes
  `https://afk-ai-tau.vercel.app/api/webhooks/attendee` to Attendee with each bot it
  creates, built from Vercel's production URL (or `NEXT_PUBLIC_SITE_URL`). It must be
  https, so a dev server on localhost never receives webhooks. If the dashboard insists
  on a project-level webhook, enter the same URL and subscribe to all bot events.
- **Goes in:** `.env.local` and Vercel. Secret.
- **Check:** send a test bot to a meeting you host. The meeting moves from "requested"
  to "recording" within a minute; the bot's row in the Attendee dashboard shows
  delivered webhooks. A `401` in the Vercel function logs for the webhook route means
  the secret does not match.

### 4c. `ATTENDEE_API_URL` (optional)

- **For:** a self-hosted Attendee only. The hosted service, `https://app.attendee.dev`,
  is the default. Leave it commented out.

### 4d. Deepgram, `ATTENDEE_TRANSCRIPTION` and `ATTENDEE_DEEPGRAM_LANGUAGE`

- **For:** better transcripts. By default (`captions`) the bot reads the platform's live
  captions, free but lossy. `deepgram` streams audio through Attendee to Deepgram, far
  more accurate. The Deepgram key lives in Attendee, not in this app.
- **Where:**
  1. https://console.deepgram.com → sign up → **API Keys** → **Create a New API Key**
     → name `attendee` → role Member → **Create Key** → copy.
  2. Attendee dashboard → **Settings** → **Credentials** → **Deepgram** → paste →
     Save.
  3. In `.env.local` and Vercel set `ATTENDEE_TRANSCRIPTION=deepgram`. Optionally
     `ATTENDEE_DEEPGRAM_LANGUAGE=multi` (default; catches Urdu or Hindi in an English
     call) or `en` (English only, with "AFK" boosted as a key term). The Send page can
     override the language per call; the variable is the default for calendar bots.
- **Goes in:** the two variables in `.env.local` and Vercel, not secret. The Deepgram
  key only in Attendee.
- **Check:** bots created after the redeploy show `deepgram` as the transcription
  provider in the Attendee dashboard, and the transcript keeps words that captions
  dropped.

## 5. Slack

### 5a. Create the app

- **For:** posting approved messages to a channel. Without `SLACK_CLIENT_ID` and
  `SLACK_CLIENT_SECRET` the Connectors page offers no Slack.
- **Where:** https://api.slack.com/apps → **Create New App** → **From scratch** → App
  name `AFK.ai` → pick your workspace → **Create App**.

### 5b. Bot scopes

- **Where:** left bar → **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** →
  **Add an OAuth Scope**, three times: `chat:write`, `chat:write.public`,
  `channels:read`. The second lets the bot post in public channels without being
  invited; the third fills the channel picker.

### 5c. Redirect URLs

- **Where:** same page → **Redirect URLs** → **Add New Redirect URL**, twice:
  `https://afk-ai-tau.vercel.app/connectors/slack/callback` and
  `http://localhost:3000/connectors/slack/callback` → **Save URLs**. Slack allows plain
  http only on localhost.

### 5d. `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`

- **Where:** left bar → **Basic Information** → **App Credentials** → copy **Client ID**
  and **Client Secret** (press Show).
- **Goes in:** `.env.local` and Vercel. Secret.
- **Check:** `/connectors` shows **Connect Slack**. Press it, approve, then **choose a
  channel** on the page; a Slack card cannot be approved until a default channel is
  saved. To let other workspaces install the app later: **Manage Distribution** →
  **Activate Public Distribution**.

## 6. The rest

### 6a. `NEXT_PUBLIC_SITE_URL`

- **For:** the site's own origin, used to build share links and meeting addresses, and
  as the fallback for the bot's webhook address when Vercel's production URL is not
  available. Defaults to `http://localhost:3000`.
- **Where:** `http://localhost:3000` in `.env.local`; `https://afk-ai-tau.vercel.app` in
  Vercel. If the project is ever moved to a custom domain, change it there.
- **Goes in:** both. Public.
- **Check:** a share link copied from the live site starts with the live origin.

### 6b. `CRON_SECRET`

- **For:** the bearer token Vercel Cron sends to `/api/cron/keepalive` at 06:17 UTC, and
  that the chain and any pinger send to `/api/jobs/kick`. Without it the cron route
  answers 401 (Supabase would pause after a week idle), the health route reports
  `"cron": false`, and a run that exhausts its budget logs `jobs.chain_unconfigured`
  instead of continuing.
- **Where:** generate it yourself (6d). Vercel reads the variable named exactly
  `CRON_SECRET` and adds the header on its own.
- **Goes in:** `.env.local` and Vercel. Secret. At least 16 characters.
- **Check:** `/api/health` shows `"cron": true`. After the first 06:17 UTC run,
  `lastKeepAlive` is non-null and Supabase → Table Editor → `cron_runs` has a row. To
  test sooner, from a terminal:

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" \
    https://afk-ai-tau.vercel.app/api/jobs/kick
  ```

  `202` means the secret matches; `401` means Vercel has a different value.

### 6c. `CONNECTOR_TOKEN_KEY`

- **For:** the AES-256-GCM key that seals every stored Google refresh token and Slack bot
  token. Without it the Connectors page says the app is not set up, even with the Google
  and Slack variables present. Changing it makes every stored token unreadable, so every
  user must reconnect: set it once and keep it.
- **Where:** generate it yourself (6d): 32 random bytes, base64 (44 characters).
- **Goes in:** `.env.local` and Vercel. Secret. Use the same value in both so a token
  connected locally can be read in production and vice versa, or different values if you
  prefer the two environments isolated.
- **Check:** `/connectors` offers Connect Google. After connecting, the `connectors`
  table shows a row with `status = connected`.

### 6d. Generating random secrets on a Mac without Node

Both use tools that ship with macOS.

```sh
# CONNECTOR_TOKEN_KEY: 32 random bytes as base64 (44 characters, ends in "=")
openssl rand -base64 32

# CRON_SECRET: 32 random bytes as hex (64 characters, URL-safe)
openssl rand -hex 32
```

Paste each into `.env.local`, then into Vercel. The `.env.example` comment suggests a
`node -e` one-liner for the token key; the `openssl` form above gives the same result
without running Node.

## 7. Connecting this folder

Run these yourself in a terminal in `~/Developer/AFK.ai`. Each is a plain CLI command;
none runs project code.

### 7a. GitHub

```sh
gh auth login
```

Logs the `gh` CLI into GitHub. Choose **GitHub.com** → **HTTPS** → authenticate in the
browser with the **harisshakeel** account. A correct result ends with
`✓ Logged in as harisshakeel`.

```sh
gh auth status
```

Shows every logged-in account and marks the active one. A correct result for this repo
shows `Active account: true` beside `harisshakeel`. If another account is active,
switch before any push:

```sh
gh auth switch --user harisshakeel
```

```sh
git remote -v
```

Confirms where pushes go. Both lines should name `github.com/harisshakeel/AFK-ai`.

### 7b. Vercel

The Vercel CLI must already be installed; install it only after a separate decision,
since it is a Node package. If `vercel --version` prints nothing, stop here.

```sh
vercel login
```

Opens the browser to sign in. A correct result: `> Success! GitHub authentication
complete for <email>` or the equivalent for your sign-in method.

```sh
vercel link --project afk-ai
```

Connects this folder to the `afk-ai` project. Confirm the scope (your personal account)
when asked. A correct result: `✅ Linked to <scope>/afk-ai` and a new `.vercel/`
folder, which is gitignored.

```sh
vercel env pull .env.vercel.local --environment=production
```

Downloads the production variables to a separate file so they can be compared with
`.env.local` without overwriting it. A correct result: `Created .env.vercel.local file`.
Open it only to compare which names are present (`grep -o '^[A-Z_]*' .env.vercel.local`);
delete it when done (`rm .env.vercel.local`). It is covered by the `.env*.local`
gitignore pattern, but do not leave it around.

```sh
vercel env add CLAUDE_MODEL production
```

Adds one variable to production. The CLI prompts for the value, so the secret is never
in your shell history. A correct result: `✅ Added Environment Variable CLAUDE_MODEL to
Project afk-ai`. Then redeploy:

```sh
vercel redeploy --prod
```

Rebuilds the current production deployment with the new variables. A correct result
ends with the production URL and `Aliased`.

```sh
vercel env ls production
```

Lists production variable names and when each was set, never the values. Expect the
Supabase three, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY` and whichever
optional ones you set.

### 7c. Supabase

The Supabase CLI is a single binary. If `supabase --version` prints nothing, install it
with Homebrew (`brew install supabase/tap/supabase`) after deciding to; Homebrew is not
Node.

```sh
supabase login
```

Opens the browser to create an access token for the CLI. A correct result: `Finished
supabase login.` The token is stored in the macOS keychain.

```sh
supabase projects list
```

Lists projects you can see. A correct result includes a row named `afk-ai` with its
reference id and region `ap-south-1`. Copy the reference id.

```sh
supabase link --project-ref <project-ref>
```

Links this folder to that project. It asks for the database password (Project Settings →
Database → Reset database password if you no longer have it; the prompt hides what you
type). A correct result: `Finished supabase link.` and `supabase/.temp/` appears
(gitignored). The CLI may warn that `config.toml` differs from the remote; that is
expected until you push the config.

```sh
supabase migration list
```

Shows every migration in `supabase/migrations/` beside what the remote database has
applied. A correct result is two columns, Local and Remote, both listing
`20261016000001` through `20261016000039` with a matching timestamp in each. A row with
a Local value and an empty Remote cell is a migration not yet applied.

```sh
supabase db push --dry-run
```

Prints which migrations would be applied without changing anything. A correct result on
an up-to-date database: `Remote database is up to date.` Otherwise it names the pending
files. Then, to apply them:

```sh
supabase db push
```

Applies the pending migrations in order. A correct result: `Applying migration
<file>...` for each, then `Finished supabase db push.` Run `supabase migration list`
again to see both columns match.

```sh
supabase config push
```

Optional. Sends only the settings declared in `supabase/config.toml` (site URL, redirect
URLs, anonymous sign-ins, manual linking, the anonymous rate limit, and the Google
provider if `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` are exported in the shell). It shows a diff and
asks for confirmation. A correct result: `Finished supabase config push.`

```sh
pnpm import:seed
```

Loads the five seed meetings and their AI output. This one runs Node against
`.env.local`, so it is a separate decision each time; the live project already has the
seed data, so it is needed only for a fresh project. A correct result ends by naming
the five imported meetings, including `bmr007`.

## 8. The final checklist

Work through it in order; each line depends on the ones above it.

1. **The live site loads signed out.** Open https://afk-ai-tau.vercel.app in a private
   window. The landing page and the samples list render, with the five seed meetings
   including the sixty-minute `bmr007`. No sign-in prompt. (Supabase URL and publishable
   key.)
2. **A guest can write.** Open a sample meeting, add a highlight, reload: it is still
   there. (Anonymous sign-ins.)
3. **Google sign-in works.** Press Continue with Google with a test-user address. You
   reach `/welcome`, then your name shows in the header, and the highlight you made as
   a guest is still yours. (Google provider, redirect URLs, OAuth client, test users,
   manual linking.)
4. **The health route reports everything configured.** Open
   https://afk-ai-tau.vercel.app/api/health. Expect status 200 and

   ```json
   "configured": { "ai": true, "bot": true, "cron": true }
   ```

   with `queue` not null. A `false` names the missing variable group: `ai` is the
   Claude key, `bot` is the Attendee key plus webhook secret, `cron` is the cron secret.
   After the first 06:17 UTC run, `lastKeepAlive` is set.
5. **A test bot can be sent.** Start a Meet, Zoom or Teams call you host. On `/send`,
   paste the link and send. The bot joins within a minute and the meeting moves to
   "recording"; when you end the call it moves to "transcribed" and then "ready" with
   notes. The bot leaves on its own after five minutes in a waiting room, ten minutes
   of silence or three hours; each test spends minutes of Attendee's free five hours.
6. **Connectors, if set up.** On `/connectors`, Connect Google with every box ticked and
   Connect Slack with a channel chosen. The page shows both as connected, with a
   "reconnect by" date seven days out for Google while the consent screen is in
   Testing.
