# AFK.ai — design

Approved 2026-10-16. The look, the shared pieces, the two frames, every page, the meeting
page in detail, how speakers are told apart, the loading, empty and error states, and
accessibility to WCAG 2.2 AA. Code rules are in [conventions.md](conventions.md).

## Foundations

- **Type.** Instrument Sans for everything (400, 500, 600). JetBrains Mono for times,
  dates, commands, badges and small labels. Loaded with `next/font`, self-hosted,
  `display: swap`. **Nothing in italics**; emphasis is weight 600.
- **Tokens only.** Components use `bg-background`, `text-foreground`,
  `text-muted-foreground`, `bg-card`, `border-border`, `ring-ring`, `bg-accent`,
  `text-accent-foreground`, `bg-destructive`, `--success`, `--warning`, and
  `--speaker-1` to `--speaker-8`. Raw colour values exist only in `globals.css`, as the
  light and dark values of the same names. **Amber is the accent.** Because amber text on
  white fails AA below 18 px, amber is used for fills with dark text, lines, the focus
  ring and the chair's line, never for small text.
- **Theme.** Light by default, with a dark mode from the same tokens. A sun/moon toggle in
  the header stores the choice in a cookie (so the server renders the right theme with no
  flash) and in `localStorage` as a fallback. The toggle is a button with `aria-pressed`
  and the label "Switch to dark mode" or "Switch to light mode".
- **The mark.** An empty chair with an amber line across the seat: the bot sits in so you
  don't have to. A placeholder SVG until the owner supplies the final art. The icons,
  favicon and social image are all drawn from that one SVG, with a monochrome variant
  and a 16 px check.
- **Tone.** Calm and clear. Focus always visible. The app speaks in gaming words in
  navigation and headings, and in plain words wherever the user must understand what will
  happen. Every gaming label carries its plain meaning for screen readers and on hover
  ("Spells — tasks waiting for approval"). Buttons that send, delete or cost money say
  what they do ("Send email", not "Cast").

| Game word | Plain meaning |
|---|---|
| Quest log | The dashboard |
| Quest | A meeting |
| Spells | Tasks waiting for approval (cards) |
| Lore | Memory |
| Loadout | Connectors |
| Tutorial | Sample meetings |
| Summon AFK | Send the bot |
| Player card | The user's record: level, streak, badges |

## Shared pieces

From shadcn/ui in `components/ui/`, composed in `components/`.

| Piece | Variants and states | Notes |
|---|---|---|
| **Button** | primary (amber fill, dark text), secondary (outline), ghost, destructive; sizes sm and md; loading (spinner, `aria-busy`, width unchanged); disabled | 44 × 44 px minimum hit area on touch |
| **Chip** | filter (toggle, `aria-pressed`), removable (× with a label), status (dot + text) | Speaker filter, date range, Spell type |
| **Input** | text, search (with clear), textarea, PIN (four boxes, one `input` each, auto-advance) | Always a visible `<label>`; error text linked by `aria-describedby` |
| **Card** | default, interactive (the whole card is one link), spell (type icon, one-line what, recipients with reasons, Approve / Send back / Dismiss) | A spell card never truncates recipients |
| **Badge** | mono label: state (`recording`, `ready`, `failed`), count, plan | JetBrains Mono, 11 px, uppercase, tracked |
| **Tabs** | underline tabs; a scrollable row on phones | Roving tab index, arrow keys |
| **Toast** | success, info only; never an error the user must read | Bottom-centre on phones, bottom-right on desktop; dismiss button |
| **Skeleton** | shaped like what it replaces (list row, transcript line, summary point) | No layout shift |
| **Page title** | h1, optional mono eyebrow (date, length), optional actions on the right | One h1 per page |
| **Timestamp button** | `12:34` in mono; a `<button>` that seeks the player; `aria-label="Jump to 12 minutes 34 seconds"` | In emails it is a link with `?t=`; it is the one piece used by every claim |
| **Speaker mark** | 24 px circle in `--speaker-n` with a letter; the name beside it where space allows | See Speakers |

Also from shadcn unchanged: Dialog, Dropdown menu, Tooltip, Switch, Progress, Sonner.

## Two frames

**App shell** — signed-in pages, including guests.

```
┌──────────┬──────────────────────────────────────────┐
│ ▣ AFK.ai │  [page title]                 [☀/☾] [👤] │
│          │                                          │
│ Quests   │                                          │
│ Spells 3 │              page content                │
│ Lore     │                                          │
│ Loadout  │                                          │
│ Tutorial │                                          │
│──────────│                                          │
│ Summon   │                                          │
│  AFK  ▶  │                                          │
└──────────┴──────────────────────────────────────────┘
```

Sidebar 240 px; icons only below 1024 px; a bottom bar of five icons on phones (Quests,
Spells, Summon, Lore, more). "Summon AFK" is the one primary button. The Player card is
**not** in the sidebar; it is reached from one line under the Quest log's list.

**Public header** — signed-out pages, clip and PIN pages.

```
┌───────────────────────────────────────────────────────┐
│ ▣ AFK.ai      Tutorial   How it works   [☀/☾] [Try it]│
└───────────────────────────────────────────────────────┘
```

"Try it" goes to Summon AFK and creates the guest workspace on the first action. Clip and
PIN pages show only the mark and the theme toggle.

## Pages

### Landing (`/`)

```
┌ header ──────────────────────────────────────────────┐
│ ┌ full-screen hero video (12 s), scroll = playhead ┐ │
│ │  ▣   You weren't there. AFK was.                  │ │
│ │      [Try the Tutorial]  [Summon AFK]             │ │
│ └───────────────────────────────────────────────────┘ │
├─ How it works (timeline, each step pinned as the ────┤
│  video reaches it)                                    │
│   1  Summon AFK to a call                             │
│   2  It sits in, records, listens for "AFK, …"        │
│   3  Catch up: summary, chapters, every claim linked  │
│   4  Approve what goes out                            │
├─ Tutorial: five real meetings ───────────────────────┤
│ [meeting] [meeting] [meeting] [meeting] [meeting]    │
├─ Become a test user: [Gmail address      ] [Send] ───┤
├─ footer: Privacy · ICSI credit ──────────────────────┤
```

- The hero is a twelve-second video; the visitor's scroll is its playhead. Scrolling
  forward plays it, scrolling back rewinds it. Under `prefers-reduced-motion` the video
  shows its poster with a play button and the page scrolls normally.
- The poster image is the LCP element; the video loads after first paint, muted,
  `playsinline`, with `preload="metadata"`. A placeholder video until the owner supplies
  the real one.
- The test-user form takes one Gmail address and a consent line ("so we can add you as a
  Google test user"), stores it once, and says so. It is the only form on the page.

### Quest log (`/app/quests`, the dashboard)

```
┌ Quest log                               Tue 16 Oct  ┐
│ ┌ Waiting for you ───────────────────────────────┐  │
│ │ 3 spells  [Review]      1 quest processing      │  │
│ └────────────────────────────────────────────────┘  │
│ ┌ Tutorial quest (first-run checklist, 3 of 7) ──┐  │
│ ┌ This week ─────────────────────────────────────┐  │
│ │ Wed 10:00 Pricing sync          [Summon ▶]      │  │
│ │ Thu 14:00 1:1 with Sam          AFK will join   │  │
│ └────────────────────────────────────────────────┘  │
│ Quests                                               │
│ ▸ title · 16 Oct · 61 min · ⒶⒷⒸ+5 · one-liner      │
│ ▸ title · … · [recording]                            │
│ ───────────────────────────────────────────────────  │
│ Player card · Lv 3 · 2-week streak · 4 badges  ›     │
└──────────────────────────────────────────────────────┘
```

### Meeting (`/app/meetings/[id]`; `/meetings/[id]` for the Tutorial)

Desktop (1024 px and up):

```
┌ Pricing sync   16 Oct · 61 min · ⒶⒷⒸⒹⒺⒻⒼⒽ      [Share ▾] [⋯] ┐
│ [🔍 find in meeting   3 of 17 ‹ ›]   chips: Ⓐ Ⓑ Ⓒ … (filter)  │
│ ┌ transcript (60 %) ────────────────┐ ┌ notes (40 %) ────────┐ │
│ │ ▸ 00:00  Ⓐ Speaker A              │ │ [video — bot meetings]│ │
│ │   text…                           │ │ Summary · Chapters ·  │ │
│ │ ▸ 00:14  Ⓑ Speaker B  ◀ now       │ │ Actions · Activity    │ │
│ │   text…                           │ │ Catch me up ▾         │ │
│ │   …virtualised…                   │ │ • point · 12:34       │ │
│ │                                   │ │ • point · 13:02       │ │
│ │                                   │ │ ☐ action · Ⓑ · Fri    │ │
│ │                                   │ │ [type a command…]     │ │
│ └───────────────────────────────────┘ └───────────────────────┘ │
│ ┌ player (docked) ─────────────────────────────────────────────┐ │
│ │ ▶  00:14 ────●──────────────────── 61:02   1.5× ▾  ⌨        │ │
│ │ ▁▂▃▅ chapters strip  |  ⒶⒷⒸⒹⒺⒻⒼⒽ who-spoke-when rows    │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

- **Transcript** is the client island: virtualised, the current line marked with a left
  amber bar and the word "now", auto-scroll pauses when the user scrolls and a "Jump to
  now" button appears. Each line: timestamp button, speaker mark, text.
- **Notes** beside it, in tabs: **Summary** (template picker, points with timestamp
  buttons, copy, regenerate on own meetings), **Chapters** (list, also drawn on the
  player strip), **Actions** (action items with checkboxes, decisions, notes,
  highlights), **Activity** (commands and questions, own meetings only). The command box
  sits under the tabs on own meetings.
- **Player** docked below both columns: play, time, scrubber, speed, keyboard help;
  the chapters strip and the who-spoke-when rows under it. For bot meetings the **video
  sits above the notes**, at the top of the right column; the docked bar stays the
  controls for both.
- **Find** marks matches in the transcript and on the player strip.

Phone (below 768 px):

```
┌ ‹ Pricing sync            [⋯] ┐
│ [video 16:9 — bot meetings]   │
│ 61 min · ⒶⒷⒸ +5              │
│ tabs: Transcript · Notes      │
│ [🔍 find           3/17 ‹ ›]  │
│ 00:14 Ⓑ Speaker B  ◀ now      │
│ text…                         │
│ …                             │
├ mini player (sticky) ─────────┤
│ ▶ 00:14 ──●──────  1.5×   ⌃   │
└───────────────────────────────┘
```

Notes becomes one tab holding a segmented control (Summary, Chapters, Actions). The video
collapses into the mini player on scroll. ⌃ expands the full player with the chapters
strip and speaker rows. The speaker filter moves into the find row's ⋯ menu. The mini
player sits above the bottom bar with safe-area padding.

### Search (`/app/search`; `/search` for the Tutorial)

```
┌ Search                                              ┐
│ [🔍 what did we decide about pricing      ] [×]     │
│ chips: Date ▾   Speaker ▾   Tutorial ☐              │
│ 17 results                                          │
│ ▸ Pricing sync · Ⓑ Sam · 12:34 · "…raise the        │
│   starter plan to…"                                 │
```

Each result is one interactive card; its timestamp opens the meeting at the moment.

### Share pages (`/clips/[token]`, `/shared/[token]`)

```
clip:                               PIN:
┌ ▣ AFK.ai           [☀/☾] ┐        ┌ ▣ AFK.ai      [☀/☾] ┐
│ Pricing sync · 16 Oct     │        │ Enter the PIN        │
│ ┌ player (range only) ─┐  │        │ [_] [_] [_] [_]      │
│ └──────────────────────┘  │        │ [Open meeting]       │
│ Ⓑ Sam   "quote…"  12:34   │        └──────────────────────┘
│ Ⓓ Priya "quote…"  12:51   │        then: the meeting page in the
│ Recorded with AFK.ai      │        public frame, Summary and
└───────────────────────────┘        Chapters only, no owner name
```

### Summon AFK (`/app/summon`)

```
┌ Summon AFK                                           ┐
│ Meeting link   [https://zoom.us/j/…             ]    │
│ Language       (•) English and Urdu   ( ) English    │
│ Capture        ( ) Audio + video      (•) Audio only │
│ ┌ ⚠ AFK announces itself when it joins and everyone │
│ │   on the call can see it. Only send it to calls   │
│ │   where everyone has agreed to be recorded. Your  │
│ │   meetings are private to you.                    │
│ [Summon AFK ▶]                 2 of 2 bot hours left │
│ ─ or pick from this week ─  (calendar list)          │
```

The language choice is remembered in the browser. It sets Deepgram's multilingual mode
when Deepgram is on; with captions it is informational.

### Lore (`/app/lore`)

```
┌ Lore                       [Download ▾] [Erase all] ┐
│ tabs: Profile · People · Projects · Words · Style   │
│ NEW (3)                                             │
│ ▸ Sam owns the pricing page   Pricing sync · 12:34  │
│   "Sam owns the pricing page"  [Accept] [Edit] [✕]  │
│ ALL                                                 │
│ ▸ entry · source · edited 2 Oct                     │
```

### Loadout (`/app/loadout`)

```
┌ Loadout                                               ┐
│ ┌ Gmail ─────────────┐ ┌ Google Calendar ─┐ ┌ Slack ─┐│
│ │ Send emails as you │ │ Read your week,  │ │ Post   ││
│ │ Connected · h@…    │ │ create invites   │ │ as you ││
│ │ reconnect by 23 Oct│ │ Not connected    │ │[Connect]│
│ │ [Reconnect] [Off]  │ │ [Connect]        │ │        ││
│ │ permissions: …     │ │ permissions: …   │ │        ││
```

Google connections are in Testing mode and expire after seven days; each card shows
"reconnect by <date>" and turns to "reconnect now" when due.

### Spells (`/app/spells`)

```
┌ Spells            chips: Waiting · Sent · Needs check · Dismissed ┐
│ ┌ ✉ Email to Sam Lee, Priya N.             Pricing sync · 12:34 ┐│
│ │ sam@acme.com — from the invite to Pricing sync, 12 Oct         ││
│ │ Subject · body preview…                                        ││
│ │ [Approve · sends from your Gmail]  [Send back]  [Dismiss]      ││
│ └────────────────────────────────────────────────────────────────┘│
```

### Privacy (`/privacy`)

A plain document in the public frame: what is recorded, who can see it, what is sent and
when, where data lives, no model training, deletion, test-user emails, the ICSI credit.

### Tutorial (`/tutorial`)

The five sample meetings as interactive cards with the corpus credit line, and a link to
the list of changes.

## Speakers

Each speaker gets **a letter and a colour**. The letter is their order of first
appearance (A–Z, so "Sam" and "Sam (2)" differ); the colour is `--speaker-((n − 1) mod
8) + 1`. The letter is always drawn, so colour is never the only cue; past eight speakers
colours repeat but letters do not. The mark has `aria-label="Speaker B, Sam"`. The same
mark appears in the transcript, the filter chips, the who-spoke-when rows, search results
and the clip page. Seed meetings show "Speaker A" as the name; named speakers show the
name beside the mark.

## Loading, empty and error states

| Page | Loading | Empty | Error |
|---|---|---|---|
| Landing | poster image, meeting skeletons | — | Tutorial strip hidden; the rest renders |
| Quest log | skeleton cards | "No quests yet — Summon AFK or open the Tutorial" | "Couldn't load your quests" + Retry |
| Meeting | skeleton transcript lines + notes | processing: a state card with the live step; failed: what failed + Retry | "Couldn't load this meeting" + Retry; audio error: "Reloading audio…" renews the link |
| Search | result skeletons | "No matches for …" with tips | inline error + Retry |
| Clip / PIN | player skeleton | revoked: "This clip is no longer available" / "This meeting is no longer shared" | wrong PIN: inline count; locked: time left |
| Summon | — | — | invalid link, over quota, not admitted: inline, with the next action |
| Lore | section skeletons | "AFK hasn't learned anything yet" per section | inline + Retry |
| Loadout | — | all three "Not connected" | broken connection: "Reconnect now" |
| Spells | card skeletons | "Nothing waiting" | needs-check cards explain; load error + Retry |
| Privacy, Tutorial | — | — | — |

Every error names what happened and the next action; none shows provider text.

## Keyboard, screen readers, reduced motion (WCAG 2.2 AA)

- **Focus** is always visible: a 2 px amber ring with a 2 px offset, on every control,
  in both themes.
- **Keyboard.** A skip link to main. The sidebar is a `nav` with the current page marked.
  Tabs use arrow keys. Transcript lines are buttons in a list: arrow keys move, Enter
  seeks. Player: space play/pause, ← → 5 s, ↑ ↓ speed, `/` focuses find, `n` and `p`
  next and previous match, `?` opens the shortcuts dialog. Nothing needs a mouse.
- **Screen readers.** One `h1` per page; landmarks (`header`, `nav`, `main`, `aside` for
  notes); the player exposes the transcript as `<track kind="captions">`; the current
  line is announced through a polite live region at most every 10 s; state changes (bot
  joined, summary ready, spell sent) use a polite live region; gaming labels carry plain
  descriptions; the timestamp button reads "Jump to 12 minutes 34 seconds".
- **Reduced motion.** The hero shows its poster with a play button; transcript
  auto-scroll uses `scroll-behavior: auto`; skeletons fade only; toasts appear without
  sliding.
- **Contrast.** AA for all text and 3:1 for borders and the focus ring in both themes;
  amber never used for small text.
- **Touch.** 44 px targets; the mini player sits above the bottom bar with safe-area
  padding.
- **Zoom.** 200 % and 375 px with no horizontal scroll; the two-column meeting page
  stacks.
