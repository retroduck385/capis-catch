-- CATCH — staff must complete their profile (first + last name) before being assigned
-- Run after 20261005_work_tray.sql. Re-runnable, no drops.
--
-- Staff fill in their own user_profile row on /staffProfilePage (the existing
-- "manage own profile" policy already allows it). The app sends staff there until
-- it's done; this enforces the same rule at the DB so an unnamed account can never
-- end up in an AO/CO slot.

-- ============================================================
-- 1. No assignment without a name (covers self-claim and head assign/reassign)
-- ============================================================
create or replace function public.require_assignee_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if staff_name(new.user_id) is null then
    raise exception 'That staff member has not completed their profile yet';
  end if;
  return new;
end $$;

drop trigger if exists require_assignee_name on public.application_assignments;
create trigger require_assignee_name
  before insert on public.application_assignments
  for each row execute function public.require_assignee_name();

-- ============================================================
-- 2. Heads' assign dropdown only lists staff with a completed profile
-- ============================================================
create or replace function public.list_assignable_staff()
returns table (user_id uuid, role user_role, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.role, staff_name(u.id)
  from users u
  where is_assigning_head() and u.is_active and u.role in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')
    and staff_name(u.id) is not null
  order by u.role, 3;
$$;

revoke execute on function public.list_assignable_staff() from anon;
