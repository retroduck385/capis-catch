-- CATCH — VII. Approval (KYC-FP "FP" tab): the Credit Officer routes the application to its reviewers and approver/s
-- Run after 20261021_credit_scoring.sql. Re-runnable, no drops of data.
--
-- Josh, 2026-10-21:
--   * On its own page (opened from the FP) the assigned CO picks the reviewer/s, in review order, and the
--     approver/s. Who reviews and approves depends on the loan amount and whether there's a policy
--     deviation, so the page SUGGESTS the approval authority from the sheet's tiers (front end,
--     src/pages/review/approval.js); the CO picks it (financial_packages.approval_tier) and the people.
--   * "Send for review" moves the application to Review. It needs a saved Credit Result of Endorsed or
--     Not endorsed (a deferred application doesn't go to review); the justification is already required
--     by the FP. After sending, only the Dept Head or the Dispatch Admin can change the people / tier.
--   * Reviewers and approvers only view for now (summary page, FP, loan folder). Their sign-off
--     (mark reviewed / request revision / approve / reject) comes later.
--   * The work tray RPC isn't changed: the page reads review_assignments directly.
--
-- Nothing moves applications into Credit Evaluation yet (the CI results step isn't built), so the CO can
-- send from Credit Investigation or Credit Evaluation.

-- ============================================================
-- 1. Approval authority (VII. Approval tiers) + who's routed
-- ============================================================
do $$ begin
  create type public.approval_tier as enum ('PRESIDENT', 'SENIOR_CREDIT_COMMITTEE', 'EXECUTIVE_COMMITTEE', 'BOARD');
exception when duplicate_object then null; end $$;

-- Set by send_for_review() / update_review_routing() only (save_financial_package() doesn't touch it)
alter table public.financial_packages add column if not exists approval_tier approval_tier;

-- Reviewer / approver history; at most one active row per (application, person).
-- seq = review order for reviewers (1 = first reviewer), listing order for approvers.
create table if not exists public.review_assignments (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  assignee_role user_role not null check (assignee_role in ('REVIEWER', 'APPROVER')),
  user_id uuid not null references public.users(id),
  seq smallint not null check (seq > 0),
  assigned_by uuid not null references public.users(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  unassigned_by uuid references public.users(id),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);
create unique index if not exists one_active_review_assignment
  on public.review_assignments (application_id, user_id) where unassigned_at is null;
create index if not exists review_assignments_user
  on public.review_assignments (user_id) where unassigned_at is null;

alter table public.review_assignments enable row level security;
revoke insert, update, delete, truncate on public.review_assignments from anon, authenticated;

drop policy if exists "staff read review assignments" on public.review_assignments;
create policy "staff read review assignments" on public.review_assignments
  for select to authenticated using (public.staff_can_access(application_id));

drop trigger if exists log_application_change on public.review_assignments;
create trigger log_application_change after insert or update or delete on public.review_assignments
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 2. Who can be picked
-- ============================================================
-- Active Reviewer / Approver accounts with a staff profile (any staff member may list them)
create or replace function public.list_review_staff()
returns table (user_id uuid, role user_role, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.role, staff_name(u.id)
  from users u
  where is_staff() and u.is_active and u.role in ('REVIEWER', 'APPROVER') and staff_name(u.id) is not null
  order by u.role, staff_name(u.id);
$$;

revoke execute on function public.list_review_staff() from anon;

-- ============================================================
-- 3. Routing
-- ============================================================
-- Makes the active reviewers (or approvers) of an application exactly p_users, in that order:
-- people left out are unassigned, new people are added, kept people only get their order updated.
-- Internal: called by send_for_review() / update_review_routing() after their permission checks.
create or replace function public.sync_review_assignments(p_application_id bigint, p_role user_role, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_label text := case p_role when 'REVIEWER' then 'reviewer' else 'approver' end;
  v_user uuid;
  v_seq int;
begin
  if coalesce(cardinality(p_users), 0) = 0 then
    raise exception 'Pick at least one %', v_label;
  end if;
  if cardinality(p_users) <> (select count(distinct u) from unnest(p_users) u) then
    raise exception 'The same % is picked twice', v_label;
  end if;
  if exists (select 1 from unnest(p_users) u
             where u is null
                or not exists (select 1 from users where id = u and role = p_role and is_active)
                or staff_name(u) is null) then
    raise exception 'Every % must be an active % account with a staff profile', v_label, initcap(v_label);
  end if;

  update review_assignments set unassigned_at = now(), unassigned_by = auth.uid()
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null
    and user_id <> all (p_users);

  for v_user, v_seq in select u, o from unnest(p_users) with ordinality as t (u, o) loop
    update review_assignments set seq = v_seq
    where application_id = p_application_id and user_id = v_user and unassigned_at is null and seq <> v_seq;
    if not exists (select 1 from review_assignments
                   where application_id = p_application_id and user_id = v_user and unassigned_at is null) then
      insert into review_assignments (application_id, assignee_role, user_id, seq, assigned_by)
      values (p_application_id, p_role, v_user, v_seq, auth.uid());
    end if;
  end loop;
end $$;

revoke execute on function public.sync_review_assignments(bigint, user_role, uuid[]) from public, anon, authenticated;

-- Assigned CO, while in Credit Investigation or Credit Evaluation: sets the approval authority + people,
-- closes the current stage and opens Review
create or replace function public.send_for_review(p_application_id bigint, p_tier approval_tier,
                                                  p_reviewers uuid[], p_approvers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage application_stages;
  v_pkg financial_packages;
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
  if p_tier is null then raise exception 'Pick the approval authority'; end if;

  update financial_packages set approval_tier = p_tier
  where application_id = p_application_id and approval_tier is distinct from p_tier;
  perform sync_review_assignments(p_application_id, 'REVIEWER', p_reviewers);
  perform sync_review_assignments(p_application_id, 'APPROVER', p_approvers);

  -- Close the current stage, open Review
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_stage.id, 'DONE', auth.uid(), v_note);
  update application_stages set left_at = now() where id = v_stage.id;

  insert into application_stages (application_id, stage) values (p_application_id, 'REVIEW')
  returning id into v_review;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_review, 'PENDING', auth.uid(), v_note);

  -- Applicant-facing status (logged in audit_log by the existing trigger)
  update loan_applications set status = 'UNDER_REVIEW' where id = p_application_id;
end $$;

revoke execute on function public.send_for_review(bigint, approval_tier, uuid[], uuid[]) from anon;

-- Dept Head / Dispatch Admin, while in Review or Approval: change the approval authority or the people
create or replace function public.update_review_routing(p_application_id bigint, p_tier approval_tier,
                                                        p_reviewers uuid[], p_approvers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage workflow_stage;
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  select stage into v_stage from application_stages where application_id = p_application_id and left_at is null;
  if not coalesce(current_user_role() in ('DEPT_HEAD', 'DISPATCH_ADMIN'), false)
     or not coalesce(v_stage in ('REVIEW', 'APPROVAL'), false) then
    raise exception 'Only the Dept Head or the Dispatch Admin can change the reviewers and approvers, while the application is in Review or Approval';
  end if;
  if p_tier is null then raise exception 'Pick the approval authority'; end if;

  update financial_packages set approval_tier = p_tier
  where application_id = p_application_id and approval_tier is distinct from p_tier;
  perform sync_review_assignments(p_application_id, 'REVIEWER', p_reviewers);
  perform sync_review_assignments(p_application_id, 'APPROVER', p_approvers);
end $$;

revoke execute on function public.update_review_routing(bigint, approval_tier, uuid[], uuid[]) from anon;
