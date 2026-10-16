-- The contacts table grants only what the app uses (audit F10).
--
-- Every other table revokes Supabase's default grants before granting columns back;
-- migration 33 granted select and delete on contacts without the revoke, so the default
-- insert, update, truncate, references and trigger grants to anon and authenticated
-- stayed in place. Row Level Security still refused those writes (no policy allows
-- them), but the grant is the first layer and should say the same thing.
revoke all on public.contacts from anon, authenticated;
grant select, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;
