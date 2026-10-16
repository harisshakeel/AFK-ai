# AFK.ai design

The look and the interface as built: the foundations, the frames, the shared pieces, each
page with a sketch of its layout, how speakers are told apart, the loading, empty and
error states, and accessibility. Code rules are in [conventions.md](conventions.md); the
pages and routes behind each screen are in [architecture.md](architecture.md).

## Foundations

### Type

Two faces, self-hosted through `next/font` (`display: swap`) in `src/app/layout.tsx`:

| Face | Variable | Used for |
|---|---|---|
| Instrument Sans | `--font-instrument-sans` (Tailwind `font-sans`) | Everything: body, buttons, titles, the wordmark |
| JetBrains Mono | `--font-jetbrains-mono` (Tailwind `font-mono`) | Dates and meeting metadata lines, eyebrows, slash commands, file paths, the PIN, keyboard hints |

Titles are not a second family. The `font-display` utility is Instrument Sans at weight
600 with tight tracking; a page's `h1` adds `font-bold`. Eyebrows (the small label above a
title) are mono capitals, tracked wide, in `text-accent-strong`. Times in the transcript
and player use tabular figures.

### Colour tokens

All colours are OKLCH custom properties defined once in `src/app/globals.css` under
`@theme`. Components use the generated utilities (`bg-canvas`, `text-fg-muted`,
`bg-accent-soft` and so on), never raw values, with these exceptions:

- `text-white` on coloured fills: the letters in a speaker mark (`speaker-mark.tsx`), the
  check on a done step or tick (`notes-panel.tsx`, `send-bot-form.tsx`,
  `meeting-processing.tsx`), and the full-screen button over a video (`video-pane.tsx`).
- Black behind a meeting video (`bg-black`, and `bg-black/60` under its corner button).
- Brand colours as hex: the Gmail, Calendar and Slack marks (`brand-marks.tsx`) and the
  Google glyph on the sign-in button (`google-sign-in-button.tsx`).
- The generated images and the manifest, which cannot read CSS variables, carry hex
  copies of the palette (`opengraph-image.tsx`, `layout.tsx`'s `themeColor`). The apple
  icon's background and the manifest's `theme_color` are `#3453d3`, a blue that is not in
  the palette.

| Token | Role |
|---|---|
| `canvas`, `stage` | Page background, a warm cream (`stage` is the hero video's own background) |
| `surface`, `surface-raised` | Cards and panels; hover fills and skeleton blocks |
| `border`, `border-strong` | Hairlines; dashed empty-state boxes |
| `fg`, `fg-muted`, `fg-subtle` | Text in three strengths; `fg-subtle` is the faintest text meant to keep 4.5:1 |
| `accent`, `accent-strong`, `accent-soft`, `on-accent`, `accent-deep` | **Violet**, the one accent: primary buttons, the focus outline, selected tabs and chips, links, the sidebar panel (`accent-soft`) |
| `ink`, `on-ink` | The dark card behind the player level, the same in both themes |
| `signal` | A cyan used only on the Player card and its charts: the current week, what is done, a lit dot |
| `success`, `warning`, `danger` and their `-strong` variants | Status badges and alerts; the `-strong` variants are text on tinted badge backgrounds |
| `now`, `now-strong` | **Amber**: the current transcript line, the line in the logo, highlight ranges on the timeline |
| `match` | Yellow: search matches in the transcript, on the timeline and in search snippets |
| `--color-speaker-1` to `--color-speaker-12` | Twelve speaker hues at equal lightness (outside `@theme`, read through `var()`) |

Radii run from `radius-sm` (0.375rem) to `radius-2xl` (1.5rem). Shadows include `xs`,
`raised` and `float`; keycap shadows for buttons (`press`, `keycap`, `key`), each with a
`-hover` variant and, for `press` and `keycap`, a `-down` variant for the pressed state;
`accent` for a chip that is on (`accent-hover` is defined but unused); `coin` for the
round badges; and `glow-signal`, the cyan glow on the Player card's lit dots and charts.
`--color-shine` is the white sheen that sweeps across a primary button's face.

### Themes

- **Light by default.** The system colour scheme is not followed.
- **Dark is a choice.** The sun/moon button (`src/components/ui/theme-toggle.tsx`) sets
  `data-theme="dark"` on `<html>` and stores `afk-theme` in `localStorage`. An inline
  script in the root layout, under the request's CSP nonce, restores it before first
  paint, so a dark page never flashes light. The dark values redefine the same tokens
  under `:root[data-theme="dark"]`.
- **The landing page stays light.** It is wrapped in `.theme-light`, which resets the
  tokens to the light values inside it, so the cream hero video and the page are one
  surface even when dark mode is on.
- If storage is blocked (a private window), the choice lasts for the page only.

### The mark

An empty chair in profile, drawn in the text colour, with one amber line (`now-strong`)
at head height: you are away, the meeting goes on, and the transcript still lands. The
paths live in `src/components/ui/logo.tsx` (`MARK_PATHS`, `MARK_LINE`, stroke 8). The
other copies carry their own paths rather than importing them: `apple-icon.tsx` and
`opengraph-image.tsx` repeat the same paths, while `src/app/icon.svg` differs slightly
(legs ending at 18 and 49 rather than 17 and 50, the line from 31 to 46, stroke 9). The
files in `public/brand/` are exported images. The `Wordmark` puts the mark beside "AFK"
with a quieter ".ai".

### Motion and feel

- **Buttons are keycaps.** The primary button is a violet gradient with a lit top edge, a
  deep edge beneath it that collapses on press, a glow that grows on hover and a shine
  that sweeps across. Secondary buttons sit on a lighter keycap edge.
- **Pointer physics** (`src/components/ui/interactions.tsx`, mounted once): elements with
  `magnet` (primary and secondary buttons) lean up to 9 px toward a mouse pointer;
  elements with `tilt` (the Player card tiles) turn in 3D with a glare. Mouse only, never
  on touch.
- **Arrival.** `Reveal` fades and lifts a block once as it scrolls into view;
  `RevealWords` raises a heading word by word (`src/components/ui/reveal.tsx`, Framer
  Motion).
- **The loader** is `WaveLoader`: five bars rising and falling, the hero's listening wave
  in miniature, used in place of a spinner everywhere.
- **Skeletons** are raised blocks with a slow sheen (the `skeleton` utility).

### Words

Navigation speaks in game words; page titles, buttons and messages use plain words.

| Nav label | Route | Page title |
|---|---|---|
| Quests | `/dashboard` | Quest log |
| Spells | `/tasks` | What AFK heard, and did |
| Lore | `/memory` | What AFK knows about you |
| Loadout | `/connectors` | What AFK may act through |
| Tutorial | `/samples` | Sample meetings |
| Summon AFK | `/send` | Send AFK to a meeting |

The dashboard keeps the game voice in its body too: "Player one: <name>", quests, side
quests (open action items), spells awaiting your cast, and the Player card
(`/dashboard/record`). Buttons that send or delete say what they do: "Approve and send",
"Delete", "Turn the link off".

## Frames

A page sits in one of five frames.

| Frame | Where | Built by |
|---|---|---|
| App shell | Anyone with a workspace (a guest or a Google user) on the dashboard, the Player card, samples, search, send, memory, tasks and connectors | `src/components/app-shell.tsx`, chosen by `src/components/chrome.tsx` |
| Public header | A visitor with no workspace on samples, search, send, memory, tasks and connectors | `src/components/site-header.tsx`, through `Chrome` |
| Landing frame | `/` and `/privacy` | `src/features/landing/landing-nav.tsx`, `landing-footer.tsx` |
| Meeting frame | `/meetings/[id]`, and `/m/[code]` once the PIN is accepted | The page's own header, full viewport height |
| Bare frame | `/share/[token]`, the PIN form, `/sign-in`, `/welcome`, the error and 404 pages | A wordmark header, or a centred card |

The dashboard always uses the app shell, even for a visitor with no workspace.

### App shell

Wide screens (1024 px and up):

```
┌──────────────┬─────────────────────────────────────────────────────┐
│╭────────────╮│ [🔍 Search what was said in any quest ]  [action] ☾ │
││ ▣ AFK.ai ⇤ ││─────────────────────────────────────────────────────│
││            ││                                                     │
││ ▶ Quests   ││   page content (one column)                         │
││   Spells 3 ││                                                     │
││   Lore     ││                                                     │
││   Loadout  ││                                                     │
││   Tutorial ││                                                     │
││   Summon AFK│                                                     │
││            ││                                                     │
││────────────││                                                     │
││ (H) Haris ⏻││                                                     │
│╰────────────╯│                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
```

- **The sidebar floats:** a rounded panel in `accent-soft` with an equal gap above, below
  and to its left, 16rem wide and sticky to the viewport. The current section is a white
  pill in `accent-strong` with `aria-current="page"`.
- **It collapses to a rail.** The toggle in its head (`sidebar-toggle.tsx`) sets
  `data-sidebar="rail"` on `<html>` and stores `afk-sidebar`; the rail is 5.5rem of
  icons with the labels hidden. The same inline script restores it before first paint.
- **Spells carries a count** of cards waiting for approval (99+ at most), with "since
  Tuesday" or "since 2 Nov" in its title and accessible name once the oldest is a day old.
- **The foot** shows an initial avatar and the name with a sign-out icon button for a
  Google user. A guest sees "Guest. This workspace lives in this browser." and "Continue
  with Google" when sign-in is on.
- **The top bar** holds search across meetings (a GET form to `/search`), the page's
  action and the theme toggle. The action is "Summon AFK to a meeting" on the dashboard,
  a "Quest log" back link on the Player card, nothing on `/send`, and "Send AFK to a
  meeting" on samples, search, memory, tasks and connectors.
- **The wrap-up dialog** (`src/features/meetings/wrap-up.tsx`) opens over any shell page,
  and over the owner's meeting page, once a meeting's notes are written: the headline, the
  numbers, the cards waiting, and "How was the meeting?". It is a native modal `<dialog>`;
  "Done" closes it for good, while "Later" and the close button keep it away for this
  visit only. Its second mode is the nudge: when a card has waited a day and there is no
  fresh wrap-up, the dialog says "Still waiting for you" without the rating, and Done,
  Later or the close button snooze that meeting for a day on the server
  (`POST /api/meetings/<id>/snooze`).

Narrow screens (below 1024 px):

```
┌──────────────────────────────────┐
│ ▣ [🔍 Search…          ] ☾  ⏻   │
│ Quests Spells 3 Lore Loadout … → │  ← scrolls sideways
├──────────────────────────────────┤
│ page content                     │
```

There is no sidebar and no bottom bar. The top bar shows the mark (with the word
"AFK.ai" from 640 px), search, the actions, the theme toggle and a sign-out icon button
(for a guest, a "Continue with Google" icon button). The navigation becomes a strip of
pills under it that scrolls sideways; the current one is filled `accent-soft`.

### Public header

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▣ AFK.ai [🔍 Search what was said in any quest ] [Send AFK…] ☾ [Sign in] │
└────────────────────────────────────────────────────────────────────────┘
```

A sticky bar with a translucent canvas and a blur, content centred at `max-w-5xl`
(search at `max-w-3xl`). "Sign in" appears only when Google sign-in is switched on for
the deployment.

### Landing frame

The header is fixed over the hero with no background of its own; once the page scrolls
past 8 px it takes the canvas, a blur and a hairline. It holds the wordmark, "Samples",
"Send AFK" (from 640 px) and one primary button: "Dashboard" when signed in, "Sign in"
when sign-in is on, nothing otherwise. There is no theme toggle here. The footer carries
the ICSI Meeting Corpus credit (CC BY 4.0) and links to samples, send, search, sign-in
and privacy.

## Shared pieces

All in `src/components/ui/`, written for this app; there is no component library. Icons
are `lucide-react`; the Gmail, Google Calendar and Slack marks are drawn in
`src/features/connectors/brand-marks.tsx`.

| Piece | File | Variants and behaviour |
|---|---|---|
| Button | `button.tsx` | `primary`, `secondary`, `ghost`, `danger`, `outline-danger`; sizes `sm` (32 px), `md` (40 px), `lg` (48 px), `icon` (40 px), `icon-sm` (32 px); all pill-shaped. `loading` shows the wave loader, sets `aria-busy` and blocks a second press. `buttonClass()` styles links as buttons |
| Chip | `button.tsx` (`chipClass`) | A toggle pill used with `aria-pressed`, filled violet when on: summary templates, welcome answers |
| Kbd | `button.tsx` | A small mono keycap for shortcut hints |
| inputClass | `input.tsx` | The class for one pill-shaped text field everywhere; violet border and ring on focus, red border with `aria-invalid`. Every field applies `inputClass()` to its own `<input>` or `<textarea>`; the file's `Input` component is not used |
| Card | `card.tsx` (`cardClass`) | A rounded surface with a hairline; `interactive` lifts 1 px with a stronger border and shadow on hover |
| Badge, Eyebrow | `badge.tsx` | Badge tones `accent`, `neutral`, `success`, `warning`, `danger`, always with words. Eyebrow is the mono label above a title |
| PageTitle | `page-title.tsx` | Eyebrow, `h1` (2.25rem, 2.75rem from 640 px, bold), an optional lede. It accepts an `actions` prop for the right side, but no page passes one: page actions sit in the top bar |
| Tabs | `tabs.tsx` | WAI-ARIA tabs drawn as an underline strip with optional counts; one tab stop, arrow keys and Home/End; the strip scrolls sideways when narrow |
| TimestampButton | `timestamp-button.tsx` | A mono `▶ 12:34` pill that plays from that moment; its name is "Play from 12:34" |
| SpeakerMark | `speaker-mark.tsx` | A 20 px circle in the speaker's colour with a letter or initials in white; hidden from assistive tech, because the name is always beside it or in a label |
| Skeleton | `skeleton.tsx` | A block with the sheen, `aria-hidden` |
| Toast | `toast.tsx` | `info` (a dark pill with a check) or `error` (red, with an alert icon); top centre, at most three, gone after four seconds; inside a polite live region, `role="status"` or `role="alert"` |
| WaveLoader | `wave-loader.tsx` | The five-bar loader; `role="status"` with a label, or hidden inside a busy button |
| Reveal, RevealWords | `reveal.tsx` | Scroll-in arrival, once |
| CountUp | `count-up.tsx` | A number that counts up on the Player card; the server renders the final value |
| ThemeToggle, SidebarToggle | `theme-toggle.tsx`, `sidebar-toggle.tsx` | Ghost icon buttons, described above |
| Logo, Wordmark | `logo.tsx` | The mark and the name |
| Interactions | `interactions.tsx` | The magnet and tilt pointer effects |

Destructive actions (delete a meeting, forget memory, disconnect an app, make a new link
and PIN) ask through the browser's `confirm()`.

## Pages

### Landing (`/`)

```
┌ ▣ AFK.ai                         Samples  Send AFK  [Sign in] ┐ ← floats
│┌─────────────────────────────────────────────────────────────┐│
││                                                             ││
││   twelve-second animation, full screen, sticky              ││
││   the scroll is its playhead                                ││
││                                                             ││
│└─────────────────────────────────────────────────────────────┘│
│                   Away from keyboard?                         │
│        The meeting still gets written up.▌  (typed by scroll) │
│     [Open the hour-long sample]  [Sign in to send AFK]        │
│     [✉ you@gmail.com              Get added to test users ]   │
├─ THE SHORT VERSION ───────────────────────────────────────────┤
│  Link in. Notes out. Here's the route.                        │
│        Drop the link.        (●)                              │
│                              (●)   AFK takes your seat.       │
│     Say the magic word.      (●)                              │
│                              (●)   The notes land.            │
│  It asks before it sends.    (●)                              │
│                              (●)   Then it does the thing.    │
│                                    [Gmail][Calendar][Slack]   │
│     Share what you choose.   (●)                              │
├───────────────────────────────────────────────────────────────┤
│ Lurk first, sign in later.          [sample]  [sign in]       │
├─ footer: credit · Samples · Send · Search · Sign in · Privacy ┤
```

- **The hero** (`src/features/landing/hero.tsx`) is a muted inline video
  (`/landing/hero.mp4` and `.webm`, poster `hero.png`) with a captions track (`hero.vtt`)
  and an accessible name that says what it shows. Nothing is written over the frame.
- **The scroll is its playhead.** A section 480vh tall (700vh from 1024 px) holds a
  sticky full-height stage. How far the page has scrolled through that run sets the
  video's time, eased each frame so a flick glides rather than jumps, up to 10.6 s, where
  the animation shows its last line. Scrolling back rewinds. At the very top the opening
  loops slowly (0.6× speed, up to 0.62 s) so the waveform moves until the first scroll.
  There is no autoplay. A muted play-then-pause on load (and on the first touch) wakes
  the decoder so seeking works on phones.
- **Framing.** On a phone the video is 140% of the screen width, so the cards in its
  middle fill the screen and the empty margins fall off the sides; from 1024 px it fits
  the viewport whole on the cream `stage` background.
- **The claim** is the page's `h1`: "Away from keyboard?", with its second line typed
  character by character as the block rises up the screen, forward and back
  (`typed-lines.tsx`, scroll drive). The full text is always in the DOM for screen
  readers.
- **Three things to do:** open the hour-long sample (`/meetings/bmr007`), sign in (or
  "Your meetings" when signed in), and the test-user form (`test-user-form.tsx`): one
  Gmail address and "Get added to test users", a hint line, then "You're on the list."
  The field and its button share one pill from 640 px and stack below it.
- **The short version** (`feature-flow.tsx`) is a timeline of seven stops. Its spine
  draws itself as the page scrolls, and each stop's coin lights violet and flips once as
  it comes into view. Stops alternate sides from 1024 px and stack beside the spine below.
  Stop three types two spoken commands on a clock.
- Two slow violet blurs drift behind the section.

### Quest log (`/dashboard`)

```
┌ [guest notice]                                  [Summon AFK…] ┐
│ PLAYER ONE: HARIS                                             │
│ Quest log                                                     │
│ 12 quests · 9 hr 40 min played · 4 open side quests           │
│ ┌ quests (scrolls) ──────────────────────┐ ┌ Player card ────┐ │
│ │ [first-run checklist]                  │ │ ▓ Level · XP ▓  │ │
│ │                                        │ │ Twelve weeks ▁▃▅│ │
│ │ [next week on your calendar]           │ │ Side quests ◔   │ │
│ │ ┌ Awaiting your approval  3 ────────┐  │ │ Streak ●●●○     │ │
│ │ │ approval cards                     │  │ │ coins ◎◎◎       │ │
│ │ └────────────────────────────────────┘  │ │ [full card]     │ │
│ │ TODAY                                  │ └─────────────────┘ │
│ │ ┌ Pricing sync ──────────── ⒶⒷⒸ ┐     │                     │
│ │ │ Oct 16 · 1 hr 1 min · 8 · 🔒    │     │                     │
│ │ │ headline…                       │     │                     │
│ │ └─────────────────────────────────┘     │                     │
│ │ THIS WEEK …        [Older meetings]     │                     │
│ └────────────────────────────────────────┘                     │
```

- From 1024 px the page is framed to the viewport: the list column and the 21rem Player
  card column scroll on their own, never the page. Below 1024 px they stack.
- The numbers line is small, mono and quiet. Meetings are grouped Upcoming, Today,
  Yesterday, This week, This month, then by month, newest first, twenty to a page with a
  plain "Older meetings" link.
- **A meeting card** is one link: the title, a mono line with date, length, speaker count
  and a lock ("Yours, private"), up to eight overlapping speaker marks on the right, and
  the headline. A meeting that is not ready shows a badge instead of the marks: "AFK joins
  at the time", "Joining the lobby", "AFK is listening" (with a pulsing dot), "Writing the
  recap" (with the wave loader), or "Couldn't record" in red.
- The order is: the guest notice (above the title, for a guest), then, in the list
  column on the first page only, the first-run checklist (four items, each a link, gone
  when all are done), the next week of calendar meetings (Google users with Calendar
  connected) and the cards awaiting approval, then the meetings grouped by period.
- **The Player card** (`afk-player-card.tsx`) puts the level and its progress on the ink
  card with a violet glow, then twelve weeks of recorded minutes as bars, side quests as
  a ring, the streak as lit weeks, and achievements as coins that spin once on hover.

### Player card (`/dashboard/record`)

A bento of tiles of uneven sizes (`afk-record-panel.tsx`): the level on the ink card with
a violet glow that follows the pointer, twelve weeks of calls, the action ring, commands
as bars, the streak, the longest calls as proportional bars that link to each meeting,
and the badge album. Numbers count up as they appear. The charts are SVG drawn on the
server (`afk-charts.tsx`), each with a sentence for assistive tech. Tiles tilt toward the
mouse.

### Meeting (`/meetings/[id]`)

Wide screens (1024 px and up):

```
┌ ← Pricing sync                      [🔗 Share] [Share the notes] [🗑] ⒶⒷⒸⒹ ┐
│   Oct 16 · 1 hr 1 min · 8 speakers · ICSI <session> ⓘ                     │
│   headline…                                                               │
├ notes (5 parts) ─────────────────────┬ transcript (7 parts) ───────────────┤
│ [video, bot meetings only]            │ [🔍 Find in this meeting 3 of 17 ˄˅]│
│ Summary · Action items 4 · Decisions 2│ (Everyone) (Ⓐ Speaker A) (Ⓑ …)     │
│ · Chapters 6 · Highlights 1 · Tasks 3 │                                     │
│ (Catch me up)(General)(Project update)│ Ⓐ Speaker A                         │
│ (Brief)                               │ 0:00   text…                        │
│ OVERVIEW                              │▌Ⓑ Speaker B         ← now (amber)  │
│ • point ▶12:34                        │▌0:14   text…                        │
│ • point ▶13:02                        │ …              [↓ Back to now]      │
├───────────────────────────────────────┴─────────────────────────────────────┤
│ (▶) ↺ ↻ 0:14 / 1:01:02  ═══ who-spoke-when lanes ═══●═══   1×  [Highlight H]│
└─────────────────────────────────────────────────────────────────────────────┘
```

- **The page fills the viewport** (`h-dvh`): the header, then two panes that scroll on
  their own, then the docked player. Notes are on the left, the transcript on the right.
- **The header** (`meeting-header.tsx`): a back arrow (to the dashboard, or to samples
  on a sample meeting), the title as `h1`, a mono line with date, length and speaker
  count, on a sample its ICSI session with an ⓘ disclosure about the corpus, and the
  headline. The owner also sees the Share panel (link and PIN, below), "Share the notes"
  (which drafts an email card) and Delete. The speaker marks show from 768 px.
- **Notes** (`src/features/summaries/notes-panel.tsx`), in tabs:
  - Summary: template chips, "Notes from the call" marked "said on the call", the
    template's sections with a timestamp button on every point, then potential tasks on
    the owner's meeting.
  - Action items: checkboxes whose ticks are private to the viewer, the owner shown with
    their speaker mark, "Copy all".
  - Decisions (numbered), Chapters (the current one marked), Highlights.
  - Tasks: the owner's commands as approval cards with a typed-command box; labelled
    example cards on a sample meeting. Above the cards a host line says whose spoken
    commands were taken ("Spoken commands were taken from Speaker B, matched to your
    name." or "..., the only person who spoke."), or that AFK could not tell which
    speaker was the owner, with a link to the "Name in calls" field of the profile. Under
    them, "What you can say" is a disclosure listing each spoken command with an example.
    A failed card that is safe to run again (one that never started, or a follow-up or
    reminder) offers "Try again", which approves it again. An email card offers "Open in
    Mail" (a `mailto:` link with the subject and body) and "Copy draft" on its approval
    form and while it is approved.

  While notes are being written a tab shows a status line with the wave loader, and a
  queued, slow or failed message when that applies. If the meeting has commands, a
  status line above the tabs says "AFK heard N commands; they are on the Tasks tab while
  the notes are written."
- **The transcript** (`src/features/transcript/transcript-panel.tsx`): "Find in this
  meeting" with "N of M" and previous and next buttons, speaker filter chips, then the
  turns. A speaker's mark and name start each run of turns; each turn has its time as a
  button and its text. The current line has an amber left bar and the `now` fill and is
  kept a third of the way down while playing. The wheel, a touch drag or the paging keys
  stop the following and show "Back to now". Find matches are marked in `match` yellow,
  with a ring on the active one. Selecting text offers "Highlight selection". Off-screen
  rows use `content-visibility: auto` rather than a virtual list.
- **The player** (`player-bar.tsx`, `timeline.tsx`) is docked at the bottom at every
  width: play (violet, round), back and forward 10 s, the clock, the timeline, the speed
  (cycling 1×, 1.25×, 1.5×, 1.75×, 2×) and Highlight. The timeline has one lane per
  speaker in their colours showing who spoke when, with chapter ticks, match dots,
  highlight ranges in amber and the playhead; hovering shows the time and the chapter.
- **Video.** A bot meeting's MP4 plays at the top of the notes pane, at most 40% of the
  viewport tall, on black, without native controls (the player bar drives it). A click on
  the picture plays or pauses; a corner button goes full screen. The sample meetings are
  audio, played through a hidden `<audio>` element.
- **URL state.** `?t=`, `?tab=`, `?template=` and `?q=` are kept with
  `history.replaceState`, so a reload reopens at the same moment and view.

Phone (below 1024 px):

```
┌ ← Pricing sync   [🔗][Share][🗑] ┐
│   Oct 16 · 1 hr 1 min · 8 spk    │
├──────────────────────────────────┤
│ [video 16:9, bot meetings]       │
│ [ 📄 Notes ][ 💬 Transcript ]    │
│ the chosen pane                  │
│ …                                │
├──────────────────────────────────┤
│ ══ who-spoke-when lanes ══●══    │
│ (▶) ↺ ↻ 0:14 / 1:01:02  1× [Hl] │
└──────────────────────────────────┘
```

The two panes become a two-button switch (`aria-pressed`). A link with `?t=` or `?q=`
opens on the transcript; otherwise the notes come first. The video moves above the
switch. The player puts the timeline on its own row above the controls and pads for the
safe area at the bottom.

**Processing** (`meeting-processing.tsx`). While a bot meeting is not ready, the page is
a narrow column with the title and a step list (Scheduled, Joining the call, Recording,
Processing the recording, Ready) that marks steps done, current (the wave loader, or a
radio icon while recording) and to come, with "This page checks on progress every ten
seconds. A bot that never reports back is closed after six hours." A failed meeting
shows a red alert with the reason. The owner also gets the Delete button under the
steps, in every state.

### Share panel and meeting address (`/m/[code]`)

The owner's Share button opens a disclosure panel (`link-panel.tsx`): "Anyone with the
link and the PIN", the link, the PIN in large mono, "Copy link", "Copy link and PIN",
"Turn the link off" (or on), and "New link and PIN".

```
PIN form                              shared meeting
┌ ▣ AFK.ai ────────────────┐          ┌ ▣ AFK.ai  Pricing sync ─────────────┐
│ ┌──────────────────────┐ │          │ Shared with you · date · length ·   │
│ │ 🔑                   │ │          │ speakers · headline                 │
│ │ A meeting shared with│ │          │ This page is read-only: …           │
│ │ you                  │ │          ├ summary ─────────┬ transcript ──────┤
│ │ PIN [ 1 2 3 4 ]      │ │          │ template chips   │ find, filter     │
│ │ [Open the meeting]   │ │          │ points ▶12:34    │ turns            │
│ └──────────────────────┘ │          ├──────────────────┴──────────────────┤
└──────────────────────────┘          │ player, no Highlight button         │
                                      └─────────────────────────────────────┘
```

The PIN is one numeric field: four digits, `one-time-code` autocomplete, mono with wide
tracking, focused on load. A wrong PIN shows the server's message in an alert under the
field. Once the PIN is accepted the meeting is laid out like the meeting page, read-only:
the summary without the other notes tabs, the transcript without highlighting, the player
without Highlight. A link that is turned off, or a deleted meeting, shows "This meeting
isn't available".

### Shared clip (`/share/[token]`)

```
┌ ▣ AFK.ai ─────────────────────────────┐
│ A clip shared with you                │
│ Pricing sync                          │
│ date · clip length                    │
│ [note from the person who shared it]  │
│ (▶) ═══════●══════   0:12 / 0:45   ↺  │
│ WHAT WAS SAID                         │
│ Ⓑ Speaker B 12:34                     │
│   text… (current line in amber)       │
│ credit · Shared with AFK.ai           │
└───────────────────────────────────────┘
```

The player is confined to the clip's range. A clip from a private meeting is shared as
text only and says so. If the audio fails: "The audio couldn't be loaded right now. The
words are below." with a retry button. An unknown or revoked token shows "This clip
isn't available".

### Search (`/search?q=`)

```
┌ SEARCH                                          ┐
│ 17 matches for "pricing"                        │
│ in 3 meetings; each result opens at the moment. │
│ ┌ Pricing sync ───────────────────────────────┐ │
│ │ Oct 16                                      │ │
│ │ 💬 Speaker B 12:34  "…raise the [pricing]…" │ │
│ │ ✓  Action item 31:02 "…"                    │ │
│ │ 2 more matches in this meeting              │ │
│ └─────────────────────────────────────────────┘ │
```

The search box lives in the top bar of both headers. Results are grouped by meeting, up
to five hits each in meeting order, each a link that opens the meeting at the moment and
on the right tab with the term marked. Without a query the page offers suggestion chips;
with no results it says so, with tips and the same chips.

### Send (`/send`)

```
┌ SEND                               ┬ IN THE CALL                       ┐
│ Send AFK to a meeting              │ What you can say in the call      │
│ [guest notice: No account needed]  │ ┌ /decision "AFK, decision: …" ┐  │
│ Meeting link [https://…         ]  │ │ help text                    │  │
│ Your name in the call [        ]   │ └──────────────────────────────┘  │
│ Title (optional) [             ]   │ ┌ /task … ┐                       │
│ Language ( English | English and Urdu )                                │
│ consent line                       │ …                                 │
│ [Send AFK] [Show me what happens]  │                                   │
```

Two columns from 1024 px, stacked below. Under the link field a line names the platform
it detected, or the reason the link is not valid. The language is a segmented radio
group remembered in the browser (`afk.send.language`). "Show me what happens" plays four
steps as a labelled demo without sending anything. A deployment with no bot keys shows a
warning and only the demo.

### Memory (`/memory`)

```
┌ MEMORY                                                        ┐
│ What AFK knows about you                                      │
│ Profile People Projects Glossary Meetings Actions Email skill │
│ Slack skill Calendar skill Tools     [Download all] [Forget…] │
│ ┌ profile.md · blurb                 written by AFK · date ─┐  │
│ │ (Fields)(Markdown)        │ preview                       │  │
│ │ editor or field form      │ rendered Markdown             │  │
│ │ 1.2 KB of 32 KB   [Save]  │                               │  │
│ └───────────────────────────┴───────────────────────────────┘  │
│ People AFK knows (each contact with where it came from)       │
```

Ten tabs: the nine files and a Tools file rendered from the connectors. The editor and
the preview sit side by side from 1024 px; below that, an Edit/Preview switch shows one
at a time. The profile and the skills open as fields, with the Markdown a click away.
History files and Tools are read-only. Signed out, a labelled demo profile is shown and
nothing saves.

### Tasks (`/tasks`)

"Waiting for you", with a count and the date of the oldest, comes first, as the same
approval cards the meeting's Tasks tab uses. Then "The record": one card per command with
its kind, its source, a status badge, the quoted sentence, the result or the error, and a
link to its meeting's Tasks tab. An approval card shows each filled-in address with the
reason it was chosen and offers "Approve and send" (or "post", or "add to calendar"),
Rewrite and Dismiss.

### Connectors (`/connectors`)

Three cards (Gmail, Google Calendar, Slack), side by side from 768 px. Each has its brand
mark, a state (a green ready icon, or the badges "Reconnect", "Choose a channel", "Not
allowed" or "Not connected"), what it lets AFK do, who it is connected as and when to
reconnect by, and Connect, Reconnect or Disconnect. Slack adds a channel picker; Gmail
adds "Import Google contacts". A guest or a visitor sees one locked panel with "Continue
with Google".

### Samples, sign-in, welcome, privacy

- **Samples** (`/samples`): the meeting list of the public sample meetings, with the
  corpus credit under it.
- **Sign-in** (`/sign-in`): a centred card on a faint dot grid, "Keep your workspace",
  and the Google button.
- **Welcome** (`/welcome`): the same card and dot grid, five questions one screen each
  ("1 of 5" in mono), answers as chips or fields, every step skippable, then a
  confirmation screen. `?preview=1` shows it signed out without saving.
- **Privacy** (`/privacy`): the landing header and footer around a plain document.

## Speakers

Each speaker in a meeting gets a colour and a mark (`src/lib/speakers.ts`):

- **Colour** by position in the meeting's speaker list: `--color-speaker-1` to
  `--color-speaker-12`, twelve hues at the same lightness so none looks more important.
  A thirteenth speaker repeats the first colour.
- **Mark.** "Speaker A" becomes "A" (the letters or digits after "Speaker", at most two);
  a name becomes the initials of its first two words ("Sam Lee" becomes "SL").
- **Colour is never the only cue.** The mark's letters, and the name beside it, always
  carry it. The same colour and mark appear in the transcript, the speaker filter chips,
  the timeline lanes, action-item owners, meeting cards, the meeting header and the
  shared clip.

## Loading, empty and error states

Routes with their own `loading.tsx` show skeletons in the shape of what is coming: the
landing page, the Quest log, a meeting, memory, samples, search, send, a shared clip and
tasks. `/connectors`, `/dashboard/record`, `/m/[code]`, `/sign-in`, `/welcome` and
`/privacy` have none and fall back to `src/app/loading.tsx` (the wave loader and
"Loading…").

| Page | Loading | Empty | Error |
|---|---|---|---|
| Landing | Title, buttons and a panel as skeletons | None | Route error page |
| Quest log | Title block, three meeting cards, the Player card tiles, the wave loader | "No quests yet" with "Summon AFK to a meeting" and "Try the tutorial quests"; "No older quests" past the end | Route error page; a calendar that fails is left out |
| Meeting | Header, notes tabs, transcript lines and the player bar | "No speech was transcribed in this meeting."; per tab, such as "No action items were agreed in this meeting." and "No commands in this meeting" | Notes queued, slow or failed say so in the tab; media that fails: "The audio didn't load. The transcript and notes still work." with Try again; no recording: "This meeting has no recording."; a failed bot: the reason |
| Meeting address | Root fallback | None | Wrong PIN: the server's message; turned off or gone: "This meeting isn't available" |
| Shared clip | Title, player and lines | "Nobody spoke during this clip." | Audio failed: a retry; unknown or revoked: "This clip isn't available" |
| Search | Title and two grouped results | No query: suggestions; no results: "Nothing matched" with tips | Route error page |
| Send | Title and fields | None | Field errors under each field; send errors in an alert |
| Memory | Title, tabs, editor and preview | Empty files show their templates | Save errors as error toasts |
| Tasks | Title and cards | "Nothing yet" with the commands and "Send AFK to a meeting" | A failed command shows its error on its card |
| Connectors | Root fallback | All three "Not connected" | Notices from the OAuth return; "Reconnect" when access ended |
| Samples | The meeting list skeleton | "No sample meetings are loaded" | Route error page |
| Player card, sign-in, welcome, privacy | Root fallback | None | Route error page |

The route error page (`src/app/error.tsx`) says "The page couldn't load" with Try again,
which fetches the segment afresh. The 404 page offers "Back to AFK.ai" and "Sample
meetings". Action errors appear as error toasts or inline alerts in plain words.

## Accessibility

The target is WCAG 2.2 AA. The Playwright journeys in `e2e/` include an axe scan.

### Focus and landmarks

- One focus style everywhere: a 2 px violet outline with a 2 px offset (`:focus-visible`
  in `globals.css`). Buttons and inputs draw a soft violet ring instead.
- Each page has one `h1`. The shell has `aside`, `header`, `nav aria-label="App"`, a
  search form with `role="search"` and a visually hidden label, and `main`. The meeting
  page labels its sections "Meeting notes" and "Transcript".
- There is no skip link.

### Keyboard

Everything is reachable with Tab. The meeting page's shortcuts
(`src/features/meetings/meeting-view.tsx`) are off while focus is in a text field and
while Ctrl, Cmd or Alt is held:

| Key | Does |
|---|---|
| Space or K | Play or pause (Space is left alone on a focused button, link, tab or checkbox) |
| J / L | Back / forward 10 seconds |
| H | Highlight this moment: from where the current speaker started, 20 to 90 seconds long |
| / | Show the transcript and focus Find |

| Where | Keys |
|---|---|
| Timeline (`role="slider"`) | Arrows 5 seconds, Page Up / Page Down 1 minute, Home / End |
| Find in this meeting | Enter for the next match, Shift+Enter for the previous, Escape clears |
| Tabs | Left and Right arrows, Home, End |
| Approval form | Enter in a field approves; Cmd or Ctrl+Enter in the message |
| Full-screen video | The shortcuts keep working; Escape leaves |

There is no shortcuts dialog. The hints are in the controls' names ("Play (K)", "Back 10
seconds (J)", "Highlight this moment (H)") and in a Kbd "H" on the wide Highlight button.

### Screen readers

- Toasts sit in a polite live region; the find count, the welcome step counter and the
  status lines are announced.
- The timeline reads as "12:34 of 1:01:02"; a transcript time reads "Play from 12:34,
  Speaker B"; the current line has `aria-current`.
- Speaker marks are hidden and the name is read instead; meeting cards name the speaker
  count.
- Toggles use `aria-pressed` (chips, the phone pane switch, the theme toggle);
  action-item checkboxes use `role="checkbox"` with `aria-checked`.
- The hero video has an accessible name and a captions track that describes what
  happens; typed text keeps its full string in a visually hidden span.
- The Spells count reads, for example, "3 awaiting your approval, the oldest since
  Tuesday". The game nav labels carry no plain-word description.

### Reduced motion

`prefers-reduced-motion: reduce` is honoured in two layers:

- **CSS.** A global rule shortens every animation and transition to 0.01 ms and sets
  `scroll-behavior: auto`. `motion-safe` gates the toast slide, the wave loader (frozen at
  mid height), the landing drifts, the coin flip and the recording pulse; the button
  shine is hidden.
- **Script.** `useReducedMotion()` (`src/lib/use-reduced-motion.ts`) turns off the magnet
  and tilt effects and the count-up, makes `Reveal` instant, shows typed text whole, and
  draws the timeline spine and lights every coin from the start. The hero drops the scroll
  scrub: the section becomes a normal 16:9 figure, the video loops on its own clock, and
  a Play/Pause button sits in its corner. The transcript jumps to the current line
  instead of scrolling smoothly.

### Contrast and colour

The text tokens are chosen to keep 4.5:1 on canvas and surface in both themes
(`fg-subtle` is the floor), and tinted badges use the `-strong` text variants for that
reason. Status is never colour alone: badges carry words, speakers carry letters, and the
current line has a bar as well as a fill.

### Layout and zoom

Every frame has a single-column layout below 1024 px and stays within the viewport width.
Long rows (the nav strip, tabs, speaker chips) scroll sideways instead of widening the
page.

## Known gaps

- The dashboard's period sections and the privacy page's sections point
  `aria-labelledby` at ids built from their titles, which contain spaces, so the
  reference breaks into several ids and the section names are lost.
- Playback speed goes back to 1× on reload; it is not stored.
- Meeting dates always print in America/Los_Angeles (`MEETING_TIME_ZONE` in
  `src/lib/format-date.ts`), whatever the viewer's zone.
- Small buttons are 32 px tall (`sm`, `icon-sm`), under the 44 px often used for touch.
- The shell is rendered by each page, not by a layout, so while a `loading.tsx` shows,
  the sidebar, search and theme toggle disappear and the skeleton is laid out at another
  width (audit F14).
