-- CATCH — staff accounts created by the Department Head
-- Run after 20261007_staff_profile_required.sql. Re-runnable, no drops of data.
--
-- The login itself is created by the app through the normal sign-up call (the
-- sign-up trigger makes it an APPLICANT); the Department Head then gives it a
-- staff role with grant_staff_role(). Nobody else can change a role from the client.
-- Every grant is kept in staff_role_grants (who, which role, when).

-- ============================================================
-- 1. History of role grants (audit)
-- ============================================================
create table if not exists public.staff_role_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  role user_role not null check (role <> 'APPLICANT'),
  granted_by uuid not null references public.users(id),
  granted_at timestamptz not null default now()
);
create index if not exists staff_role_grants_user on public.staff_role_grants (user_id, granted_at);

alter table public.staff_role_grants enable row level security;
revoke insert, update, delete, truncate on public.staff_role_grants from anon, authenticated;

drop policy if exists "dept head reads role grants" on public.staff_role_grants;
create policy "dept head reads role grants" on public.staff_role_grants
  for select to authenticated using (public.current_user_role() = 'DEPT_HEAD');

-- ============================================================
-- 2. Give an account a staff role (Department Head only)
--    Only for accounts that are still plain applicants with no loan application,
--    so a borrower's account can't be turned into a staff account.
-- ============================================================
create or replace function public.grant_staff_role(p_email text, p_role user_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user users%rowtype;
begin
  if current_user_role() is distinct from 'DEPT_HEAD' then
    raise exception 'Only the Department Head can create staff accounts';
  end if;
  if p_role is null or p_role = 'APPLICANT' then
    raise exception 'Choose a staff role';
  end if;

  select u.* into v_user
  from users u join auth.users au on au.id = u.id
  where lower(au.email) = lower(trim(p_email));

  if not found then
    raise exception 'No account found for %', trim(p_email);
  end if;
  if v_user.role <> 'APPLICANT' then
    raise exception '% already has a staff account (%)', trim(p_email), replace(lower(v_user.role::text), '_', ' ');
  end if;
  if exists (select 1 from loan_applications where user_id = v_user.id) then
    raise exception '% is an applicant with a loan application and cannot be made a staff account', trim(p_email);
  end if;

  update users set role = p_role where id = v_user.id;
  insert into staff_role_grants (user_id, role, granted_by) values (v_user.id, p_role, auth.uid());
  return v_user.id;
end $$;

-- ============================================================
-- 3. Staff accounts list for the Department Head
-- ============================================================
create or replace function public.list_staff_accounts()
returns table (user_id uuid, email text, role user_role, name text, is_active boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, au.email::text, u.role, staff_name(u.id), u.is_active, u.created_at
  from users u join auth.users au on au.id = u.id
  where current_user_role() = 'DEPT_HEAD' and u.role <> 'APPLICANT'
  order by u.created_at desc;
$$;

revoke execute on function public.grant_staff_role(text, user_role) from anon, public;
revoke execute on function public.list_staff_accounts() from anon, public;
grant execute on function public.grant_staff_role(text, user_role) to authenticated;
grant execute on function public.list_staff_accounts() to authenticated;
