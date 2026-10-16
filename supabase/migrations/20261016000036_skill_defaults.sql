-- Better default skills (owner's call: "write better default skills files
-- with detail generic prompts to follow, the user can then tweak them"). The three
-- templates in src/features/memory/files.ts grew from a handful of settings to settings
-- plus the guidance AFK follows (how to open, what to leave out, how "Friday morning"
-- is read). New accounts get them at onboarding; this brings them to the accounts that
-- still hold the first template untouched. A file the owner edited is theirs and stays.
-- The write trigger leaves updated_by alone outside a user's request; updated_at moves
-- so the Memory page shows when the file changed.

update public.memory_files
set content = $new$# Email skill

How AFK drafts the emails you ask for in a call ("AFK, email Sam the launch plan") and
signs the notes you share. The settings are the "- Key: value" lines: edit the value
after the colon. A value in parentheses is a placeholder and counts for nothing until you
replace it. The guidance below the settings is followed too; rewrite any of it in your
own words.

## Settings

- Tone: friendly and direct
- Length: short, 3 to 6 sentences
- Greeting: Hi {first name},
- Sign-off: Best, {my name}
- Language: (the language of my profile)
- Always copy: (addresses, comma separated, or leave empty)
- Never: promise a date that was not said; mention this draft was written by AFK

## How to write it

1. Open with the point. The first sentence says why the email exists, in the words of
   the call: the decision, the ask or the update. No "I hope this finds you well".
2. Then the facts the call gave, in the order it gave them: what was decided, who owns
   what, the date if one was said. One idea per sentence.
3. Close with the next step and who takes it, when the call named one; otherwise end on
   the decision. No "let me know if you have any questions".
4. Write as me, in the first person, to the person named. Their first name once, in the
   greeting; mine only in the sign-off.
5. Plain words and short sentences. A bulleted list only for three or more items; no
   bold, no headings, no exclamation marks.
6. The subject names the topic first, in at most 10 words ("Launch plan: Friday
   deadline and owners"), without "Re:" or "Quick question".

## Rules

1. Only what the call supports. A name, number or date that was not said stays out;
   where one is needed, write "[date]" or "[name]" for me to fill in rather than guess.
2. Say who committed to what ("Sam will send the deck"), not "it was agreed".
3. When the recipient was in the call, skip the recap they already heard: one line of
   context, then the ask.
4. When the sentence names a topic the call did not cover, write the ask itself in a
   sentence or two and say that the details follow.
5. Nothing about AFK, bots, transcripts or recordings in the email.
6. When I send a draft back with a note, change what the note asks and nothing else.
$new$,
    updated_at = now()
where path = 'skills/email.md' and content = $old$# Email skill

How AFK drafts the emails you ask for. One setting per line; edit the value after the colon.

- Tone: friendly and direct
- Length: short, 3 to 6 sentences
- Greeting: Hi {first name},
- Sign-off: Best, {my name}
- Always copy: (addresses, comma separated, or leave empty)
- Never: promise a date that was not said; mention this draft was written by AFK
$old$;

update public.memory_files
set content = $new$# Slack skill

How AFK posts to Slack when you ask for it in a call ("AFK, tell the team on Slack: the
launch moves to Friday"). The post is your own words after the command word, as you said
them; AFK does not rewrite them, so say the post the way you would type it. The card
shows the words and the channel before anything is posted, and you can change both.

## Channels by topic

One line per topic, "- topic: #channel". A post whose words mention the topic goes to
that channel; the first topic found wins. A post about nothing listed goes to the channel
you chose when connecting Slack (the Loadout page). For example, the line
"- launch: #launches" sends "the launch moves to Friday" to #launches. Add yours below.

-

## How to say it in a call

1. Say the topic in the post when you want a listed channel: "AFK, post to Slack: launch
   moves to Friday, Sam owns the deck" lands in the launch channel.
2. One or two sentences: a post is the outcome, not the discussion.
3. Say people's names as they are known in Slack; AFK adds no @-mentions.
4. Nothing private: everyone in the channel reads it.
$new$,
    updated_at = now()
where path = 'skills/slack.md' and content = $old$# Slack skill

How AFK writes the Slack posts you ask for.

- Tone: casual, plain, no emoji
- Length: one or two lines
- Channel by topic: (one per line below, "topic: #channel"; otherwise the channel chosen on the Connectors page)
$old$;

update public.memory_files
set content = $new$# Calendar skill

How AFK books the follow-ups ("AFK, follow-up with Sam next Tuesday at three") and the
reminders ("AFK, remind me Friday morning to send the deck") you ask for in a call. The
settings are the "- Key: value" lines: edit the value after the colon. A value in
parentheses is a placeholder. The guidance below the settings is followed too; rewrite
any of it in your own words.

## Settings

- Default length: 30 minutes
- Working hours: 10:00 to 18:00
- Working days: Monday to Friday
- Time zone: (from your profile)
- Morning means: 10:00
- Afternoon means: 14:00
- End of day means: 17:30
- Always invite: (addresses, comma separated, or leave empty)
- Title style: "Follow-up: {topic}" for a meeting, "Reminder: {what}" for a reminder

## How to read the time

1. The words in the sentence win, exactly as said: "next Tuesday at three" is the
   Tuesday after the call's week at 15:00; "tomorrow" is the day after the call.
2. An hour with no am or pm is the one inside my working hours ("at three" is 15:00);
   when neither fits, the morning one.
3. "Morning", "afternoon" and "end of day" mean the hours in the settings; a day with no
   hour ("Friday") starts at the beginning of my working hours.
4. "Next week" with no day is the first working day of that week. Never a weekend or an
   hour outside my working hours unless I said so.
5. The length is the one I said, else the default length. A reminder has no length: it
   pops up at the time.
6. When no day or time was said at all, leave the time empty; I set it on the card.

## What goes in the invite

1. The title follows the title style, with the topic from my words ("Follow-up: launch
   plan"), never "Meeting" alone.
2. The invitees are the people I named, plus the always-invite list. "Everyone" means
   the people on the call, which I confirm on the card.
3. A reminder is for me alone: no invitees.
$new$,
    updated_at = now()
where path = 'skills/calendar.md' and content = $old$# Calendar skill

How AFK books the follow-ups and reminders you ask for.

- Default length: 30 minutes
- Working hours: 10:00 to 18:00
- Time zone: (from your profile)
- Always invite: (addresses, comma separated, or leave empty)
- Add a Google Meet link: yes
$old$;
