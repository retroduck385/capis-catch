-- CATCH — VII. Approval: approvers routed automatically from the bank's authority-limit matrix
-- Run after 20261108_approval_matrix.sql (that one adds the enum values used here; it has to be committed
-- first, so run it on its own). Re-runnable, no drops of data.
--
-- Josh, 2026-11-08:
--   * No new roles. Approver accounts get a POSITION (Credit Dept Head, President, ...). Positions only,
--     no names; the bank's own unit names are written as generic "Lending" titles.
--   * The approval authority is computed from the loan amount + whether V. Exception/s has rows
--     (= deviation). Every active Approver account whose position the authority needs is routed
--     automatically. The CO no longer picks the authority or the approvers.
--   * Reviewers stay a manual, ordered pick by the CO.
--   * The Dept Head / Dispatch Admin can still override the authority in Review / Approval; the approvers
--     follow the new authority.
-- Mirrors src/pages/review/approval.js (bands, authorities, requirements); keep both in step.

-- ============================================================
-- 1. Position on Approver accounts
-- ============================================================
do $$ begin
  create type public.approval_position as enum (
    'CREDIT_DEPT_HEAD', 'CREDIT_DIVISION_HEAD', 'LENDING_DEPT_HEAD', 'LENDING_DIVISION_HEAD',
    'PRESIDENT', 'SENIOR_CREDIT_COMMITTEE', 'EXECUTIVE_COMMITTEE', 'BOARD');
exception when duplicate_object then null; end $$;

-- Users can only update their own phone_number (20260929_form_improvements.sql), so this is head-set only
alter table public.users add column if not exists approval_position approval_position;
do $$ begin
  alter table public.users add constraint approval_position_only_approvers
    check (approval_position is null or role = 'APPROVER');
exception when duplicate_object then null; end $$;

-- Every grant / position change stays in the history
alter table public.staff_role_grants add column if not exists approval_position approval_position;

-- ============================================================
-- 2. Staff accounts (Department Head): role + position
-- ============================================================
drop function if exists public.grant_staff_role(text, user_role);
create or replace function public.grant_staff_role(p_email text, p_role user_role, p_position approval_position default null)
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
  if p_role = 'APPROVER' and p_position is null then
    raise exception 'Choose the approver''s position';
  end if;
  if p_role <> 'APPROVER' and p_position is not null then
    raise exception 'Only Approver accounts have a position';
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

  update users set role = p_role, approval_position = p_position where id = v_user.id;
  insert into staff_role_grants (user_id, role, approval_position, granted_by)
  values (v_user.id, p_role, p_position, auth.uid());
  return v_user.id;
end $$;

-- Change an existing Approver's position (e.g. accounts made before positions existed)
create or replace function public.set_approval_position(p_user_id uuid, p_position approval_position)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_user_role() is distinct from 'DEPT_HEAD' then
    raise exception 'Only the Department Head can change positions';
  end if;
  if p_position is null then raise exception 'Choose a position'; end if;
  if not exists (select 1 from users where id = p_user_id and role = 'APPROVER') then
    raise exception 'Only Approver accounts have a position';
  end if;
  if exists (select 1 from users where id = p_user_id and approval_position = p_position) then return; end if;

  update users set approval_position = p_position where id = p_user_id;
  insert into staff_role_grants (user_id, role, approval_position, granted_by)
  values (p_user_id, 'APPROVER', p_position, auth.uid());
end $$;

drop function if exists public.list_staff_accounts();
create or replace function public.list_staff_accounts()
returns table (user_id uuid, email text, role user_role, approval_position approval_position, name text,
               is_active boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, au.email::text, u.role, u.approval_position, staff_name(u.id), u.is_active, u.created_at
  from users u join auth.users au on au.id = u.id
  where current_user_role() = 'DEPT_HEAD' and u.role <> 'APPLICANT'
  order by u.created_at desc;
$$;

revoke execute on function public.grant_staff_role(text, user_role, approval_position) from anon, public;
revoke execute on function public.set_approval_position(uuid, approval_position) from anon, public;
revoke execute on function public.list_staff_accounts() from anon, public;
grant execute on function public.grant_staff_role(text, user_role, approval_position) to authenticated;
grant execute on function public.set_approval_position(uuid, approval_position) to authenticated;
grant execute on function public.list_staff_accounts() to authenticated;

-- Reviewer / Approver list now carries the position (any staff member may list them)
drop function if exists public.list_review_staff();
create or replace function public.list_review_staff()
returns table (user_id uuid, role user_role, approval_position approval_position, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.role, u.approval_position, staff_name(u.id)
  from users u
  where is_staff() and u.is_active and u.role in ('REVIEWER', 'APPROVER') and staff_name(u.id) is not null
  order by u.role, u.approval_position, staff_name(u.id);
$$;
revoke execute on function public.list_review_staff() from anon;

-- ============================================================
-- 3. The matrix
-- ============================================================
-- Authority for an application: amount band, one step up with a deviation (a row in V. Exception/s)
create or replace function public.approval_tier_for(p_application_id bigint)
returns approval_tier language plpgsql stable security definer set search_path = public as $$
declare
  v_amount numeric;
  v_step int;
  v_ladder text[] := array['DEPT_HEADS', 'CREDIT_DIVISION_AND_LENDING_DEPT', 'CREDIT_AND_LENDING_DIVISIONS',
    'PRESIDENT', 'PRESIDENT_AND_SCC_MEMBER', 'SENIOR_CREDIT_COMMITTEE', 'EXECUTIVE_COMMITTEE', 'BOARD'];
begin
  select loan_amount into v_amount from loan_applications where id = p_application_id;
  if coalesce(v_amount, 0) <= 0 then return null; end if;
  v_step := case when v_amount <= 3000000 then 1 when v_amount <= 5000000 then 2
                 when v_amount <= 10000000 then 3 when v_amount <= 20000000 then 4
                 when v_amount <= 30000000 then 5 when v_amount <= 50000000 then 6 else 7 end
          + case when exists (select 1 from fp_exceptions where application_id = p_application_id) then 1 else 0 end;
  return v_ladder[v_step]::approval_tier;
end $$;

-- What an authority needs: groups that must all be met; each group is met by ANY one of its options
-- ({position, count}). Committees decide as a body, so one committee account records the decision.
create or replace function public.approval_requirements(p_tier approval_tier)
returns jsonb language sql immutable set search_path = public as $$
  select case p_tier::text
    when 'DEPT_HEADS' then
      '[[{"position":"CREDIT_DEPT_HEAD","count":1}], [{"position":"LENDING_DEPT_HEAD","count":1}]]'
    when 'CREDIT_DIVISION_AND_LENDING_DEPT' then
      '[[{"position":"CREDIT_DIVISION_HEAD","count":1},{"position":"CREDIT_DEPT_HEAD","count":2}], [{"position":"LENDING_DEPT_HEAD","count":1}]]'
    when 'CREDIT_AND_LENDING_DIVISIONS' then
      '[[{"position":"CREDIT_DIVISION_HEAD","count":1},{"position":"CREDIT_DEPT_HEAD","count":2}], [{"position":"LENDING_DIVISION_HEAD","count":1},{"position":"LENDING_DEPT_HEAD","count":2}]]'
    when 'PRESIDENT' then '[[{"position":"PRESIDENT","count":1}]]'
    when 'PRESIDENT_AND_SCC_MEMBER' then
      '[[{"position":"PRESIDENT","count":1}], [{"position":"SENIOR_CREDIT_COMMITTEE","count":1}]]'
    when 'SENIOR_CREDIT_COMMITTEE' then '[[{"position":"SENIOR_CREDIT_COMMITTEE","count":1}]]'
    when 'EXECUTIVE_COMMITTEE' then '[[{"position":"EXECUTIVE_COMMITTEE","count":1}]]'
    when 'BOARD' then '[[{"position":"BOARD","count":1}]]'
  end::jsonb;
$$;

-- Every active Approver account (with a staff profile) holding a position the authority mentions
create or replace function public.approvers_for_tier(p_tier approval_tier)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(u.id order by u.approval_position, staff_name(u.id)), '{}')
  from users u
  where u.role = 'APPROVER' and u.is_active and staff_name(u.id) is not null
    and u.approval_position::text in (
      select o ->> 'position' from jsonb_array_elements(approval_requirements(p_tier)) g,
                                   jsonb_array_elements(g) o);
$$;

-- Refuses when a group can't be met with the approver accounts that exist
create or replace function public.check_approvers_cover(p_tier approval_tier)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_group jsonb;
begin
  for v_group in select g from jsonb_array_elements(approval_requirements(p_tier)) g loop
    if not exists (
      select 1 from jsonb_array_elements(v_group) o
      where (select count(*) from users u
             where u.role = 'APPROVER' and u.is_active and staff_name(u.id) is not null
               and u.approval_position::text = o ->> 'position') >= (o ->> 'count')::int) then
      raise exception 'Not enough approver accounts for this approval authority (missing: %). Ask the Department Head to add them in Staff Accounts.',
        (select string_agg(lower(replace(o ->> 'position', '_', ' '))
                           || case when (o ->> 'count')::int > 1 then ' ×' || (o ->> 'count') else '' end, ' or ')
         from jsonb_array_elements(v_group) o);
    end if;
  end loop;
end $$;

-- Internal: the page computes the same thing from what the caller can already read
revoke execute on function public.approval_tier_for(bigint) from public, anon, authenticated;
revoke execute on function public.approvers_for_tier(approval_tier) from public, anon, authenticated;
revoke execute on function public.check_approvers_cover(approval_tier) from public, anon, authenticated;

-- ============================================================
-- 4. Routing: CO picks reviewers only; approvers come from the authority
-- ============================================================
drop function if exists public.send_for_review(bigint, approval_tier, uuid[], uuid[]);
create or replace function public.send_for_review(p_application_id bigint, p_reviewers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage application_stages;
  v_pkg financial_packages;
  v_tier approval_tier;
  v_review bigint;
  v_note text := 'Sent for review by ' || coalesce(staff_name(auth.uid()), 'Credit Officer');
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  select * into v_stage from application_stages where application_id = p_application_id and left_at is null;
  if not co_can_edit(p_application_id)
     or not coalesce(v_stage.stage in ('CREDIT_INVESTIGATION', 'CREDIT_EVALUATION'), false) then
    raise exception 'Only the assigned Credit Officer can send for review, while the application is in Credit Investigation or Credit Evaluation';
  end if;
  if exists (select 1 from review_assignments where application_id = p_application_id and unassigned_at is null) then
    raise exception 'This application was already sent for review';
  end if;

  select * into v_pkg from financial_packages where application_id = p_application_id;
  if v_pkg.credit_result is null or v_pkg.credit_result = 'DEFERRED' then
    raise exception 'Save a Credit Result of Endorsed or Not endorsed in the Financial Package first';
  end if;

  v_tier := approval_tier_for(p_application_id);
  if v_tier is null then raise exception 'The application has no loan amount, so the approval authority can''t be set'; end if;
  perform check_approvers_cover(v_tier);

  update financial_packages set approval_tier = v_tier
  where application_id = p_application_id and approval_tier is distinct from v_tier;
  perform sync_review_assignments(p_application_id, 'REVIEWER', p_reviewers);
  perform sync_review_assignments(p_application_id, 'APPROVER', approvers_for_tier(v_tier));

  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_stage.id, 'DONE', auth.uid(), v_note);
  update application_stages set left_at = now() where id = v_stage.id;

  insert into application_stages (application_id, stage) values (p_application_id, 'REVIEW')
  returning id into v_review;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_review, 'PENDING', auth.uid(), v_note);

  update loan_applications set status = 'UNDER_REVIEW' where id = p_application_id;
end $$;

revoke execute on function public.send_for_review(bigint, uuid[]) from anon;

-- Dept Head / Dispatch Admin, in Review or Approval: reviewers, and optionally override the authority
-- (null = keep the saved one). Approvers are re-matched to the authority every time, so this also picks up
-- approver accounts added or deactivated since sending.
drop function if exists public.update_review_routing(bigint, approval_tier, uuid[], uuid[]);
create or replace function public.update_review_routing(p_application_id bigint, p_tier approval_tier, p_reviewers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage workflow_stage;
  v_tier approval_tier;
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  select stage into v_stage from application_stages where application_id = p_application_id and left_at is null;
  if not coalesce(current_user_role() in ('DEPT_HEAD', 'DISPATCH_ADMIN'), false)
     or not coalesce(v_stage in ('REVIEW', 'APPROVAL'), false) then
    raise exception 'Only the Dept Head or the Dispatch Admin can change the reviewers and approval authority, while the application is in Review or Approval';
  end if;

  v_tier := coalesce(p_tier, (select approval_tier from financial_packages where application_id = p_application_id),
                     approval_tier_for(p_application_id));
  if v_tier is null then raise exception 'Pick the approval authority'; end if;
  perform check_approvers_cover(v_tier);

  update financial_packages set approval_tier = v_tier
  where application_id = p_application_id and approval_tier is distinct from v_tier;
  perform sync_review_assignments(p_application_id, 'REVIEWER', p_reviewers);
  perform sync_review_assignments(p_application_id, 'APPROVER', approvers_for_tier(v_tier));
end $$;

revoke execute on function public.update_review_routing(bigint, approval_tier, uuid[]) from anon;
