-- Only the person who sent AFK is listened to (owner's decision). The bot
-- route stores the names the sender is known by when it sends the bot; the live webhook
-- and the after-call parser match speakers against them. The platform's host flag no
-- longer confers authority, so "platform" is no longer a way the commander was found.

alter table public.meetings
  add column sender_names text[] not null default '{}'
    check (array_length(sender_names, 1) is null or array_length(sender_names, 1) <= 12),
  -- When someone other than the sender addressed AFK in the call and the chat was told.
  add column refusal_noticed_at timestamptz;

-- Earlier meetings that were resolved by the platform's flag were the owner's own calls.
update public.meetings set host_detected_by = 'name' where host_detected_by = 'platform';

alter table public.meetings drop constraint meetings_host_detected_by_check;
alter table public.meetings
  add constraint meetings_host_detected_by_check
    check (host_detected_by in ('name', 'only'));
