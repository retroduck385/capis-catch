-- CATCH — staff work tray: stages, per-stage status, TAT, AO/CO assignment, staff access
-- Run after 20260930_signup_role.sql. Re-runnable, no drops of data.
--
-- Stage  = where the application is in the As-Is BPMN (which lane holds it).
-- Status = state inside that stage (pending, in progress, waiting on someone, sent back, done).
-- Near / beyond TAT is NOT stored: it's computed from time in stage vs. stage_tat.
--
-- Access:
--   CI, Dispatch Admin, Reviewer, Approver, Dept Head  -> every submitted application
--   AO, CO                                             -> tray summary of every application,
--                                                         full record only when assigned to them
--   AO/CO assign / release themselves; Dispatch Admin, Reviewer, Approver, Dept Head assign,
--   reassign and unassign any AO/CO.
--
-- loan_applications.status stays the applicant-facing state (DRAFT / SUBMITTED / ...);
-- staff-side movement lives in application_stages + stage_status_changes.

-- ============================================================
-- 1. Enums
-- ============================================================
do $$ begin
  create type public.workflow_stage as enum ('INTAKE', 'CREDIT_INVESTIGATION', 'CREDIT_EVALUATION',
    'REVIEW', 'APPROVAL', 'DECIDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.stage_status as enum ('PENDING', 'IN_PROGRESS', 'REQUESTED', 'RETURNED', 'DONE');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Tables
-- ============================================================
-- One row per visit to a stage (an application can come back to a stage, e.g. Review -> CO revision)
create table if not exists public.application_stages (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  stage workflow_stage not null,
  entered_at timestamptz not null default now(),
  left_at timestamptz,
  check (left_at is null or left_at >= entered_at)
);
create unique index if not exists one_open_stage_per_application
  on public.application_stages (application_id) where left_at is null;

-- Status history inside a stage visit; the latest row is the current status
create table if not exists public.stage_status_changes (
  id bigint generated always as identity primary key,
  stage_visit_id bigint not null references public.application_stages(id) on delete cascade,
  status stage_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.users(id),
  note text
);
create index if not exists stage_status_changes_visit on public.stage_status_changes (stage_visit_id, changed_at);

-- Turnaround-time limit per stage. PLACEHOLDER values until the bank's SLA is known.
create table if not exists public.stage_tat (
  stage workflow_stage primary key,
  tat_days numeric(5,1) not null check (tat_days > 0),
  near_ratio numeric(3,2) not null default 0.75 check (near_ratio > 0 and near_ratio < 1)
);
insert into public.stage_tat (stage, tat_days) values
  ('INTAKE', 1), ('CREDIT_INVESTIGATION', 3), ('CREDIT_EVALUATION', 3), ('REVIEW', 2), ('APPROVAL', 2)
on conflict (stage) do nothing;

-- AO / CO assignment history; at most one active (unassigned_at is null) per application and role
create table if not exists public.application_assignments (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  assignee_role user_role not null check (assignee_role in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')),
  user_id uuid not null references public.users(id),
  assigned_by uuid not null references public.users(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  unassigned_by uuid references public.users(id),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);
create unique index if not exists one_active_assignment
  on public.application_assignments (application_id, assignee_role) where unassigned_at is null;

-- ============================================================
-- 3. Role helpers
-- ============================================================
create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid() and is_active;
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role() <> 'APPLICANT', false);
$$;

-- Roles that assign / reassign AOs and COs
create or replace function public.is_assigning_head()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role() in ('DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD'), false);
$$;

-- Full record access for staff: CI + heads see everything, AO/CO only what's assigned to them
create or replace function public.staff_can_access(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and (current_user_role() in ('CREDIT_INVESTIGATOR', 'DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD')
           or exists (select 1 from application_assignments aa
                      where aa.application_id = la.id
                        and aa.user_id = auth.uid()
                        and aa.unassigned_at is null)));
$$;

create or replace function public.staff_can_access_applicant(p_applicant_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select staff_can_access(application_id) from applicants where id = p_applicant_id), false);
$$;

create or replace function public.staff_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' ', first_name, last_name), '') from user_profile where user_id = p_user_id;
$$;

-- ============================================================
-- 4. Stage bookkeeping
-- ============================================================
create or replace function public.current_stage_status(p_stage_visit_id bigint)
returns stage_status language sql stable security definer set search_path = public as $$
  select status from stage_status_changes
  where stage_visit_id = p_stage_visit_id
  order by changed_at desc, id desc limit 1;
$$;

-- Submission (DRAFT -> SUBMITTED in submit_application) opens the Intake stage as Pending
create or replace function public.open_intake_on_submit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit bigint;
begin
  if old.status = 'DRAFT' and new.status <> 'DRAFT'
     and not exists (select 1 from application_stages where application_id = new.id) then
    insert into application_stages (application_id, stage, entered_at)
    values (new.id, 'INTAKE', coalesce(new.submitted_at, now()))
    returning id into v_visit;
    insert into stage_status_changes (stage_visit_id, status, changed_at, changed_by)
    values (v_visit, 'PENDING', coalesce(new.submitted_at, now()), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists open_intake_on_submit on public.loan_applications;
create trigger open_intake_on_submit
  after update of status on public.loan_applications
  for each row execute function public.open_intake_on_submit();

-- Applications submitted before this migration: open a stage that matches their old status
with opened as (
  insert into public.application_stages (application_id, stage, entered_at)
  select la.id,
         (case la.status
            when 'UNDER_CI' then 'CREDIT_INVESTIGATION'
            when 'UNDER_CREDIT_EVALUATION' then 'CREDIT_EVALUATION'
            when 'DEFERRED' then 'CREDIT_EVALUATION'
            when 'UNDER_REVIEW' then 'REVIEW'
            when 'FOR_APPROVAL' then 'APPROVAL'
            when 'APPROVED' then 'DECIDED'
            when 'REJECTED' then 'DECIDED'
            else 'INTAKE' end)::workflow_stage,
         coalesce(la.submitted_at, la.created_at)
  from public.loan_applications la
  where la.status <> 'DRAFT'
    and not exists (select 1 from public.application_stages s where s.application_id = la.id)
  returning id, application_id, entered_at
)
insert into public.stage_status_changes (stage_visit_id, status, changed_at)
select o.id,
       (case la.status
          when 'FOR_CLARIFICATION' then 'REQUESTED'
          when 'DEFERRED' then 'RETURNED'
          when 'APPROVED' then 'DONE'
          when 'REJECTED' then 'DONE'
          else 'PENDING' end)::stage_status,
       o.entered_at
from opened o join public.loan_applications la on la.id = o.application_id;

-- ============================================================
-- 5. Work tray: one row per submitted application, FIFO by submission.
--    Summary columns only, so AOs/COs can see and claim unassigned files
--    without reading the full record (can_open says whether they may).
-- ============================================================
drop function if exists public.get_work_tray();
create or replace function public.get_work_tray()
returns table (
  application_id bigint,
  application_no text,
  applicant_name text,
  employment_type employment_type,
  branch text,
  stage workflow_stage,
  stage_status stage_status,
  loan_amount numeric,
  submitted_at timestamptz,
  days_in_stage numeric,
  tat_days numeric,
  tat_state text,          -- ON_TRACK / NEAR / BEYOND; null when the stage has no TAT (Decided)
  ao_id uuid,
  ao_name text,
  co_id uuid,
  co_name text,
  can_open boolean
)
language sql stable security definer set search_path = public as $$
  select la.id,
         la.application_no,
         nullif(concat_ws(' ', p.first_name, p.last_name, p.name_extension), ''),
         e.employment_type,
         r.branch,
         s.stage,
         current_stage_status(s.id),
         la.loan_amount,
         la.submitted_at,
         round((extract(epoch from now() - s.entered_at) / 86400)::numeric, 1),
         t.tat_days,
         case when t.tat_days is null then null
              when now() - s.entered_at > t.tat_days * interval '1 day' then 'BEYOND'
              when now() - s.entered_at > t.tat_days * t.near_ratio * interval '1 day' then 'NEAR'
              else 'ON_TRACK' end,
         ao.user_id, staff_name(ao.user_id),
         co.user_id, staff_name(co.user_id),
         staff_can_access(la.id)
  from loan_applications la
  join application_stages s on s.application_id = la.id and s.left_at is null
  left join applicants p on p.application_id = la.id and p.role = 'PRINCIPAL' and p.party_no = 1
  left join employment_info e on e.applicant_id = p.id
  left join referral_details r on r.application_id = la.id
  left join stage_tat t on t.stage = s.stage
  left join application_assignments ao on ao.application_id = la.id
        and ao.assignee_role = 'ACCOUNT_OFFICER' and ao.unassigned_at is null
  left join application_assignments co on co.application_id = la.id
        and co.assignee_role = 'CREDIT_OFFICER' and co.unassigned_at is null
  where is_staff() and la.status <> 'DRAFT'
  order by la.submitted_at nulls last, la.id;
$$;

-- Active AOs and COs, for the heads' assign dropdown (empty for everyone else)
create or replace function public.list_assignable_staff()
returns table (user_id uuid, role user_role, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.role, coalesce(staff_name(u.id), 'Unnamed staff')
  from users u
  where is_assigning_head() and u.is_active and u.role in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER')
  order by u.role, 3;
$$;

-- ============================================================
-- 6. Assign / unassign
-- ============================================================
-- The stage each assignee owns: claiming moves it Pending -> In Progress, releasing moves it back
create or replace function public.owned_stage(p_role user_role)
returns workflow_stage language sql immutable as $$
  select case p_role when 'ACCOUNT_OFFICER' then 'INTAKE'::workflow_stage
                     when 'CREDIT_OFFICER' then 'CREDIT_EVALUATION'::workflow_stage end;
$$;

-- p_user_id null = assign yourself
create or replace function public.assign_application(p_application_id bigint, p_role user_role, p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me user_role := current_user_role();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_current uuid;
  v_visit application_stages;
begin
  if p_role not in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER') then
    raise exception 'Only Account Officers and Credit Officers are assigned to applications';
  end if;

  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  -- AOs / COs may only put themselves in their own role's slot; heads may assign anyone
  if not is_assigning_head() and not (v_me = p_role and v_target = auth.uid()) then
    raise exception 'You can only assign yourself as %', replace(lower(v_me::text), '_', ' ');
  end if;

  if not exists (select 1 from users where id = v_target and role = p_role and is_active) then
    raise exception 'That user is not an active %', replace(lower(p_role::text), '_', ' ');
  end if;

  select user_id into v_current from application_assignments
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;

  if v_current = v_target then return; end if;

  if v_current is not null then
    if not is_assigning_head() then
      raise exception 'Already assigned to %. Ask a head to reassign it.', coalesce(staff_name(v_current), 'someone else');
    end if;
    update application_assignments
    set unassigned_at = now(), unassigned_by = auth.uid()
    where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;
  end if;

  insert into application_assignments (application_id, assignee_role, user_id, assigned_by)
  values (p_application_id, p_role, v_target, auth.uid());

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  if v_visit.stage = owned_stage(p_role) and current_stage_status(v_visit.id) = 'PENDING' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'IN_PROGRESS', auth.uid(), 'Assigned to ' || coalesce(staff_name(v_target), 'staff'));
  end if;
end $$;

create or replace function public.unassign_application(p_application_id bigint, p_role user_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current uuid;
  v_visit application_stages;
begin
  perform 1 from loan_applications where id = p_application_id for update;

  select user_id into v_current from application_assignments
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;
  if v_current is null then return; end if;

  if not (is_assigning_head() or v_current = auth.uid()) then
    raise exception 'You can only release applications assigned to you';
  end if;

  update application_assignments
  set unassigned_at = now(), unassigned_by = auth.uid()
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  if v_visit.stage = owned_stage(p_role) and current_stage_status(v_visit.id) = 'IN_PROGRESS' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'PENDING', auth.uid(), 'Released by ' || coalesce(staff_name(auth.uid()), 'staff'));
  end if;
end $$;

revoke execute on function public.assign_application(bigint, user_role, uuid) from anon;
revoke execute on function public.unassign_application(bigint, user_role) from anon;
revoke execute on function public.get_work_tray() from anon;
revoke execute on function public.list_assignable_staff() from anon;

-- ============================================================
-- 7. RLS on the new tables: read-only for clients, writes only through the functions above
-- ============================================================
alter table public.application_stages enable row level security;
alter table public.stage_status_changes enable row level security;
alter table public.stage_tat enable row level security;
alter table public.application_assignments enable row level security;

revoke insert, update, delete on public.application_stages, public.stage_status_changes,
  public.stage_tat, public.application_assignments from anon, authenticated;

drop policy if exists "read stages" on public.application_stages;
create policy "read stages" on public.application_stages
  for select to authenticated
  using (public.owns_application(application_id) or public.staff_can_access(application_id));

drop policy if exists "read stage status" on public.stage_status_changes;
create policy "read stage status" on public.stage_status_changes
  for select to authenticated
  using (exists (select 1 from public.application_stages s
                 where s.id = stage_visit_id
                   and (public.owns_application(s.application_id) or public.staff_can_access(s.application_id))));

drop policy if exists "read tat" on public.stage_tat;
create policy "read tat" on public.stage_tat for select to authenticated using (true);

drop policy if exists "staff read assignments" on public.application_assignments;
create policy "staff read assignments" on public.application_assignments
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 8. Staff read access to the application record (for the loan folder page).
--    Read-only for now; staff edits come with the KYC verification step.
-- ============================================================
drop policy if exists "staff reads" on public.loan_applications;
create policy "staff reads" on public.loan_applications
  for select to authenticated using (public.staff_can_access(id));

do $$
declare
  t text;
begin
  foreach t in array array['applicants', 'character_references', 'collateral_details',
                           'referral_details', 'documents']
  loop
    execute format('drop policy if exists "staff reads" on public.%I', t);
    execute format('create policy "staff reads" on public.%I for select to authenticated using (public.staff_can_access(application_id))', t);
  end loop;

  foreach t in array array['dependents', 'addresses', 'employment_info', 'bank_accounts',
                           'existing_loans', 'credit_cards', 'application_requirements']
  loop
    execute format('drop policy if exists "staff reads" on public.%I', t);
    execute format('create policy "staff reads" on public.%I for select to authenticated using (public.staff_can_access_applicant(applicant_id))', t);
  end loop;
end $$;

-- Uploaded files: path is {user_id}/{application_id}/{file}
drop policy if exists "staff reads files" on storage.objects;
create policy "staff reads files" on storage.objects
  for select to authenticated
  using (bucket_id = 'application-documents'
         and public.staff_can_access(((storage.foldername(name))[2])::bigint));
