# Fathom (fathom.ai) — competitive research

Researched 2026-10-16 from Fathom's site, help center (help.fathom.video), developer docs (developers.fathom.ai), press, and review sites. Research only; nothing was installed or run.

Every claim has a source. **[3P]** marks a third-party source. **[Vendor-competitor]** marks a source written by a Fathom competitor, so read it as biased. Where Fathom's own pages disagree, both sides are given.

---

## 1. Plans and limits

| Plan | Monthly | Annual (per user/mo) | Notes |
|---|---|---|---|
| Free | $0 | $0 | "Free forever" |
| Premium (individual) | $20 | $16 | |
| Team | $19 | $15 | 2-user minimum |
| Business | $34 | $25 | 2-user minimum |
| Enterprise | Talk to sales | — | SSO/SCIM, custom retention, dedicated CSM, priority SLAs |

Source: https://www.fathom.ai/pricing

What each tier adds, per the pricing page (https://www.fathom.ai/pricing):
- **Free:** unlimited recordings and transcription; bot or bot-free capture (beta); instant AI summaries; clips, playlists, search.
- **Premium:** advanced summaries, AI action items, a conversational assistant (Ask Fathom), and a custom bot name.
- **Team:** global search across calls, highlight playlists, comments, folders, keyword alerts.
- **Business:** CRM *field* sync, Deal View, coaching metrics and AI scorecards, custom summaries.
- **Enterprise:** SSO, Okta SCIM, org-wide security controls, custom data retention, HIPAA with a BAA.

Limits and fine print:
- **The free AI cap is 5 calls a month.** Free users get "Advanced summaries for your first 5 calls each month (after that, only the General/Enhanced template will be available)". The pricing page only says "instant AI call summaries" and doesn't mention this cap. Source: https://help.fathom.video/en/articles/5290881
- **Storage and transcription are unlimited on every plan,** with transcription in 38 languages. Source: https://help.fathom.video/en/articles/5290881
- **New users get a 30-day Premium preview.** After it ends, Premium features stop unless the user upgrades. Source: https://help.fathom.video/en/articles/5290881
- **CRM sync (HubSpot, Salesforce, Close) is capped at 3 users per email domain.** The help page lists it on both Free and Premium, while the pricing page puts "CRM field sync" in Business. *These two Fathom pages conflict.* Sources: https://help.fathom.video/en/articles/5290881, https://www.fathom.ai/pricing
- **Some features are marked "Limited use"** in the comparison table, with no numbers given: AI action items, follow-up emails, account-wide Ask Fathom (beta), Zapier and Make. Source: https://www.fathom.ai/pricing
- **Promotions:**
  - 90-day money-back guarantee.
  - 10 free seats for nonprofits.
  - Up to 2 years of Team free for startups backed by select VCs and accelerators.
  - Business free for the rest of your contract if you're switching from Gong.

  Source: https://www.fathom.ai/pricing

## 2. How the bot joins calls

- **Platforms:** Zoom, Google Meet and Microsoft Teams. Once a calendar is connected, the bot joins automatically. Source: https://www.fathom.ai/integrations-video-conferencing
- **The user has to be on the call.** "Fathom can only record a Zoom, Microsoft Teams, or Google Meet call if you are also present on the call." The bot leaves when the meeting ends, and there's no option to have it record without you. Source: https://help.fathom.video/en/articles/5461313
- **Auto-capture rule:** All, External, Internal, or No meetings. The default capture mode (Transcript Only, Audio Only, or Audio + Video) can be overridden for a single meeting. An optional "Consent Chat Message" posts in the meeting chat. Source: https://help.fathom.video/en/articles/449088
- **Ad-hoc calls:** In the older version you paste a meeting link to make the bot join. In the bot-free version you click "Capture Now". Source: https://help.fathom.video/en/articles/449088
- **Calendly events with no attendees** are treated as "impromptu" meetings, so the user has to start recording manually. Source: https://help.fathom.video/en/articles/297088
- **Bot-free capture (Fathom 3.0, April 2026)** has four modes: the bot with video and audio; bot-free video (limited beta, Zoom only); bot-free audio plus transcript; and bot-free transcript only. It's **live on Mac only**, with Windows "coming to PC". Slack Huddles are captured through bot-free mode. Sources: https://www.fathom.ai/whats-new, https://techcrunch.com/2026/04/15/fathom-adds-a-bot-less-meeting-mode-in-a-bid-to-take-on-granola/
- **Speaker labels:** Fathom says it prioritized getting "who said what" right in bot-less transcripts, an area where it says rival bot-less tools fall short. Source: https://techcrunch.com/2026/04/15/fathom-adds-a-bot-less-meeting-mode-in-a-bid-to-take-on-granola/
- **iOS app with in-person capture:** "almost here", so not shipped yet. Source: https://www.fathom.ai/whats-new
- **Paid plans can rename the bot and remove the in-meeting banner.** Source: https://help.fathom.video/en/articles/5290881

## 3. Highlights

- **Clicking Highlight during a call** marks a moment "retroactively to when your attendee started talking". The highlight ends when you next speak, ignoring short phrases like "ok" or "tell me more". Clicking again ends it manually. Custom highlight types are supported. Source: https://help.fathom.video/en/articles/295424
- **The bot-free experience has no live highlights.** "highlights during a call are not currently available." Highlights can still be added afterwards from the transcript, and post-meeting clips are "coming soon as a replacement". Source: https://help.fathom.video/en/articles/295424
- **Adding highlights after the call:** hover a transcript line, click the blue "+", pick a type, and drag to resize. Source: https://help.fathom.video/en/articles/295680

## 4. Transcript and playback

- **Languages:** 38 for transcription. Summaries can auto-translate between Spanish, Portuguese, German, French, Italian and Dutch, and a language drop-down regenerates the summary. Source: https://help.fathom.video/en/articles/296192
- **Editing and trimming:** Users with "Admin" share access can trim the recording and edit the transcript. Source: https://help.fathom.video/en/articles/295616
- **Live view:** The new desktop app shows a live summary that updates during the call, a private scratchpad, and a single post-call workspace for transcript, summary and action items. Source: https://www.fathom.ai/whats-new
- **No real-time transcript through the API.** Transcripts are available only after post-call processing. Source: https://developers.fathom.ai/faq.md
- **Gaps:** No official help article on playback controls (speed, jump to speaker) turned up, so that's unverified.

## 5. Summary templates

- **Template count:** Fathom advertises "over 15 expert meeting templates" for advanced summaries. Source: https://www.fathom.ai/pricing
- **Customizing:** On a call, pick a summary type, click the gear, add instructions, then click "Regenerate Summary". "Apply to Future Summaries" makes the change stick, and an arrow button resets it. Customizing works in the web app only, not the new desktop app. Source: https://help.fathom.video/en/articles/3239809
- **Plan:** The help article says "Premium and Team plan users". The pricing page lists "custom summaries" under Business. *These two Fathom pages conflict.* Sources: https://help.fathom.video/en/articles/3239809, https://www.fathom.ai/pricing
- **Deal summaries** have four templates: Sales, Sales – SPICED, Sales – MEDDPICC, and Sales – BANT. Source: https://help.fathom.video/en/articles/3239809
- **The API returns only one summary per recording,** always in the account's default template and as Markdown. Source: https://developers.fathom.ai/faq.md

## 6. Action items

- **Plan:** AI action items and AI follow-up emails are Premium features. Sources: https://help.fathom.video/en/articles/5290881, https://www.fathom.ai/pricing
- **Export:** Action items go straight into Asana tasks from the Call Summary page. Other task tools, such as Akiflow and Outlook, connect through Zapier. Sources: https://www.fathom.ai/integrations-project-management, https://zapier.com/apps/akiflow/integrations/fathom/1807339/create-tasks-in-akiflow-for-new-action-items-in-fathom
- **Gaps:** The official "Highlighting Action Items" article (help.fathom.video/en/articles/295488) now returns 404. No official article was found on assigning action items to a specific owner.

## 7. Search and Ask Fathom

- **Ask Fathom** is a chat over meeting titles, summaries and transcripts. It's available on Premium and Team, and on Team it also works inside folders. **Chat history is not saved** once you leave the recording view. Source: https://help.fathom.video/en/articles/3239425
- **Account-wide Ask Fathom** (Team and Business) searches every meeting you can access, with saved and shareable prompt collections and role-based prompts. Sources: https://www.fathom.ai/whats-new, https://help.fathom.video/en/articles/3239425
- **Trackers** tag future calls by meaning (for example, competitor mentions or objections) and send alerts to Slack, email or in-app. Source: https://www.fathom.ai/whats-new
- **ChatGPT and Claude** can query your meeting library through MCP. This is available to all users. Sources: https://www.fathom.ai/whats-new, https://developers.fathom.ai/mcp-docs/index.md

## 8. Sharing and clips

- **Link visibility:** anyone with the link, same domain only, or only people added. Source: https://help.fathom.video/en/articles/295616
- **Access roles:**
  - **Limited:** transcript, summary and recording.
  - **Standard:** adds download, highlights and action items. Comments need the Team plan.
  - **Admin:** adds re-sharing, trimming and transcript editing.

  Source: https://help.fathom.video/en/articles/295616
- **"Send Recording"** emails attendees (scheduled calls only). **"Copy Summary"** copies notes and highlights for pasting elsewhere. Source: https://help.fathom.video/en/articles/295616
- **Viewers don't need a Fathom account,** unless a Team Edition setting requires them to sign in on the same domain. Source: https://help.fathom.video/en/articles/296128
- **Clips and playlists** are on every plan, including Free. Source: https://www.fathom.ai/pricing
- **Gaps:** No official help article on clip-level permissions turned up. A third-party guide says clips are shared with "Copy Share Link". Source [3P]: https://supademo.com/blog/how-to-share-video-clips-in-fathom

## 9. API and webhooks (for integration planning)

- **API access, keys and webhooks are on all plans.** Keys are per user, with no org-level keys, and are created under User Settings → API Access. OAuth is available for apps that other users install. Sources: https://developers.fathom.ai/faq.md, https://developers.fathom.ai/
- **Endpoints:**
  - Meetings: list meetings, list meeting types.
  - Recordings: get summary, get transcript, request download, get download status.
  - Teams: list teams, list team members.
  - Users: list users and their permissions.
  - Webhooks: create, delete.
  - SDKs for TypeScript and Python.

  Source: https://developers.fathom.ai/llms.txt
- **Rate limits:**
  - 60 calls per 60 s overall.
  - 30 per 60 s for "heavy" calls (summary or transcript, or `include_summary`/`include_transcript`). This can drop to 5 per 60 s when load is high.
  - 30 per 60 s for downloads.
  - Responses over the limit return 429 with `Retry-After`.

  Source: https://developers.fathom.ai/api-overview.md
- **Data access:** A key sees what its user can see. Others' private calls stay hidden, even to Admins. Source: https://developers.fathom.ai/faq.md
- **Webhooks:**
  - **Trigger:** one "new meeting content ready" event per meeting, and only if a summary is generated.
  - **No update events:** later edits don't fire.
  - **No manual resend.**
  - **Signing:** HMAC-SHA256.
  - **Webhook ID:** returned only once, at creation.

  Source: https://developers.fathom.ai/faq.md
- **Pagination:** fixed at 10 meetings per page, with no bulk endpoint. You can filter by attendee company domain but not by individual attendee. Source: https://developers.fathom.ai/faq.md

## 10. Data and privacy

- **Model training:** Fathom's AI subprocessors (Anthropic, OpenAI, Google) can't train on customer data. Fathom itself trains its own models on de-identified customer data by default. Users can opt out in My Settings, and Team Edition admins can opt out the whole org. Source: https://help.fathom.video/en/articles/296512
- **Location and compliance:** All data is stored in the US. Fathom says it is GDPR-compliant and will sign a DPA on request. Source: https://help.fathom.video/en/articles/296512
- **HIPAA:** a BAA is available on the Enterprise tier. Source: https://www.fathom.ai/pricing

## 11. Weak spots from user reviews

Overall, reviews lean positive. Users mostly praise accuracy, ease of use, the generous free plan and fast support. Source: https://capterra.com/p/276054/Fathom/reviews/ (summarized through search, since the page returned 403 to a direct fetch)

Recurring complaints:
- **The free tier's AI is thin.** Advanced summaries stop after 5 calls a month, and action items are paywalled. Reviewers said "the free tier... needs more features" and that action items "are a premium feature." Sources: https://capterra.com/p/276054/Fathom/reviews/, https://help.fathom.video/en/articles/5290881
- **The visible bot puts people off.** It's described as awkward on sales and first calls. A competitor blog cites 415 G2 mentions of "presence as meeting participant". Sources [Vendor-competitor]: https://anarlog.so/blog/fathom-ai-complaints/, https://prospeo.io/s/fathom-alternatives
- **Auto-join and recording are unreliable.** Reviewers describe the bot not showing up or dropping long Zoom calls. One G2 breakdown counts 342 "recording issues" and 213 "call issues" mentions. Sources [Vendor-competitor]: https://anarlog.so/blog/fathom-ai-complaints/, https://prospeo.io/s/fathom-alternatives
- **Users can't leave the call.** Fathom records only while the user is present. Source: https://help.fathom.video/en/articles/5461313
- **There's no mobile app or in-person capture yet, and no audio upload.** Sources: https://capterra.com/p/276054/Fathom/reviews/, https://www.fathom.ai/whats-new
- **Bot-free mode is Mac-only and has no live highlights.** Sources: https://www.fathom.ai/whats-new, https://help.fathom.video/en/articles/295424
- **Summaries can be generic**, described as "a bit too generalized sometimes". Source: https://capterra.com/p/276054/Fathom/reviews/
- **Sharing and permissions have bugs** (May 2026 review). The CRM integration was "not actually working" for one reviewer. Sources: https://capterra.com/p/276054/Fathom/reviews/, https://www.getapp.com.au/software/2071295/fathom-1
- **Some users reported transcript hallucination** on Zoom, according to a Reddit report quoted second-hand. Source [Vendor-competitor]: https://prospeo.io/s/fathom-alternatives
- **Only one calendar is supported,** and team features are hard to understand. Source: https://capterra.com/p/276054/Fathom/reviews/
- **Ask Fathom history isn't saved.** Source: https://help.fathom.video/en/articles/3239425
- **Data is used for training by default and stored in the US only,** which is a concern for EU buyers. Source: https://help.fathom.video/en/articles/296512

## Vendor comparison for building AFK.ai

The research on how AFK.ai itself should be built (meeting-bot providers, transcription,
AI models, hosting, database, jobs, testing), with prices and sources as of 2026-10-16,
is in [docs/architecture.md](architecture.md). Two findings there bear on the Fathom
comparison: Attendee's bot can record without the owner on the call (Fathom's cannot,
§2), and transcription is a separate cost from the bot hour.

## Open questions (couldn't verify from primary sources)

- **G2 reviews and Reddit threads:** couldn't read either directly. G2 returned 403 and no Reddit threads came up in search, so those signals come second-hand from competitor blogs.
- **Exact plan for custom summaries and CRM sync:** Fathom's own pages contradict each other (see §1 and §5).
- **Playback features** (speed, chapters, speaker filter): no official help article found.
- **Assigning action items to a specific owner:** no official help article found.
