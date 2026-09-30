-- CATCH — sign-up role
-- Run after 20260929_form_improvements.sql. Re-runnable, no drops.
--
-- Everyone who signs up through the app is an APPLICANT. Staff roles are
-- assigned by an admin (SQL Editor / service role), never by the client.

-- ============================================================
-- 1. Sign-up trigger sets the role explicitly (not via the column default)
-- ============================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, role) values (new.id, 'APPLICANT')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that signed up before the trigger existed
insert into public.users (id, role) select id, 'APPLICANT' from auth.users on conflict (id) do nothing;

-- ============================================================
-- 2. Clients can't create, delete or re-role user rows themselves
--    (only phone_number stays updatable, from 20260929)
-- ============================================================
revoke insert, delete on public.users from anon, authenticated;
revoke update on public.users from anon;
