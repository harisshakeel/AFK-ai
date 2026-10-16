-- The tie notice has its own once-a-meeting flag (audit F2, re-score 2026-10-17). It
-- shared refusal_noticed_at with the "only the sender" notice, so when a stranger had
-- addressed AFK earlier in the call, a later tie went unexplained and the sender's live
-- questions went unanswered without a word.

alter table public.meetings
  -- When two speakers matched the sender's names, AFK took no live commands, and the chat was told.
  add column tie_noticed_at timestamptz;
