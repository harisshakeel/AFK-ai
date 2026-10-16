# Static audit, 2026-10-16

A read-only audit of the whole repository against its own documents. Nothing was run,
installed or changed; every claim below rests on reading the code and the final
definition of each SQL object (later migrations replace earlier ones). Line numbers are
from the working tree on the day of the audit.

The mandatory obfuscation scan came back clean: no over-long lines hiding payloads in
code or config, no `eval`, no hex or XOR string arrays, no `child_process` in config, no
blockchain endpoints, no `.bat` files, no `.gitignore` change that exposes `.env`. The
one `new Function` is inside a Playwright measurement helper
(`e2e/metrics.spec.ts:193-194`) that runs in the browser page under test.

Severity scale: **critical** = data of one user reachable by another, or money spent
without a gate; **high** = a user-visible failure of a core flow, lost recordings, or an
action taken in the wrong person's name; **medium** = a wrong result, a duplicate
action, or a stuck state that needs a workaround; **minor** = quality, consistency,
accessibility or hygiene with a bounded effect.

Known gaps already listed in the documents were skipped unless worse than described.

---

## Part 1. Do the documents match the code?

### 1a. The documents describe something the code does not do

| # | Document | Says | Code |
|---|---|---|---|
| D1 | `docs/system-design.md` (job lifecycle) | A failed job "retries after 1, 4, then 16 minutes" | `max_attempts` defaults to 3 (migration 02:43) and the backoff is `60*4^(attempts-1)` (migration 37:67-69), so the third failure fails for good; the 16-minute retry never happens |
| D2 | `docs/requirements.md` §12 and §5.2 | Eleven command kinds | The check constraint (migration 20:15-16) and `src/features/processing/detect-commands.ts:47,129,144` also use a twelfth kind, `unknown`, for cards AFK did not understand |
| D3 | `docs/architecture.md` folder table, `docs/data-flows.md` §1, `README.md` "Running it locally" | `data/audio/` holds the seed audio; `pnpm import:seed` runs right after `supabase db push` | `data/audio/` is gitignored (`.gitignore:26`) and not in the repository; `scripts/import-seed.ts:60-65` aborts without it; the README gives no step to encode the audio (`tools/icsi/encode_audio.sh`, macOS only) |
| D4 | `docs/going-live.md:6` | "Every variable named here is listed in `.env.example`" | `VERCEL_PROJECT_PRODUCTION_URL` (read in `src/lib/env.ts:220`), `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` are not in `.env.example` |
| D5 | `.env.example:98` | A comment "Bot requests allowed across all users in 24 hours" | No variable follows it; the cap is the `bot_daily_cap` row in `app_settings` (migration 10:73) |
| D6 | `.env.example:73-74` | The secret key is "used by the import, never by request handlers that act on behalf of a visitor" | The proxy, the job runner and several routes use it after their own access decision (`src/proxy.ts:441-442`, `src/server/db/supabase-admin.ts`) |
| D7 | `.env.example:104-105` | The Google client needs the `gmail.send` and `calendar.events` scopes | X1 and `src/server/connectors/config.ts` also request `contacts.readonly` and `contacts.other.readonly` |
| D8 | `docs/system-design.md` Security controls, "Memory tampering" | `save_memory_file()` "refuses the two history files" | The function (migration 16:10-46) has no path check; the refusal is in `src/app/api/memory/[...path]/route.ts` only. The Data API grant `update (content)` (migration 12:67) with the update policy (migration 30:281-284) lets a Google user overwrite `history/*.md` directly |
| D9 | `docs/system-design.md` Security controls and Limits | "Five wrong tries lock that pair for fifteen minutes" | After the first lock every further wrong try re-locks for fifteen minutes; the count never resets except on a right PIN (migration 39:149-153). See F17 |
| D10 | `docs/system-design.md` Security controls, "Writing around the route handlers" | "Revoke-all, then column grants" on every table | `contacts` is granted without a preceding revoke (migration 33:51-52), so Supabase's default privileges for `anon`/`authenticated` stay in place. See F10 |
| D11 | `docs/system-design.md` Idempotency, "Jobs" | `complete_job()` "publishes only while that claim holds" | Both `complete_job` and `start_job_effect` check the claim token, not `lease_until` (migration 37:29-31, 118-120); the lease is enforced by the next `claim_job()` sweep |
| D12 | `docs/architecture.md` "The daily keep-alive", `docs/data-flows.md` §24 | Sweeps bots "that never reported back after six hours" | For a scheduled bot that did join, the clock runs from `created_at` (migration 35:86), so the sweep closes a live call. See F1 |
| D13 | `docs/architecture.md` data model | `live_replies` is "via meeting" like the readable tables | It has no policy and no user grant (migration 20:64-66): service-role only, and missing from the documented service-only list |
| D14 | `docs/architecture.md` "Grounding", `docs/plan.md` | The senior-engineer skill and the brief for this audit say "more than a quarter failing fails the job" | Not implemented and not in the docs: `groundAnalysis`/`groundSummaries`/`groundLearned` drop items one by one and publish whatever survives; a `summarize` whose every template is dropped stores `{ templates: [] }` as a success (`src/features/processing/jobs.ts:222-233`) |
| D15 | `docs/data-flows.md` §11 | The link is checked "against an exact host list" | `src/features/capture/meeting-url.ts:18-20` accepts any subdomain of the listed hosts, and the Teams entries have no path rule, so `https://teams.microsoft.com/` passes, inserts a row, spends a daily cap slot and fails at Attendee. *Fixed 2026-10-17: Teams links need a meeting path.* |
| D16 | `docs/architecture.md` "Live path", `docs/data-flows.md` §12 | After 20 s an unanswered question gets the fallback line | The fallback also fires when the answer job is merely slow, and the real answer follows it. See F6 |
| D17 | `docs/architecture.md`, `docs/system-design.md` Limits | "A Claude call at most 240 s" | The runner hands the SDK up to about 245 s (`src/features/processing/runner.ts:92,120`; `claude.ts:159` uses the caller's timeout when given) |
| D18 | `docs/architecture.md` "The runner", Errors | "Output the database refuses ends the job at once" | True for `complete_job` only; a transcript `ingest_transcript()` refuses (23514, a turn past the duration) is retried three times, each paying Attendee fetches and romanize calls (`src/features/processing/jobs.ts:344-347`) |
| D19 | `docs/system-design.md` Limits | "Email to 5 recipients" | `src/features/connectors/approve-args.ts:15-16` allows 5 `to` and 5 `cc`, so 10 |
| D20 | `docs/system-design.md` Security controls, "A forwarded or forged PIN grant" | "The owner's off switch or a new link ends every grant at once" | Switching off suspends; switching back on (`set_meeting_link_enabled`) re-admits every grant minted earlier, because grants are bound to the code, not to an enable epoch. Rotation does end them |
| D21 | `docs/system-design.md` Security controls, "Connector token theft" | "A ciphertext moved to another row fails to open" | Not for `v1` ciphertexts: `src/features/connectors/token-crypto.ts:57` sets the AAD only for the current version |
| D22 | `docs/data-flows.md` §20 | "Download all zips the nine files" | `src/app/api/memory/route.ts` zips whatever rows exist plus a rendered `tools.md`: between one and ten entries (history files exist only after AFK's first line) |
| D23 | `docs/data-flows.md` §35 | Nothing says rotation re-enables | `rotate_meeting_link()` (migration 39:86) sets `enabled = true`, so "New link and PIN" on a switched-off link turns sharing back on |
| D24 | `docs/requirements.md` §7 closing sentence | "Every route … counts writes against the limit" | `POST /api/m/<code>/pin` has no identity to count; it is bounded by the proxy's share bucket and `meeting_link_tries`. Worth stating as the deliberate exception |
| D25 | `docs/requirements.md` §6 | "Every page has a `loading.tsx` in the shape of what is coming" | No `loading.tsx` under `connectors`, `dashboard/record`, `m/[code]`, `sign-in`, `welcome`, `privacy`; they fall back to `src/app/loading.tsx` ("Loading…"). `docs/design.md` lists the root fallback for two of these only |
| D26 | `docs/requirements.md` §6 | The mark "is drawn from one set of paths" | `src/app/icon.svg`, `apple-icon.tsx:29` and `opengraph-image.tsx:34` carry their own copies; `icon.svg` has drifted from `logo.tsx` (`M21 38L18 56` vs `M21 38L17 56`, stroke 9 vs 8) |
| D27 | `docs/design.md` Colour tokens | "The only raw colour in a component is the black letterbox" | `text-white` in `speaker-mark.tsx:10`, `notes-panel.tsx:385`, `send-bot-form.tsx:286`, `meeting-processing.tsx:70`, `video-pane.tsx:32`; `manifest.ts:12` `theme_color: "#3453d3"` is a blue that exists nowhere in the palette; brand marks and the Google glyph are undocumented exceptions |
| D28 | `docs/design.md` App shell | The top bar holds the page's action on every page | `/send` renders `Chrome` with no action (`src/app/send/page.tsx:34`); `/dashboard/record` puts a back link there |
| D29 | `docs/design.md` Shared pieces, `docs/conventions.md` primitives | `Input` is a primitive; `PageTitle` carries a primary action | `Input` (`src/components/ui/input.tsx:16`) is imported nowhere (every field uses `inputClass`); no caller passes `PageTitle`'s `actions` prop |
| D30 | `docs/plan.md:19` | "The brief itself is not in this repository" | `docs/assignment.md` holds it verbatim |
| D31 | `docs/plan.md` decisions, `docs/requirements.md` P1, `docs/architecture.md` "The queue" | Job creators: the import, the webhook, a typed command, an approval, the notes trigger | `rewrite_command()` (migration 33) also inserts a `detect_commands` job; only `docs/system-design.md` names it. Likewise the rewrite route calls `kickJobs` (`src/app/api/commands/[commandId]/rewrite/route.ts:47`) but `system-design.md` and `requirements.md` list only the typed-command and approval routes |
| D32 | `docs/conventions.md` folder tree | `src/server/` holds `db/`, `auth/`, `media/`, `connectors/`, `http.ts`, `jobs.ts`, `log.ts` | Also `bots.ts`, `calendar-autojoin.ts`, `calendar-invitees.ts`. The `lib/` line omits `fetch-all.ts`, `prompt-text.ts`, `site.ts`, `visitor-api.ts`, `use-reduced-motion.ts`; `data/` omits `audio/` and `icsi-source/`; `supabase/tests/` names only `harness.ts` (the tests are in `schema.test.ts`); the primitives table omits `Interactions` (`interactions.tsx`) |

### 1b. The code does something the documents do not mention

- **Documents and tests.** `docs/setup.md` (untracked, being written) and `docs/assignment.md` are absent from the document tables in `README.md`, `CLAUDE.md` and `docs/plan.md`. `e2e/screenshots.spec.ts` (`SCREENSHOTS=1`) and `e2e/render-svg.spec.ts` (`RENDER_HTML`, `RENDER_PNG`, `RENDER_WIDTH`, `RENDER_HEIGHT`, `RENDER_SCALE`, `RENDER_TRANSPARENT`) appear in no doc beyond one line in `public/brand/README.md`. No doc lists the thirteen e2e spec files.
- **Environment.** `VERCEL_REGION` is read in `src/server/jobs.ts:746` for the worker id.
- **SQL objects.** Functions `note_meeting_in_history`, `clear_generation_marks`, `can_tick_item`, `item_citations_same_meeting`, `apply_learned`, `set_updated_at`, `memory_files_user_write`, `stale_guest_audio`; triggers `meetings_clear_generation_marks`, `highlights_clamp`, `highlights_cap`, `meeting_commands_cap`, `memory_files_user_write`; indexes `meetings_wrap_up`, `meetings_scheduled`, `highlights_command_idx`, `contacts_owner_rank`, `processing_jobs_running_lease_idx`.
- **Columns and values.** `meetings.host_detected_by` (`name`, `only`), `host_speaker_code`, `refusal_noticed_at`, `sender_names` capped at 12 (migration 23:8); `meeting_commands.live_seq`; `memory_files.updated_by` (`you`, `afk`); `contacts.source` values `approval`, `people_file`, `google_contacts`, `google_other` (only `calendar` is named); `connectors.status` set `connected`, `expired`, `revoked`; `cron_runs` columns `swept`, `purged`, `jobs_pruned`, `utterances_pruned`.
- **Limits not in any limits table.** A clip is at most 600 s (`highlights_max_length`, migration 03:20; `MAX_CLIP_SEC` in `src/lib/time-rules.ts:728`); a bot can be scheduled at most 90 days ahead (`src/app/api/bot/route.ts:22,61`); `/tasks` shows at most 200 commands (`TASKS_LIMIT`, `src/features/commands/tasks-queries.ts:18`); the OAuth state cookie lasts 10 minutes (`oauth-state.ts:19`); the Slack channel listing reads 5 pages (`slack.ts:137`); the bot leaves after 60 s alone in the call (`attendee.ts:90`); the ingest probe has a 30 s timeout (`processing/jobs.ts:252-253`); a live answer is cut at 600 characters (`answer.ts:13`); a spoken highlight is at least 5 s (`parse.ts:146`); captions merge within 1.5 s and 600 characters (`attendee-transcript.ts:21-22`); `POST /api/bot` has `maxDuration` 30 and the contacts import 60.
- **Files.** `src/features/summaries/templates.ts`, `src/features/meetings/transcript-hash.ts`, `src/features/transcript/video-pane.tsx`, `find-matches.ts`, `src/features/commands/demo-cards.ts`, `src/features/connectors/tools-md.ts`, `patches/braces@3.0.3.patch` with `src/lib/patched-braces.test.ts` and the `pnpm.patchedDependencies` / `ignoredBuiltDependencies` entries, `.npmrc` (`strict-dep-builds`), `.vercelignore`, `.prettierignore`.
- **Behaviour.** The Tasks tab's "Try again" for failed retry-safe commands (`tasks-tab.tsx:232-243`), "Open in Mail" and "Copy draft" (`tasks-tab.tsx:946-980` at the audit; `EmailActions` in `card-actions.tsx` since the split), the "What you can say" disclosure, the host-line notice about which speaker's commands were taken, and the notes panel's "AFK heard N commands" status line are not in `docs/design.md`. The wrap-up's second "nudge" mode and its day-long snooze are in `data-flows.md` §30 but not in `design.md`. The processing view's Delete button and its "closed after six hours" line are undescribed. A re-summarised meeting sends the owner a second note (`queue_owner_note` fires on any change of `summarized_at`, migration 35:24-31). A bot whose id was never stored is unreachable by every webhook (see F3). A typed draft submitted during a running parse waits for an unrelated later parse (see F8).
- **Design tokens** present but not in the `design.md` token table: `--color-shine`, `--shadow-accent`, `--shadow-accent-hover`, `--shadow-glow-signal` and the `-hover`/`-down` shadow variants.

### 1c. The documents disagree with each other

| Topic | One says | The other says |
|---|---|---|
| Who creates jobs and who kicks | `system-design.md` includes "a rewrite"; `architecture.md` includes the rewrite route among kickers | `plan.md`, `requirements.md` and `architecture.md`'s queue section omit the rewrite as a creator; `system-design.md` and `requirements.md` omit the rewrite route as a kicker |
| `loading.tsx` | `requirements.md` §6: every page has one | `design.md`: some routes use the root fallback |
| The brief | `plan.md:19`: not in the repository | `docs/assignment.md`: saved verbatim |
| Known gaps | `design.md` lists "small buttons are 32 px tall, under 44 px" | `plan.md`, `system-design.md` and `requirements.md` do not |
| Accepted limitations | `system-design.md` lists "`search_meetings()` is callable directly", "read limits are per address", "a changed transcript deletes the meeting's commands" | `requirements.md` §10 and `plan.md` do not |
| Retry schedule | `system-design.md`: 1, 4, then 16 minutes | `system-design.md` and `requirements.md`: at most 3 attempts (which makes the 16-minute step unreachable) |
| Seed audio | `architecture.md` and `data-flows.md`: part of `data/` | `.gitignore` and `scripts/import-seed.ts`: not in the repository |
| Dashboard order | `requirements.md` §6: "the cards awaiting approval first" | `design.md` and the code: guest notice, checklist, calendar week, then the cards |
| Command kinds | `requirements.md` §12: eleven | The schema and `detect-commands.ts`: twelve, with `unknown` |

---

## Part 2. Confirmed findings, by severity

No finding reached **critical**: no path was found by which one user reads or writes
another's rows, and every paid action sits behind a cap. The confirmed findings follow.

### High

**F1. The daily sweep closes a scheduled bot's call while it is in progress, and the recording is then never ingested.**
`supabase/migrations/20261016000035_notify_nudge_schedule.sql:86`
```sql
where (status in ('requested', 'recording') and created_at < now() - p_older_than)
   or (status = 'scheduled' and coalesce(scheduled_for, created_at) < now() - p_older_than)
```
A scheduled row is created days ahead. At event time the webhook moves it to `recording`, but `created_at` is already older than six hours, so the next keep-alive (06:17 UTC, or any caller) marks it `failed` mid-call. After that `mark_bot_finished()` (35:104, matches `scheduled`/`requested`/`recording` only) returns null, so the real end-of-call event is treated as a replay and no `ingest_media` job is queued; `record_live_utterance()` (29:289-290) drops every live line. The recording stays at Attendee but the meeting never gets its transcript or notes. The test at `supabase/tests/schema.test.ts:2710` covers only rows still in `scheduled`.
*Fix:* time `requested`/`recording` rows from when the bot was due or started: `greatest(created_at, coalesce(scheduled_for, created_at)) < now() - p_older_than`, or stamp a `started_at` on the move to `recording`. Add a database test: scheduled yesterday, recording now, sweep, untouched.
*Status (2026-10-16):* fixed in `20261016000040_audit_fixes.sql`, which times every bot row from `coalesce(scheduled_for, created_at)`; tested in `supabase/tests/schema.test.ts`, "fixes from the audit".

**F2. During the call, anyone whose display name contains the sender's name is treated as the sender.**
`src/app/api/webhooks/attendee/route.ts:89-91` and `src/features/commands/sender.ts:41-50`
```ts
const isHost = matchesSender(utterance.data.speaker_name ?? "", meeting?.sender_names ?? []);
...
const [shorter, longer] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
return shorter.every((token) => longer.includes(token));
```
`matchesSender` is a token-subset test. If the sender sent AFK as "Haris" and a participant is named "Haris Khan", that participant's "AFK, what did we decide about pricing?" becomes a live command (`record_live_utterance` with `p_is_host = true`, migration 29:34), an `answer_in_meeting` job, and an answer posted in the chat in the sender's name; the same participant also gets "Heard" acknowledgements. The post-call parser is stricter: `findSender` (sender.ts:60-63) treats two matching speakers as nobody. The accepted limitation "who may command AFK is decided by a display name" covers a deliberate rename; this needs only a shared first name.
*Fix:* apply the tie rule live. Keep a `sender_speaker_uuid` on the meeting set on the first unambiguous match, or count distinct matching speaker names in `live_utterances` for the meeting and treat two as nobody.
*Status (2026-10-17):* fixed, by names rather than speaker ids (a sender who rejoins gets a new id but keeps the name): on a line addressed to AFK the webhook reads the names heard so far (`live_speaker_names()`, migration 52) and `isLiveSender()` applies the tie rule, so a second matching name makes nobody the sender, and the once-a-meeting notice says why. The live answer's prompt also no longer carries the host's memory (security review #11). Left: a matching name that speaks before the sender does is obeyed until the sender speaks. Tested in `sender.test.ts`, the webhook's route test and the database suite.

**F3. A bot can be created at Attendee without its id ever reaching the row, leaving a paid bot in a call that AFK cannot see, and inviting a second bot.**
`src/server/bots.ts:116-120`
```ts
await admin.from("meetings").update({ bot_id: bot.id }).eq("id", meetingId).in("status", ["scheduled", "requested"]);
```
The update's error is not checked (every other write in the file is). Three paths leave `bot_id` null while the bot exists: the update failing; `createBot` timing out at 20 s (`attendee.ts:132`) after Attendee accepted the POST, in which case the catch marks the row `failed` yet the bot joins and records; the function being cut off between the two calls. With `bot_id` null every webhook for that bot is `matched: false`, the sweep fails the row after six hours, `delete_data` is never called (the purge collects `bot_id`), and the owner's retry makes a new row with a new uuid, hence a new `deduplication_key`, so a second bot joins the same call.
*Fix:* check the update's error and on failure call `leaveBot`/`deleteBot`; have the webhook fall back to `bot_metadata.meetingId` (Attendee sends it; see the payload in `attendee.test.ts:21`) to attach a bot id to a row that has none; consider a dedup key from `(owner, meeting_url, day)` rather than the row id.
*Status (2026-10-17):* fixed: `sendBot()` checks the id write and, when it fails, takes the bot back (`deleteBot` for a scheduled one, `leaveBot` otherwise) and marks the row failed. A bot no row knows (a create that timed out after Attendee took it, a function cut off between the calls) is found by the webhook through `bot_metadata.meetingId`: `adoptOrphanBot()` gives a waiting row its id, and takes back every other bot made for the meeting: a failed row's (then recording its id, so a delete purges it and a retry's second bot is the only one left), a deleted meeting's, one beside the row's own bot; a bot Attendee says is gone counts as taken back. A create that timed out fails only a row still without its bot, so one the webhook placed meanwhile is a successful send (re-score 2026-10-17). Tested in `src/server/bots.test.ts` and the webhook's route test. The dedup key is still the row id.

### Medium

**F4. "Share the notes" creates a fresh card on every click, and each card can be approved and sent.**
`src/app/api/meetings/[meetingId]/share-notes/route.ts:100-113`. The insert is unconditional; nothing de-duplicates on `args->>'sharedNotes'`. Two clicks before the response, a retried request or two tabs give two proposed email cards to everyone on the call; approving both sends the notes twice. The 20-typed-command cap is the only bound.
*Fix:* before inserting, select an existing `proposed` email card with `args->>'sharedNotes' = 'true'` for the meeting and return its id, or move the insert into a SQL function under the meeting's row lock as `apply_typed_command()` does.
*Status (2026-10-17):* fixed: a partial unique index (migration 49) keeps one waiting notes card per meeting, and the route returns it on a repeat; tested in "sharing the notes (audit F4)".

**F5. A parse that fails for good re-generates notes that already exist: a second owner email, a second history line, lost ticks.**
`supabase/migrations/20261016000030_simplify.sql:30-34` (`job_failed_for_good`)
```sql
elsif p_kind = 'detect_commands' then
  insert into public.processing_jobs (meeting_id, kind) values (p_meeting_id, 'analyze'), (p_meeting_id, 'summarize') on conflict do nothing;
```
`detect_commands` jobs are also queued on meetings whose notes are written (a rewrite, migration 33:162-164, or a typed model-backed command). When such a parse fails for good (three attempts, or one `rejected`), `analyze` and `summarize` are queued unconditionally: `apply_analysis` replaces the AI items (cascading `item_states`), `note_meeting_in_history` appends a second line, `summarized_at` changes and `queue_owner_note` (35:24-31, fires on any change) queues a second `notify_owner`, a second email from the owner's Gmail. `start_job_effect()` de-duplicates within one job only.
*Fix:* guard the re-queue with `not exists (select 1 from public.meetings where id = p_meeting_id and summarized_at is not null)`, and make `queue_owner_note` fire only when `old.summarized_at is null`.
*Status (2026-10-17):* fixed: migration 50 queues the notes only when there are none, marks the drafts that waited not understood, and sends the owner's note once per meeting; tested in "a parse that fails for good (audit F5)".

**F6. The 20-second fallback line is posted while the answer job is still running, so a slow answer produces two chat lines.**
`src/app/api/webhooks/attendee/route.ts:172-181`. The fallback checks the command's status, which stays `detected` until `finish_live_answer()` runs. The answer job may take up to 120 s of Claude time plus context load plus the kick's own start, so any answer slower than about 20 s yields "I'll answer this after the call" followed by the real answer. Nothing records that the fallback went out, and `answer-in-meeting.ts:84-91` posts whenever the gate says go.
*Fix:* have the fallback check the job (skip when a `processing_jobs` row for the command is `running` with a live lease) and stamp the command when the fallback is posted so the late answer goes to the card only or is prefixed.
*Status (2026-10-16):* fixed in `20261016000041_live_fallback_once.sql`: `claim_live_fallback()` and `start_job_effect()` share the answer job's row lock and its `effect_at` stamp, so the fallback goes out only when the answer has not started and the answer then lands on the card only; tested in `supabase/tests/schema.test.ts`, "fixes from the audit".

**F7. The welcome can never complete once any context or skills file exists without `profile.md`.**
`src/app/api/memory/onboarding/route.ts:59-73`. Seven rows go in one insert; a 23505 on any of them aborts the whole statement, `profile.md` is never written, and the route still answers `{ ok: true }` ("two tabs finishing at once"). The welcome flow then navigates on, the next sign-in (`auth/callback` checks `hasProfile()`) and every `/welcome` visit send the user back into the questionnaire. This happens when `context/people.md` already exists: a learn job for a meeting summarised before the welcome was finished (a guest who sent a bot, then continued with Google), a `PUT` from the Memory page, or a learn job landing after `DELETE /api/memory`.
*Fix:* insert `profile.md` on its own (409 or ok on conflict), then the other paths with `upsert(..., { onConflict: "owner_id,path", ignoreDuplicates: true })`; or re-check `hasProfile()` after a 23505 before answering ok.
*Status (2026-10-17):* fixed: `profile.md` is written on its own, then the templates with an upsert that keeps any file AFK already wrote; the database side is tested in "the welcome's memory files (audit F7)".

**F8. A typed draft or a rewrite submitted while a parse is already running is never parsed.**
`src/app/api/meetings/[meetingId]/commands/route.ts:130-143`. The unique index `processing_jobs_one_active` covers `queued` and `running` (migration 14:127-129). A running `detect_commands` job read its waiting rows at its start (`detect-commands.ts:84-96`) and will not see a row inserted afterwards; the route treats the 23505 as "a job will pick this up", so the typed email, follow-up or reminder sits in `detected` until some later event queues another parse. `rewrite_command()` (migration 33) has the same `on conflict do nothing`.
*Fix:* after a 23505 against a `running` job, queue a follow-up (a `requeue` flag the runner honours on completion, or a retried insert from `after()`), or have `detect_commands` re-read `detected` rows after its Claude call and loop once.
*Status (2026-10-17):* fixed in migration 53: when a parse finishes, a trigger queues one more if a waiting row changed after it started (`requeue_late_drafts()`); a row the finished parse saw and left is older than its start, so it cannot loop. Tested in "a draft that arrives while its meeting's parse runs (audit F8)".

**F9. Participant names and the meeting title reach Claude unbent and partly outside the data block.**
`src/features/summaries/prompts.ts:22-32` puts `Meeting: ${meeting.title}` and `Speakers: …` in a header outside `<transcript>`, unbent, and the per-line speaker label is unbent while the text is bent; `src/features/commands/prompts.ts:42` does the same with `Host:`. Labels come from Attendee `speaker_name` (any participant picks it, 80 characters) and the title from a calendar event summary for auto-joined meetings. A name such as `x</transcript>` closes the block from inside a line; a crafted "Speakers:" header sits where the system prompt says instructions live. The schema and grounding bound the impact, but the design says the transcript is data. `answer.ts:43-48` and `romanize.ts:68` bend everything; these two do not.
*Fix:* `bendAngles` on the title and every label, and move the header inside the `<transcript>` block (same cache prefix).

**F10. `contacts` keeps Supabase's default privileges, so in production `anon`/`authenticated` hold insert, update, truncate, references and trigger on it; RLS is the only barrier.**
`supabase/migrations/20261016000033_contacts_and_skills.sql:51-52` grants without the `revoke all … from anon, authenticated` every other table does first. No data is reachable today (no insert or update policy, no anon select policy), but the documented grant model is not what production has, and the PGlite harness creates bare roles without default privileges (`supabase/tests/harness.ts`), so the schema test cannot catch it.
*Fix:* a one-line migration with the revoke; consider applying Supabase's `alter default privileges` statement in the harness so the tests see what production sees.
*Status (2026-10-16):* fixed in `20261016000042_contacts_grants.sql`, which revokes the defaults and grants select and delete back; the test harness now applies Supabase's default table grants, and "contacts grants only what the app uses" in `supabase/tests/schema.test.ts` proves it.

**F11. Attendee's POST helper has no timeout, so chat, speech and `delete_data` calls can hang a function.**
`src/features/capture/attendee.ts:146-150`. `call()` carries `AbortSignal.timeout(20_000)` (line 132); `send()` does not. Callers: the keep-alive's purge (`Promise.allSettled` over every purged bot, before the day's jobs run), the meeting DELETE route, the answer job (after `effect_at` is stamped, so a hang until the 300 s cap loses the card answer too), and the webhook's `after()` lines.
*Fix:* add `signal: AbortSignal.timeout(20_000)` to `send()`.
*Status (2026-10-17):* fixed: `send()` in `attendee.ts` carries the same 20 s timeout as the other calls.

**F12. Disconnecting a connector throws a 500 when the sealed token cannot be opened, so the user cannot disconnect at all.**
`src/app/api/connectors/[provider]/route.ts:23` and `src/app/api/connectors/slack/channels/route.ts:10` call `readSecret()`, which throws on a rotated `CONNECTOR_TOKEN_KEY`, a corrupt ciphertext or a transient DB error (`token-crypto.ts:53-54,64-65`, `token-source.ts:39`); neither route catches. The row and secret stay and the page shows it connected. The contacts route catches the same call, so this is an inconsistency.
*Fix:* `readSecret(...).catch(() => null)` in DELETE (log, skip the provider revoke, still delete); 502 or 404 in the channels route.
*Status (2026-10-17):* fixed: DELETE logs an unreadable token, skips the provider revoke and still deletes; the channels route answers 502 with a way to reconnect.

**F13. A memory file opened as the template can silently overwrite AFK's learned lines.**
`supabase/migrations/20261016000016_save_memory_file.sql:31` with `src/features/memory/memory-page.tsx:65,98`. A file with no row yet is opened with `updatedAt: null`; the PUT sends null; the function's `(p_expected_updated_at is null or updated_at = p_expected_updated_at)` makes null mean "overwrite whatever is there". If `append_memory_lines()` created the row meanwhile (migration 25:106-109), the user's save replaces it with no 409.
*Fix:* when the expected version is null, only insert and raise `P0006` if a row exists; or send a sentinel for "new file" from the page.
*Status (2026-10-17):* fixed with D8 in migration 51: no expected version means "create" (a row made meanwhile is P0006), and the history files are refused by `save_memory_file()` and by the insert and update policies; tested in "memory saves as one statement".

**F14. Loading skeletons drop the application frame, so every navigation jumps.**
`src/app/dashboard/loading.tsx:10`, `tasks/loading.tsx:5`, `memory/loading.tsx:5`, `send/loading.tsx:6`, `search/loading.tsx:6`, `src/features/meetings/meeting-list-skeleton.tsx:6`. `AppShell`/`Chrome` is rendered by each `page.tsx`, not by a layout, so while `loading.tsx` shows, the sidebar, search bar and theme toggle vanish and the skeleton is laid out at a different width. There is also no `error.tsx` in any segment: every route, the full-viewport meeting page included, relies on `src/app/error.tsx`, which replaces page and shell with a bare card.
*Fix:* move the shell into a route-group layout (for example `src/app/(app)/layout.tsx`) so `loading.tsx` and an `error.tsx` render inside it.

**F15. The meeting page ignores a new `?tab=` when you are already on that meeting, and then clobbers it.**
`src/features/meetings/meeting-view.tsx:78` seeds `tab` from `props.initialTab` once; the effect at :131-133 writes the state back to the URL. `MeetingView` is keyed by meeting id, so a soft navigation to the same meeting with `?tab=tasks` (the wrap-up dialog's card heading links there, `approval-cards.tsx:49`) changes nothing and the URL loses the parameter. `share-notes-button.tsx:19-21` already works around it with `window.location.assign`. Related: the wrap-up's "Open the meeting" links (`wrap-up.tsx:189,241`) do not snooze, so the meeting page mounts its own `WrapUpPrompt` and the same dialog covers the notes again.
*Fix:* derive `tab`, `template` and `q` from `useSearchParams()` or adopt prop changes during render as `seenHighlights` does (:92-96); snooze in an `onClick` on both links.

**F16. Keyboard shortcuts keep firing behind the modal wrap-up dialog and on key auto-repeat; holding H creates a burst of highlights.**
`src/features/meetings/meeting-view.tsx:338-370` bails only for text fields and for Space on a focused control. While the native `<dialog>` is open, K, J, L, H and "/" act on the player behind it, and "/" focuses the hidden find input. There is no `event.repeat` guard and `createHighlight` (:199-216) has no in-flight flag, so a held H posts one highlight per repeat with a toast each.
*Fix:* ignore `event.repeat` for H, K and Space; ignore keys when `document.querySelector("dialog[open]")`; keep a pending flag in `createHighlight`.
*Status (2026-10-17):* fixed: the shortcuts ignore key repeat and any open dialog, and `createHighlight` keeps an in-flight flag (`meeting-view.tsx`).

**F17. After a PIN lockout expires, every later wrong try re-locks for fifteen minutes.**
`supabase/migrations/20261016000039_meeting_links.sql:149-153` increments `failures` for ever; the row is removed only on success or by `prune_link_tries()` after a day with no tries (and `updated_at` is refreshed on every try). A legitimate holder who waited out the lock gets one wrong try before another lock. The docs say five tries per lock.
*Fix:* `failures = case when locked_until < now() then 1 else failures + 1 end`, and compute `locked_until` from that.
*Status (2026-10-17):* fixed: every fifth wrong try locks (migration 47), so a lock that ran out gives five tries again while the count still feeds the per-link budget; tested in "a meeting address's lock (audit F17)".

**F18. Sidebar badge wording is computed from `Date.now()` and a zone-less formatter during render, so it hydrates differently from the server.**
`src/components/app-nav.tsx:84-93`. The server (UTC) and the browser (another zone) can print different weekdays for the same `oldestAt`, and the one-day threshold can flip. The result feeds `aria-label` and `title`, so React logs a hydration mismatch. `src/lib/format-date.ts` states this rule itself.
*Fix:* compute the wording on the server (`AppShell` already has `awaiting.oldestAt`) with `MEETING_TIME_ZONE`.

**F19. Optimistic highlight edits can be overwritten by a background refresh.**
`src/features/meetings/meeting-view.tsx:92-96` adopts `props.initialHighlights` on every server re-render; `adjustHighlight` (:231-255) sets state, awaits the PATCH and does not write the server result back. A refresh landing between the two (the 10 s `AutoRefresh` while notes are pending, or any `router.refresh()`) reverts the edit until the next refresh, and the `previous` snapshot restored on error can be stale.
*Fix:* write the PATCH result into state on success, and merge rather than replace on prop adoption.

**F20. The meeting page refreshes and re-kicks for ever when a job is stuck `running`.**
`src/features/meetings/generation-state.ts:67-75` returns pending for `running` regardless of staleness and for commands in `detected`/`approved`/`running`. If no later kick reclaims the job, the page re-fetches every 10 s and the server calls `kickJobs()` on every render (`page.tsx:62-64`). The processing view likewise refreshes indefinitely for a meeting stuck in `requested`/`recording` until the six-hour close.
*Fix:* stop refreshing once the job's lease is stale by more than the re-kick window, and show the "still running, try again" state.
*Status (2026-10-17):* eased: the meeting page backs off from 10 s to 30 s and stops after 20 minutes (`nextRefreshDelay()` in `auto-refresh.tsx`, tested); the recording view keeps its steady ten seconds. A status route that refreshes only on change is still the better fix.

**F21. The dashboard's second page keeps an empty 21 rem column.**
`src/app/dashboard/page.tsx:117` makes the two-column grid unconditional while :202 renders the Player card only on the first page.
*Fix:* make the second column conditional on `firstPage`.

**F22. Content stays invisible until Framer hydrates, and one reveal is a no-op.**
`src/components/ui/reveal.tsx:35-36` server-renders `opacity:0`; on the dashboard the guest notice, title, awaiting section, every group and the Player card are wrapped in `Reveal`, so with slow or failed JS the Quest log is blank with only the sidebar, and anything below the fold stays hidden until scrolled. `src/app/dashboard/page.tsx:182` wraps a `display: contents` element, which has no box, so that stagger never fires.
*Fix:* render the start state visible when motion is reduced or JS is absent (CSS-driven reveal with a `no-js` fallback), and drop the `contents` wrapper.

**F23. The "Done / To do" state in the first-run checklist is not announced.**
`src/features/meetings/first-run-checklist.tsx:74,76` put `aria-label` on `<svg>` elements with no `role="img"`; the only remaining cue is `line-through` and a muted colour.
*Fix:* `role="img"` on the icon or visually hidden text in the `<li>`.
*Status (2026-10-17):* fixed: the icons are hidden from assistive tech and each item starts with visually hidden "Done:" or "To do:".

### Minor

**F24.** `complete_job` and `start_job_effect` check the claim token only, never `lease_until` (migration 37:29-31, 118-120); a run that outlives its lease still publishes until the next sweep nulls the token. Add `and lease_until > now()`.

**F25.** "Released" failures are unbounded: a persistent Google 5xx or 429 on a calendar command, or an Attendee 5xx on ingest, is released every five minutes for ever and never reaches `max_attempts` (`runner.ts:171-179`, migration 37:86-91). Count releases or cap `run_after` age.

**F26.** A single Claude request timeout is mapped to `ProviderUnavailableError` (`claude.ts:209-211`), which releases the job, ends the run and stops the chain (`runner.ts:164-170,85`), parking every other due job until the next external kick. Treat the SDK's timeout error as an attempt-using failure.
*Status (2026-10-17):* fixed: the SDK's timeout is `ClaudeTimeoutError`; one the run gave at least 200 s uses an attempt (`FULL_CALL_MS` in `runner.ts`), a shorter one is still released; tested in `runner.test.ts` and `claude.test.ts`.

**F27.** A transcript the database refuses is retried three times (`jobs.ts:344-347`); classify the `ingest_transcript` error with `isRefusal` and complete `rejected`.
*Status (2026-10-16):* fixed: `transcriptRejection()` in `jobs.ts` raises a `RefusedError` for a refusal code, and the runner completes it as `rejected`; tested in `jobs.test.ts` and `runner.test.ts`.

**F28.** Live utterances of a scheduled bot are dropped until its `joined_recording` event lands: the webhook filter (`route.ts:86-88`) and `record_live_utterance` (29:14-15) accept `requested`/`recording` only, while `mark_bot_finished` was widened to `scheduled`. If that one delivery fails three times the meeting stays `scheduled` while the bot records and nothing in the log says why. Include `scheduled` in both filters.

**F29.** `/api/health` returns `configured: { ai, bot, cron }` and the last keep-alive time to anyone (`src/app/api/health/route.ts:27-31`); the docs say counts only. Low value to an attacker, but it tells anyone whether the cron and Claude keys are set.

**F30.** `open_meeting_link()` stores a tries row for any `p_code` with no format check (migration 39:111-118, 147-148), so a caller can grow `meeting_link_tries` with arbitrary codes; a null code gives no lock then a not-null violation. Add `check (code ~ '^[a-z0-9]{12}$')` and return `wrong` early.

**F31.** `append_memory_lines()` cannot make room when the user's zone alone is near 32 KB (migration 25:133-144); the check violation fails the calling job, which retries the Claude call three times, and a `detect_commands` failure then triggers F5. Return or raise a refusal code when `octet_length(user_zone || marker) + 2 > 32768`.

**F32.** The owner-only writer functions `rotate_meeting_link`, `set_meeting_link_enabled`, `review_meeting`, `snooze_wrap_up` bypass the 60-a-minute write limit (none calls `note_visitor_write()`); rotate mints a new code per call.

**F33.** `access_requests.email unique` (migration 24:11) surfaces 23505 through the Data API, so anyone with the publishable key can learn whether an address already asked for access. The route hides it; the table does not. Route the insert through a function with `on conflict do nothing`.

**F34.** The link code is written to the log on lockout: `log.info("link.locked", { code })` (`src/app/api/m/[code]/pin/route.ts:51`). The allow-list test lets `code` through because elsewhere it is an error code. Log a keyed hash or nothing.

**F35.** A valid approval body can exceed the `approved_args` 8 KB check (`approve-args.ts:15-16` caps characters, not bytes; migration 14:111 checks bytes); `approve_command` raises 23514 and the route answers 500 "That didn't save" (`commands/[commandId]/route.ts:85-88`). Route it through `dbFailure()` (which maps 23514 to 400) or refine on byte length.

**F36.** For `ask`, `recap`, `email`, `followup`, `remind`, the typed-command route inserts the command row and its job in two statements (`meetings/[meetingId]/commands/route.ts:112-143`); if the job insert fails the response is 500 but the `detected` row stays, counts against the cap, and shows "Drafting…". Wrap both in a SQL function or delete the row on failure.

**F37.** `DELETE /api/meetings/[id]` chooses the Attendee step from a status read before it (`route.ts:38-69`); a scheduled bot that joined in between gets `deleteBot` (4xx, "gone") and the row is deleted while the bot is in the call. Re-read or compare-and-set right before the admin delete.

**F38.** `DELETE /api/highlights/[id]/share` answers `{ revoked: true }` whether or not a live link existed (`share/route.ts:60-66`); return 404 when nothing matched.

**F39.** `readJson` runs before authentication in `access-requests/route.ts:15-18`, `memory/[...path]/route.ts:31-33` and `memory/onboarding/route.ts:36-38`, so an unauthenticated caller gets a body parsed before the 401. Move the auth check first.

**F40.** `v1` connector ciphertexts open without the AAD binding (`token-crypto.ts:57`). Re-seal on the next successful open and drop the legacy branch.

**F41.** Every grant cookie is `Path=/` for seven days (`pin/route.ts:72`); someone who opens many links carries all of them on every request. Consider one cookie holding a list, or a shorter age.

**F42.** The runner's store-refusal message shown on the card includes a SQLSTATE: `the output could not be stored (23514)` (`runner.ts:144`). Map it to plain words.

**F43.** Non-JSON 2xx bodies from Attendee reach the log: `schema.parse(JSON.parse(text))` (`attendee.ts:141-142`) throws a `SyntaxError` whose message embeds a snippet of the body, which `bots.ts:140` logs. Wrap the parse and throw an `AttendeeError` with the status only.

**F44.** Media-link renewal gives up after one failed attempt (`meeting-view.tsx:393-398`, `shared-meeting-view.tsx:58-73`): on failure nothing is rescheduled, so during a long watch the signed URL expires mid-play and the user sees the error only when the element fails. The documented gap covers the opposite branch (an unparseable expiry loops). Retry with backoff and surface a message before expiry.
*Status (2026-10-17):* fixed: `useRenewingMedia()` (one hook for both views) tries a failed timed renewal again after one, two, four and eight minutes, then leaves it to the player's Retry; tested in `use-renewing-media.test.ts`.

**F45. Accessibility, minor.** The find count's `aria-live` region is mounted only while a query exists, so the first count is often not announced (`transcript-panel.tsx:214-219`). Heading levels skip from `h1` to `h3` in the notes pane and the shared summary (`notes-panel.tsx:245,264`, `shared-summary.tsx:70,88`). The transcript row is a clickable `<li>` with no role (`transcript-panel.tsx:388-398`; the inner time button keeps it reachable). `text-white` on the 62 % lightness speaker hues and the "✓" on `bg-success` (`meeting-processing.tsx:70-77`) sit near 3.9:1. The landing timeline places a `<div aria-hidden>` as a direct child of `<ol>` (`feature-flow.tsx:93-102`). The Edit/Preview `role="group"` has no name (`memory-page.tsx:195`). Two destructive buttons use `disabled` rather than `loading`, so nothing shows while the DELETE runs (`delete-meeting-button.tsx:37`, `memory-page.tsx:158-166`).

**F46. Dead code.** `getOwnerLink` (`link-queries.ts:19`), `uuidSchemaMessage` (`http.ts:349`), `Input` (`input.tsx:16`), `PageTitle`'s `actions` prop, the unreachable signed-in branch of `SiteHeader` (`site-header.tsx:68-97`; `Chrome` renders it only signed out), `Timeline`'s `compact` prop (`timeline.tsx:26,171-173`), `SlackError.retryable` (set at `slack.ts:69,73`, never read), the exports `THEME_KEY`, `SIDEBAR_KEY` (`layout.tsx:55` hardcodes the strings instead), `periodLabel`, `MARK_PATHS`/`MARK_LINE` (the icons hardcode their own copies), `APP_NAV`, `ensureVisitorSession` outside its file; `next.config.ts` `serverExternalPackages: []` is a no-op whose comment describes something else. `src/app/api/wrap-up/route.ts:30-32` builds a second server client although `visitor.supabase` is the same client. `runIngestMedia` returns a non-null skipped payload for "nothing to do" (`jobs.ts:262-263`) where every other handler returns null.

**F47. Duplication.** `normalise` and `saidIn` are identical in `commands/grounding.ts:41-50` and `summaries/grounding.ts:33-42`; the regex `escape` helper appears in `detect.ts:25`, `commands/grounding.ts:53` and `memory/files.ts:505`; `readUint32` in `mp3-duration.ts:89-96` and `mp4-duration.ts:74-82`; two routes define their own UUID regex (`commands/[commandId]/rewrite/route.ts:19`, `contacts/[contactId]/route.ts:10`) while the rest use `z.uuid()`; the phone pane switch is implemented three times (`meeting-view.tsx:431-456`, `shared-meeting-view.tsx:109-134`, `memory-page.tsx:195-210`); `LEVEL_NAMES` in `afk-record-panel.tsx:35-42` duplicates `LEVELS` in `afk-record.ts:63-69`; the test-user form (`test-user-form.tsx:64-86`) and the speaker chips (`transcript-panel.tsx:248-281`) build their own classes instead of `inputClass`, `Button` and `chipClass`.
*Status (2026-10-17):* mostly fixed: `normaliseWords()` and `saidIn()` (`src/lib/words.ts`, also making the learn check match whole words), `escapeRegExp()` (`src/lib/regexp.ts`), the media-link renewal (`useRenewingMedia()`), the Google name reader and the safe-redirect check each have one home.

**F48. Naming against `docs/conventions.md`.** Bare unit-less names: `const duration =` (mvhd ticks, `mp4-duration.ts:57`), `const time = Date.parse(value)` (`commands/grounding.ts:107`), `const [duration, setDuration]` holding minutes (`tasks-tab.tsx:459`). `afk-charts.tsx:187` uses a raw `<a href>` for in-app navigation. Inline `style` for skeleton widths (`meetings/[meetingId]/loading.tsx:21,26`, `memory/loading.tsx:15`). Stale comment "The six files" (`memory-page.tsx:38`, there are nine). Landing copy says the link is pasted "on the dashboard" (`feature-flow.tsx:38`); it is pasted on `/send`.

### Repository hygiene (what should not be in a public repository)

**H1. minor.** `src/features/commands/prompts.ts:65` ships a plausibly real Gmail address as the example address inside the parser prompt, and `src/features/connectors/address-book.test.ts:107-137` and `docs/data-flows.md` §25 use the same first name and address. If this is a real person's address it is now in a public repository and in every parse prompt. Use an RFC 2606 address (`shumail@example.com`, as `schema.test.ts:2523` already does).
*Status (2026-10-17):* fixed: the prompt, the schema and the tests use `shumail@example.com` (a reserved domain).

**H2. minor, confirm intended.** `src/app/privacy/page.tsx:55` names the maintainer and a personal site; the README and docs name the GitHub account. A privacy policy needs a contact, so this is probably deliberate. Confirm.

**H3. minor.** `.agent-logs/` (committed by the brief's requirement) contains absolute home-directory paths (`/Users/<name>/…`) and the path of a local plan file. Harmless, but the capture hook writes prompts verbatim: a key pasted into a prompt would land in the public repository. Consider a redaction pass in `.claude/hooks/capture.py` for `sb_secret_`, `sk-ant-`, `xox[abp]-`, `GOCSPX-` and long JWTs.

**H4. suspected, not yet committed.** `docs/setup.md` (untracked, written during this audit by another session) names a second GitHub account and the unrelated client project it is reserved for (lines 401-413). That is an internal note about the owner's other work and should not go into this public repository; move those lines to the owner's private notes before committing.

**H5. clean.** No real secret, key, JWT or project reference was found anywhere in the tree, including `.agent-logs/` and the untracked files; `.env.example` holds placeholders only; `.gitignore` and `.vercelignore` exclude `.env*`, `.metrics/`, `data/audio/`; CI runs read-only with pinned actions; `.npmrc` blocks unreviewed install scripts; `.claude/settings.json` runs only the repo's own stdlib Python hook with `-I`.

---

## Part 3. Suspicions (not proven from the code alone)

**S1. high.** *Deleting a meeting that has a spoken command probably fails.* `meeting_commands_turn_fk` (migration 09:63-64) references `transcript_turns (meeting_id, id)` with no delete action. Migration 07:36-49 records exactly this failure for `item_citations` and `chapters`: the `meetings → transcript_turns` cascade (migration 01, so its trigger fires first) runs its NO ACTION check at the end of its own cascaded statement while rows still reference the turns, and the delete errors. Every spoken command has `turn_id` set, so `DELETE /api/meetings/[id]` would answer 500 for any meeting whose transcript produced one, contradicting "cascades" in `system-design.md`. The only delete test with published output (`schema.test.ts:340-376`) completes `detect_commands` with `commands: []`. *To confirm:* a database test that applies one spoken command and then deletes the meeting. *Fix:* `on delete cascade` on the constraint (`ingest_transcript()` already deletes commands before turns, 22:78-81).
*Status (2026-10-17):* disproved: the key is NO ACTION, which Postgres checks at the end of the statement, after the meeting's own cascade has removed the commands. "deleting a meeting (audit S1)" in `supabase/tests/schema.test.ts` deletes a meeting with a spoken command and passes on the unchanged schema; it stays as a guard.

**S2. medium.** *Interim captions with new idempotency keys could create several commands and several answers for one question.* `record_live_utterance` inserts a command and a job for every non-duplicate utterance that parses as a command, and the webhook posts a "Heard" line per non-duplicate utterance; idempotency is keyed on Attendee's key only. If the caption pipeline re-emits a growing utterance under new keys, each is a new command. `attendee.ts:167-169` merges consecutive captions post-call, which suggests fragments were seen. *To confirm:* check Attendee's delivery behaviour for `transcript.update`. *Mitigation:* refuse a second `detected` live command from the same speaker within a few seconds.

**S3. minor.** A re-summarised meeting emails the owner again (`queue_owner_note` fires on any change of `summarized_at`); probably intended but undocumented, and F5 shows a path where it is not intended.

**S4. minor.** A missing `CONNECTOR_TOKEN_KEY` is thrown as a non-retryable `AdapterError` (`token-source.ts:30-32`), so an email or Slack command, with one attempt, fails for good because of a deployment setting. Release instead.

**S5. minor.** A second `ingest_transcript()` with a changed hash deletes `meeting_commands` (22:78) and by cascade a `run_command` job that may be mid-adapter; `finish_command` then finds nothing and a sent email leaves no record. Rare: Attendee's final transcript would have to be fetched twice with different content.

**S6. minor.** `/api/robots` does not disallow `/m/` (the page is `noindex` by metadata, so this is belt-and-braces); private `/meetings/` pages rely on never being linked.

**S7. minor.** `shared-clip.tsx:100-102` sets the start time in `onLoadedMetadata`; if metadata loaded before React attached the handler, the clip starts at 0:00 until Play is pressed. `use-media-player.ts:140-144` handles this case for the meeting page.

**S8. minor.** The language radio renders "English and Urdu" on the server and may flip after hydration (`send-bot-form.tsx:61-63`); `isWide` is true on the server, so a phone first paints the desktop placement (`meeting-view.tsx:410-414`). Flashes, not errors.

---

## Part 4. Verified sound

For the record, these documented controls were traced to the final code and hold: RLS on all 25 tables with `can_read_meeting()` as the one rule; every security definer function sets `search_path = ''` and keys on `auth.uid()` or is revoked from `anon`/`authenticated`; the browser-writable column set matches the docs (apart from F10); every cap runs under an advisory lock; the idempotency indexes and compare-and-set functions exist as described; the webhook verifies the HMAC over Attendee's canonical JSON before any parsing or write, caps the body, never creates a meeting, and keys utterances on the idempotency key; the kick body is validated; `approve_command` inserts at most one `run_command`, `start_command` stamps `executed_at` before the adapter and answers `ambiguous` on a second start for email and Slack, the calendar event id derives from the command id, `notify_owner` and the live answer pass `start_job_effect` first, and Gmail and Slack never retry after a dropped connection; no Claude call passes `tools`, every call uses a JSON schema, `maxRetries` 0, a timeout, cache control on the data block, and grounding of citations, owners, dates, addresses and quotes; the OAuth state is a signed ten-minute cookie bound to user and provider with PKCE for Google, the `next` check rejects `//` and `/\` forms, sign-out is POST-only or PKCE-proven; the PIN grant cookie is HttpOnly, SameSite=Lax, Secure on https, HMAC-bound to the code, and every read re-checks the link; shared pages return only the documented fields; `media-url.ts` takes the path or id from the row; the log allow-list test covers every log call; `import "server-only"` is on every `src/server/*` file and every `*-queries.ts`; `process.env` is read only in `env.ts`, `proxy.ts` and `server/jobs.ts`; only `claude.ts` imports the Anthropic SDK; no barrel files; all file names kebab-case; no `console.log`; no secret or server env reaches a client component; every interval, listener and observer in the UI has a cleanup and every storage access is in a try/catch.

---

## Part 5. Suggested order of fixes

*As of 2026-10-17:* fixed or eased so far are F1, F2, F3, F4, F5, F6, F7, F8, F10, F11, F12, F13 and D8, F16, F17, F20 (eased), F23, F26, F27, F44, F47 (mostly), H1 and D15; S1 was disproved by a test. Each carries a status line above. What follows is the original order.

1. F1 (the sweep closing live scheduled calls) and S1 (delete failing on spoken commands): one migration each, plus a database test for each.
2. F3 (the bot id never stored) and F2 (the live sender tie rule): the two ways a paid bot acts without the right owner.
3. F5, F4, F6: the three ways a message goes out twice.
4. F7 (the welcome loop), F8 (the unparsed draft), F12 (cannot disconnect), F13 (memory overwrite).
5. F9, F10, F11, F17 and the minors in the processing group (F24 to F28).
6. The UI group (F14 to F23) and the accessibility list (F45).
7. The document corrections in Part 1, in the same commits as the code they describe.
8. The hygiene items H1 and H4 before the next push.
