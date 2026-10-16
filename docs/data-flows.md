# AFK.ai — data flows

Each feature from its first input to its last output, one section per flow. Table,
function and route names are the ones the code will use
([conventions.md](conventions.md)). Who may do each step is in
[system-design.md](system-design.md).

## 1. A visitor opens the landing page

1. `GET /` → Server Component reads seed meetings (`meetings where is_seed`) as `anon`.
2. The poster image paints; the hero video loads after; scrolling moves its playhead.
   Reduced motion: poster and play button.
3. The Tutorial strip renders the five meetings with their one-liners.
4. Output: the page. Nothing is written.

## 2. A visitor becomes a test user

1. The landing form posts a Gmail address → server action validates with Zod → SQL
   `request_test_user(email)` inserts into `test_user_requests` (unique on email).
2. Output: "Thanks, we'll add you within a day." The owner reads the table and adds the
   address to the Google OAuth client's test users. No email is sent.

## 3. Opening and playing a Tutorial meeting

1. `GET /meetings/[id]` → Server Component reads the meeting, its segments, summaries,
   chapters, action items and decisions (seed policies).
2. A server action `sign_audio_url(meeting_id)` checks `consume_quota(ws, 'audio_url',
   30, '1 hour')` (guests and visitors count by cookie or IP) and signs the private
   Storage path for one hour.
3. The player island mounts with the segments; the transcript is virtualised.
4. Play: the player's `timeupdate` → segment-at-time lookup → current line highlighted,
   auto-scrolled. Click a line or a timestamp button → `player.currentTime = start`.
   `?t=` on load → seek and scroll before play.
5. Audio `error` or expiry → the action signs a new URL; playback resumes at the same
   position.
6. Output: playback. Nothing is written except the quota row.

## 4. Switching a summary template, chapters, find, search

1. Template picker → cached summary row for that template shown; on own meetings, a
   missing template enqueues `summary.generate` (flow 10 step 6) and streams the result.
2. Chapters, who-spoke-when and the speaker filter are pure client views of the segments
   and chapters already loaded; "skip others" seeks past filtered segments.
3. Find runs client-side over the loaded segments and marks matches on the strip.
4. Search: `GET /app/search?q=` → SQL `search_workspace(q, filters)` over `text_search`
   columns (own rows plus seed rows) → results with `segment_id` and moment → clicking
   opens the meeting with `?t=`.

## 5. A first action creates a guest workspace

1. The first write (tick, note, highlight, summon, command, memory edit) with no session
   → `supabase.auth.signInAnonymously()` on the server → session cookie (httpOnly).
2. SQL `start_guest_workspace()` inserts `workspaces(owner_id = auth.uid(), kind =
   'guest')`.
3. The original write proceeds under the new session.
4. Output: the thing the user did, plus the "This workspace lives on this device" notice.
   Every later request bumps `workspaces.last_active_at` from middleware.

## 6. Continue with Google

1. "Continue with Google" → `linkIdentity({ provider: 'google' })` → Google consent →
   callback.
2. Success: the anonymous user now has a Google identity; the workspace is unchanged;
   `workspaces.kind = 'member'`.
3. `identity_already_exists`: sign in with Google instead, keep the guest user id in a
   short-lived httpOnly cookie, show the keep/merge choice → SQL
   `link_or_merge_workspace(guest_user_id, choice)` re-parents rows in one transaction and
   deletes the guest user.
4. Output: the same workspace on every device; the checklist step ticks.

## 7. Summon AFK (paste a link)

1. `/app/summon` form: meeting URL, language (remembered in `localStorage`), capture
   mode; consent text shown.
2. Server action validates (Zod: Zoom, Meet or Teams URL) → SQL `launch_bot(ws,
   url, language, capture)`: checks `consume_quota(ws, 'bot_hours', …)` and "no running
   bot for this meeting", inserts `meetings(state = 'scheduled')` and a job
   `attendee.create_bot` with `idempotency_key = 'meeting:{id}:create'`.
3. `after(runJobs)` → the job calls Attendee `POST /bots` with `bot_name: "AFK.ai
   Notetaker"`, `deduplication_key = meeting_id`, `recording_settings`,
   `automatic_leave_settings`, transcription settings from `TRANSCRIPTION_PROVIDER`
   (captions by default; Deepgram multilingual when on and the language is "English and
   Urdu") → stores `bot_id` → `transition_meeting(id, 'joining')`.
4. Output: the meeting page in `joining`, updated live (Realtime or 5 s polling).

## 8. The bot on the call (webhooks)

1. `POST /api/webhooks/attendee`: raw body → verify `X-Webhook-Signature`
   (`timingSafeEqual`) → insert `webhook_deliveries(delivery_id = idempotency_key)`;
   duplicate → 200, stop.
2. `bot.state_change` → `transition_meeting` (forward only): `joining → recording →
   processing`; waiting-room timeout, silence, max uptime, removed, fatal → the matching
   failed or ended-early state.
3. `transcript.update` → `upsert_segment(meeting_id, utterance_id, speaker_name,
   speaker_uuid, start, end, text, script)` → flow 9 runs in the same request.
4. Post-processing complete → enqueue `meeting.fetch_transcript` with
   `idempotency_key = 'meeting:{id}:fetch'`; 2xx; `after(runJobs)`.

## 9. Live commands and questions (inside flow 8, step 3)

1. Is the utterance from the sender? `speaker_name` equals the owner's name (or the name
   given on the Summon page). If not, stop.
2. Does the text start with "AFK" (or "Hey AFK", "A-F-K")? If not, stop. Cheap string
   check; no model call yet.
3. Parse with `lib/commands/parse.ts` into a kind: task, decision, note, highlight,
   remember, draft email, schedule, remind, slack, or question.
4. Capture kinds → SQL insert into `action_items` / `decisions` / `notes` / `highlights`
   / `memory_entries` (source = told by owner, moment = the utterance), `segments.
   is_command = true`, an `activity` row. Appears on the live page within 10 s.
5. Draft kinds → enqueue `card.draft` (flow 13).
6. Question → `consume_quota(ws, 'questions:{meeting}', 20, 'meeting')` → Claude
   (`CLAUDE_MODEL`, no tools, JSON schema, the transcript so far as data, `effort: low`,
   10 s timeout) → grounding check → `POST /bots/{id}/send_chat_message` to everyone with
   `[mm:ss]` citations, or "That hasn't come up in this meeting so far." → `activity`.
7. Output: rows and a chat message; nothing on this path waits for the job runner.

## 10. After the meeting (the job chain)

Each job has its own idempotency key; each enqueues the next on completion.

1. `meeting.fetch_transcript`: fetch the full transcript and recording info from
   Attendee; upsert segments; set `script` per segment.
2. `meeting.transliterate` (only if any segment is non-Latin): Claude turns Devanagari
   or Arabic-script segments into Roman Urdu; English words unchanged; stores
   `text_roman`; search indexes both.
3. `summary.generate` (Catch me up): Claude with the transcript prefix cached →
   `ground.ts` → SQL `store_claims(meeting, 'summary', template, claims)`.
4. `meeting.one_liner`, `chapters.generate`, `claims.extract` (action items with owner
   and date only if said, decisions), `memory.propose` → each through the grounding
   check → `store_claims` / `memory_entries(status = 'proposed')`.
5. `email.summary` (member with Gmail connected and the setting on): one
   `email_sends(meeting_id, 'summary')` row → flow 15 send path.
6. `meeting.wrapup`: `transition_meeting(id, 'ready')`; the wrap-up card appears.
7. Output: a ready meeting. `usage` rows record every Claude call's tokens and cost.

## 11. Typed commands after the call

1. The command box posts text → server action → the same parser as flow 9 (no "AFK"
   prefix needed) → the same SQL inserts or `card.draft` job → `activity` row marked
   typed.
2. Output: the row, shown in Actions or Spells.

## 12. Memory: proposals, edits, download, erase

1. Proposals from `memory.propose` appear on the wrap-up and in Lore marked New, each with
   its quote and moment.
2. Accept → `status = 'accepted'`; Edit → new content, source kept, `edited_at`;
   Discard → deleted. Words are usable at once; other sections only when accepted.
3. Every insert goes through SQL `upsert_memory_entry`, which rejects an entry with no
   source.
4. Download → server action builds JSON and Markdown including sources. Erase all →
   SQL `erase_memory(ws)` in one transaction.
5. Prompts read only the sections a job needs, capped at 4,000 tokens; each use is logged
   as `memory_uses` so the wrap-up and cards can say which entries were used.

## 13. A draft becomes a Spell (card)

1. `card.draft` job: the command text, the transcript so far, and the needed memory
   sections → Claude (no tools, JSON schema) → recipients come only from memory, each
   with its reason; unknown recipients stay empty.
2. Insert `cards(state = 'waiting', version = 1)`. Appears on the meeting, the Quest log
   and Spells.
3. Send back with a note → SQL `return_card` (max 5) → `card.rewrite` job → version 2,
   version 1 kept.
4. Edit fields directly → SQL `update_card_draft`; a card with an empty required field
   cannot be approved.
5. Dismiss → `state = 'dismissed'`, kept 30 days.

## 14. Approving a Spell and sending it once

1. Approve → server action (member only) → SQL `approve_card(card_id)`: `UPDATE cards
   SET state = 'approved' WHERE id = $1 AND state = 'waiting' AND workspace_id = $ws`
   (zero rows = double click); insert `card_sends(card_id, status = 'pending')`; enqueue
   `card.send` with `idempotency_key = 'card:{id}'`; all one transaction.
2. `after(runJobs)` → `card.send`: SQL `claim_send(card_id, runner)` (pending, or
   sending with a lease older than 10 min) → decrypt the connection token (AES-256-GCM,
   `kid`) → provider call:
   - Gmail: `messages.send` with `Message-ID: <card_id@afk.ai>`.
   - Calendar: `events.insert` with a client-set `id` from the card id; 409 = success.
   - Slack: `chat.postMessage` with `metadata.event_payload.card_id`.
3. Success → SQL `record_send(card_id, provider_message_id)` sets `card_sends.status =
   'sent'` and `cards.state = 'sent'` together.
4. Error before the request left → retry (max 3). Timeout or unknown outcome → check the
   provider (`rfc822msgid:` search / `conversations.history`); found → record; not found
   or check failed → `cards.state = 'needs_check'`, never auto-resent.
5. Output: "Sent" with the provider id, or "We're not sure this was sent".

## 15. The summary email and other outbound emails

1. `email_sends(meeting_id, kind)` unique row inserted by the job that decided it
   (summary, failure notice, card nudge, reminder, share the notes).
2. The same claim → decrypt → Gmail send → record path as flow 14, keyed on the
   `email_sends` row.
3. No Gmail connection → the row waits with "Connect Gmail to send this"; sent when the
   connection exists.

## 16. Connecting Gmail, Google Calendar, Slack (Loadout)

1. Connect → `/api/oauth/{provider}/start` with the minimum scopes (`access_type=offline`,
   `prompt=consent`, `include_granted_scopes=true` for Google; user-token scopes for
   Slack with rotation).
2. Callback → verify `state` → exchange code → encrypt tokens → SQL `upsert_connection`
   with `reconnect_by = now() + 7 days` for Google (Testing mode).
3. Loadout shows "reconnect by <date>"; a daily job marks connections past
   `reconnect_by` as broken; affected cards show "Reconnect Gmail to send this".
4. Disconnect → revoke with the provider → delete the row in the same operation.

## 17. Join from the calendar

1. With Calendar connected, a job `calendar.sync` (every 5 minutes while the user is
   active, else daily) lists this week's events with a Zoom, Meet or Teams link →
   `calendar_events` rows.
2. The Quest log's "This week" shows them; "Summon" on one → flow 7 with `run_at` at
   the start time; "Join every meeting" sets the workspace default to all.
3. A moved event moves the job's `run_at`; a cancelled event cancels the job.

## 18. Sharing a clip

1. From a highlight or a selected range → SQL `create_clip(meeting, start, end)` →
   unguessable token.
2. `GET /clips/[token]` as `anon`: the clip row, its transcript excerpt and the speakers
   heard; seed meeting → a signed URL for the audio with playback restricted to the
   range; private meeting → transcript only.
3. Revoke → `revoked_at`; the page then shows "This clip is no longer available".

## 19. Sharing a whole meeting behind a PIN

1. Member → SQL `create_pin_share(meeting, pin)` (one active per meeting; PIN hashed).
2. `GET /shared/[token]` → PIN form → SQL `check_pin(token, pin, ip)` counts attempts (5
   per 15 min locks; 20 per day disables and notifies) → sets a PIN cookie for 30 days.
3. With the cookie: the meeting page in the public frame with recording (server-fetched
   Attendee link), transcript, navigation and the Catch me up summary; nothing else.
4. Revoke or change PIN → `revoked_at` / new hash; cookies stop working at once.

## 20. Deleting a meeting

1. Delete → confirm → SQL `delete_meeting(id)`: cascades through segments, summaries,
   chapters, claims, notes, highlights, clips, PIN shares, unsent cards, activity, search
   rows; memory entries keep content, lose their source link, and the count is returned;
   enqueues `attendee.delete_data` (`idempotency_key = 'meeting:{id}:delete'`).
2. The job calls `POST /bots/{id}/delete_data` once the bot is `ended` or `fatal_error`,
   retrying until confirmed.
3. Output: the meeting gone; share links dead immediately.

## 21. Daily cron and recurring jobs

1. Vercel cron → `GET /api/cron/daily` (checks `CRON_SECRET`) → writes a `heartbeats` row
   (keeps Supabase awake) → `after(runJobs)`.
2. Recurring jobs re-enqueue themselves: `guests.purge` (delete `is_anonymous` users
   idle 30 days, with the 7-day notice flag set earlier), `cards.nudge` (one reminder per
   card waiting over 24 h), `connections.expire` (flow 16 step 3), `calendar.sync`.
3. Any due timed job (`run_at` passed) runs at this kick if nothing kicked it earlier.

## 22. The job runner

1. A kick: `after(runJobs)` from a mutation or webhook, `POST /api/jobs/kick` with
   `JOBS_KICK_SECRET`, or the daily cron.
2. `runJobs(deadline = start + 240 s)`: loop → SQL `claim_jobs(runner_id, 1)` (`FOR
   UPDATE SKIP LOCKED`, 5-minute lease, `attempts + 1`) → run → `complete_job` or
   `fail_job` → repeat until no job or the deadline.
3. At the deadline with work left → POST the kick route and exit; the new function
   continues. A crashed runner's lease expires and the next kick re-claims.
4. Past `max_attempts` (3) → `status = 'failed'`; the meeting or card shows it with a
   retry button that enqueues a fresh job.

## 23. Theme and language preferences

1. Sun/moon toggle → cookie `theme` + `localStorage`; the server renders the right
   `data-theme` with no flash.
2. The Summon page's language choice → `localStorage` only; sent with each summon.
