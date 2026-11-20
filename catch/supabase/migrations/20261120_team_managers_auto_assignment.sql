-- CATCH — AO / CO Managers + balanced auto-assignment of Account Officers and Credit Officers
-- Run after 20261111_notification_fixes.sql, 20261108_ci_results.sql and 20261108_approver_positions.sql.
-- Re-runnable, no drops of data.
--
-- Josh, 2026-11-20:
--   * Managers work like approver positions: no new role. An Account Officer or Credit Officer account can be
--     marked Manager by the Department Head (Staff accounts). AO Managers manage AOs, CO Managers manage COs.
--   * On submission CATCH assigns BOTH the AO and the CO, each to the available officer with the lightest
--     workload. Workload = number of borrowers (principal + spouse + co-borrowers) summed over the officer's
--     open (not yet decided) files, because each borrower adds IDs, income documents and checks to verify.
--     Ties go to whoever was auto/manually assigned least recently, then a fixed order.
--   * Managers are supervisors: never auto-assigned, can't be picked in the assign dialog.
--   * Only the Manager of that team can reassign / unassign (override) and mark an officer available /
--     unavailable for new files. AOs / COs no longer claim ("Assign me") or release files. The Dispatch Admin,
--     Reviewer, Approver and Dept Head no longer assign AOs / COs (the Dispatch Admin keeps its other duties).
--   * Nobody available: the slot stays unassigned and that team's Managers are notified; the Manager can run
--     "Auto-assign unassigned" from the work tray. Marking someone unavailable does not move their files.
--   * Human in the loop: the auto-assignment is a routing step, not a credit decision; every assignment is
--     logged in application_assignments (assigned_by null = CATCH) and a Manager can override it.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.application_assignments', '20261005_work_tray.sql'),
               ('public.staff_role_grants', '20261010_staff_accounts.sql'),
               ('public.notifications', '20261024_notifications.sql'),
               ('public.ci_checks', '20261108_ci_results.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is null and to_regtype('public.approval_position') is null then
    v_missing := '20261108_approver_positions.sql';
  end if;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Columns
-- ============================================================
-- Manager of the AO or CO team (set by the Department Head only; users can't update their own row's other columns)
alter table public.users add column if not exists is_manager boolean not null default false;
do $$ begin
  alter table public.users add constraint is_manager_only_officers
    check (not is_manager or role in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER'));
exception when duplicate_object then null; end $$;

-- In the auto-assignment rotation (set by that team's Manager). Off = no new files; existing files stay.
alter table public.users add column if not exists available_for_assignment boolean not null default true;

-- Every manager grant / change stays in the role history
alter table public.staff_role_grants add column if not exists is_manager boolean not null default false;

-- null assigned_by / unassigned_by = done by CATCH (auto-assignment), not a person
alter table public.application_assignments alter column assigned_by drop not null;

-- ============================================================
-- 2. Helpers
-- ============================================================
-- The team (ACCOUNT_OFFICER / CREDIT_OFFICER) the caller manages; null when they aren't a Manager
create or replace function public.managed_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid() and is_active and is_manager;
$$;

-- Old name kept for anything that still calls it: "can assign AOs / COs" now means "is a team Manager"
create or replace function public.is_assigning_head()
returns boolean language sql stable security definer set search_path = public as $$
  select managed_role() is not null;
$$;

-- Active Managers of a team (notification recipients)
create or replace function public.team_managers(p_role user_role)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from users where role = p_role and is_active and is_manager;
$$;

-- Workload weight of one application = its borrowers (principal + spouse + co-borrowers), at least 1.
-- Change the weighting here only; everything else reads it through this function.
create or replace function public.assignment_weight(p_application_id bigint)
returns int language sql stable security definer set search_path = public as $$
  select greatest(1, count(*))::int from applicants
  where application_id = p_application_id and role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER');
$$;

-- An officer's open files (not Decided) in a role, and their summed weight
create or replace function public.officer_load(p_user_id uuid, p_role user_role)
returns table (open_files int, workload int)
language sql stable security definer set search_path = public as $$
  select count(*)::int, coalesce(sum(assignment_weight(aa.application_id)), 0)::int
  from application_assignments aa
  join application_stages s on s.application_id = aa.application_id and s.left_at is null
  where aa.user_id = p_user_id and aa.assignee_role = p_role and aa.unassigned_at is null
    and s.stage <> 'DECIDED';
$$;

-- Who CATCH would assign next: available, active, non-manager officer of the role with a completed staff
-- profile; lightest workload, then least recently assigned (never assigned first), then id. Null = nobody.
create or replace function public.pick_assignee(p_role user_role)
returns uuid language sql stable security definer set search_path = public as $$
  select u.id
  from users u
  cross join lateral officer_load(u.id, p_role) l
  where u.role = p_role and u.is_active and not u.is_manager and u.available_for_assignment
    and staff_name(u.id) is not null
  order by l.workload,
           (select max(assigned_at) from application_assignments a where a.user_id = u.id and a.assignee_role = p_role)
             nulls first,
           u.id
  limit 1;
$$;

-- Fill one empty AO / CO slot with pick_assignee(). Returns the person, or null when the slot was already
-- filled or nobody is available (then the team's Managers are notified). Internal only.
create or replace function public.auto_assign_slot(p_application_id bigint, p_role user_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pick uuid;
  v_visit application_stages;
  v_label text := case p_role when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end;
begin
  if p_role not in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER') then return null; end if;
  -- One auto-assignment per team at a time, so two submissions can't both see the same lightest load
  perform pg_advisory_xact_lock(hashtext('catch_auto_assign'), hashtext(p_role::text));

  if exists (select 1 from application_assignments where application_id = p_application_id
             and assignee_role = p_role and unassigned_at is null) then
    return null;
  end if;

  v_pick := pick_assignee(p_role);
  if v_pick is null then
    begin
      perform send_notification('NO_AVAILABLE_OFFICER',
        'No available ' || v_label || ' for ' || notification_app_no(p_application_id),
        'Nobody on your team is available for new files. Mark someone available, then run Auto-assign unassigned in the work tray.',
        p_application_id, p_users => team_managers(p_role), p_link => '/adminHomePage', p_dedupe => true);
    exception when others then
      raise warning 'NO_AVAILABLE_OFFICER notification failed: %', sqlerrm;
    end;
    return null;
  end if;

  insert into application_assignments (application_id, assignee_role, user_id, assigned_by)
  values (p_application_id, p_role, v_pick, null);

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  if v_visit.stage = owned_stage(p_role) and current_stage_status(v_visit.id) = 'PENDING' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'IN_PROGRESS', null,
            'Auto-assigned to ' || coalesce(staff_name(v_pick), 'staff') || ' (balanced workload)');
  end if;
  return v_pick;
end $$;

revoke execute on function public.team_managers(user_role) from public, anon, authenticated;
revoke execute on function public.officer_load(uuid, user_role) from public, anon, authenticated;
revoke execute on function public.pick_assignee(user_role) from public, anon, authenticated;
revoke execute on function public.auto_assign_slot(bigint, user_role) from public, anon, authenticated;
revoke execute on function public.assignment_weight(bigint) from anon;
revoke execute on function public.managed_role() from anon;

-- ============================================================
-- 3. Submission: open Intake (as before), then auto-assign the AO and the CO
-- ============================================================
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

    -- A failed auto-assignment must never block the applicant's submission: the slot just stays empty
    begin
      perform auto_assign_slot(new.id, 'ACCOUNT_OFFICER');
      perform auto_assign_slot(new.id, 'CREDIT_OFFICER');
    exception when others then
      raise warning 'auto-assignment on submit failed for application %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

-- ============================================================
-- 4. Manager overrides: assign / reassign / unassign within their own team
-- ============================================================
create or replace function public.assign_application(p_application_id bigint, p_role user_role, p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current uuid;
  v_visit application_stages;
begin
  if p_role not in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER') then
    raise exception 'Only Account Officers and Credit Officers are assigned to applications';
  end if;
  if managed_role() is distinct from p_role then
    raise exception 'Only the % Manager can assign %s. New files are assigned automatically.',
      case p_role when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end,
      case p_role when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end;
  end if;
  if p_user_id is null then raise exception 'Choose who to assign'; end if;

  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  if not exists (select 1 from users where id = p_user_id and role = p_role and is_active and not is_manager) then
    raise exception 'That user is not an active % on your team', replace(lower(p_role::text), '_', ' ');
  end if;

  select user_id into v_current from application_assignments
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;
  if v_current = p_user_id then return; end if;

  if v_current is not null then
    update application_assignments set unassigned_at = now(), unassigned_by = auth.uid()
    where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;
  end if;

  insert into application_assignments (application_id, assignee_role, user_id, assigned_by)
  values (p_application_id, p_role, p_user_id, auth.uid());

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  if v_visit.stage = owned_stage(p_role) and current_stage_status(v_visit.id) = 'PENDING' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'IN_PROGRESS', auth.uid(), 'Assigned to ' || coalesce(staff_name(p_user_id), 'staff'));
  end if;
end $$;

create or replace function public.unassign_application(p_application_id bigint, p_role user_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current uuid;
  v_visit application_stages;
begin
  if managed_role() is distinct from p_role then
    raise exception 'Only the % Manager can unassign %s',
      case p_role when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end,
      case p_role when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end;
  end if;

  perform 1 from loan_applications where id = p_application_id for update;

  select user_id into v_current from application_assignments
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;
  if v_current is null then return; end if;

  update application_assignments set unassigned_at = now(), unassigned_by = auth.uid()
  where application_id = p_application_id and assignee_role = p_role and unassigned_at is null;

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  if v_visit.stage = owned_stage(p_role) and current_stage_status(v_visit.id) = 'IN_PROGRESS' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'PENDING', auth.uid(), 'Unassigned by ' || coalesce(staff_name(auth.uid()), 'the Manager'));
  end if;
end $$;

-- Manager: fill every empty slot of their team on open (not Decided) files, FIFO by submission.
-- Returns { assigned, left }: left = slots still empty because nobody is available.
create or replace function public.auto_assign_unassigned()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := managed_role();
  v_app bigint;
  v_assigned int := 0;
  v_left int := 0;
begin
  if v_role is null then raise exception 'Only an Account Officer or Credit Officer Manager can auto-assign'; end if;

  for v_app in
    select la.id from loan_applications la
    join application_stages s on s.application_id = la.id and s.left_at is null and s.stage <> 'DECIDED'
    where la.status <> 'DRAFT'
      and not exists (select 1 from application_assignments aa where aa.application_id = la.id
                      and aa.assignee_role = v_role and aa.unassigned_at is null)
    order by la.submitted_at nulls last, la.id
  loop
    if auto_assign_slot(v_app, v_role) is null then v_left := v_left + 1; else v_assigned := v_assigned + 1; end if;
  end loop;
  return jsonb_build_object('assigned', v_assigned, 'left', v_left);
end $$;

-- Manager: take an officer on their team in / out of the rotation
create or replace function public.set_officer_availability(p_user_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_available is null then raise exception 'Choose available or unavailable'; end if;
  if not exists (select 1 from users where id = p_user_id and role = managed_role() and not is_manager) then
    raise exception 'Only the Manager of this officer''s team can change their availability';
  end if;
  update users set available_for_assignment = p_available where id = p_user_id;
end $$;

-- Manager's team: officers (not Managers) of the role they manage, with load and availability.
-- Used by the assign dialog and the team workload panel; empty for everyone else.
drop function if exists public.list_assignable_staff();
create or replace function public.list_assignable_staff()
returns table (user_id uuid, role user_role, name text, available boolean, open_files int, workload int,
               last_assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.role, staff_name(u.id), u.available_for_assignment, l.open_files, l.workload,
         (select max(assigned_at) from application_assignments a where a.user_id = u.id and a.assignee_role = u.role)
  from users u
  cross join lateral officer_load(u.id, u.role) l
  where u.role = managed_role() and u.is_active and not u.is_manager and staff_name(u.id) is not null
  order by l.workload, 3;
$$;

revoke execute on function public.assign_application(bigint, user_role, uuid) from anon;
revoke execute on function public.unassign_application(bigint, user_role) from anon;
revoke execute on function public.auto_assign_unassigned() from public, anon;
revoke execute on function public.set_officer_availability(uuid, boolean) from public, anon;
revoke execute on function public.list_assignable_staff() from anon;
grant execute on function public.auto_assign_unassigned() to authenticated;
grant execute on function public.set_officer_availability(uuid, boolean) to authenticated;

-- ============================================================
-- 5. Staff accounts (Department Head): Manager flag, like the approver position
-- ============================================================
drop function if exists public.grant_staff_role(text, user_role, approval_position);
create or replace function public.grant_staff_role(p_email text, p_role user_role, p_position approval_position default null,
                                                   p_manager boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user users%rowtype;
  v_manager boolean := coalesce(p_manager, false);
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
    raise exception 'Only Approver accounts have an approval position';
  end if;
  if v_manager and p_role not in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER') then
    raise exception 'Only Account Officer and Credit Officer accounts can be Managers';
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

  update users set role = p_role, approval_position = p_position, is_manager = v_manager where id = v_user.id;
  insert into staff_role_grants (user_id, role, approval_position, is_manager, granted_by)
  values (v_user.id, p_role, p_position, v_manager, auth.uid());
  return v_user.id;
end $$;

-- Department Head: make an existing AO / CO a Manager (or back to officer). Their open files stay assigned;
-- as a Manager they get no new ones.
create or replace function public.set_team_manager(p_user_id uuid, p_manager boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
begin
  if current_user_role() is distinct from 'DEPT_HEAD' then
    raise exception 'Only the Department Head can change positions';
  end if;
  if p_manager is null then raise exception 'Choose a position'; end if;
  select role into v_role from users where id = p_user_id;
  if v_role is null or v_role not in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER') then
    raise exception 'Only Account Officer and Credit Officer accounts can be Managers';
  end if;
  if exists (select 1 from users where id = p_user_id and is_manager = p_manager) then return; end if;

  update users set is_manager = p_manager where id = p_user_id;
  insert into staff_role_grants (user_id, role, is_manager, granted_by)
  values (p_user_id, v_role, p_manager, auth.uid());
end $$;

drop function if exists public.list_staff_accounts();
create or replace function public.list_staff_accounts()
returns table (user_id uuid, email text, role user_role, approval_position approval_position, is_manager boolean,
               name text, is_active boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, au.email::text, u.role, u.approval_position, u.is_manager, staff_name(u.id), u.is_active, u.created_at
  from users u join auth.users au on au.id = u.id
  where current_user_role() = 'DEPT_HEAD' and u.role <> 'APPLICANT'
  order by u.created_at desc;
$$;

revoke execute on function public.grant_staff_role(text, user_role, approval_position, boolean) from anon, public;
revoke execute on function public.set_team_manager(uuid, boolean) from anon, public;
revoke execute on function public.list_staff_accounts() from anon, public;
grant execute on function public.grant_staff_role(text, user_role, approval_position, boolean) to authenticated;
grant execute on function public.set_team_manager(uuid, boolean) to authenticated;
grant execute on function public.list_staff_accounts() to authenticated;

-- ============================================================
-- 6. CI done: auto-assign the CO if the slot is still empty (e.g. nobody was available at submission)
--    Same as 20261108_ci_results.sql otherwise; the "assign yourself" notice now goes to the CO Managers.
-- ============================================================
create or replace function public.complete_ci(p_application_id bigint)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_missing text[];
  v_ci application_stages;
  v_ce bigint;
  v_co uuid;
  v_me text := coalesce(staff_name(auth.uid()), 'Credit Investigator');
  v_no text;
begin
  perform 1 from loan_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not ci_can_edit(p_application_id) then perform ci_refuse(); end if;

  v_missing := ci_missing(p_application_id);
  if cardinality(v_missing) > 0 then return v_missing; end if;

  select * into v_ci from application_stages where application_id = p_application_id and left_at is null;

  -- Close Credit Investigation
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_ci.id, 'DONE', auth.uid(), 'CI done by ' || v_me);
  update application_stages set left_at = now() where id = v_ci.id;

  -- Still no CO: try the balanced auto-assignment once more (the CO Managers hear about it if nobody is free)
  begin
    perform auto_assign_slot(p_application_id, 'CREDIT_OFFICER');
  exception when others then
    raise warning 'auto-assignment at CI done failed for application %: %', p_application_id, sqlerrm;
  end;

  -- Open Credit Evaluation (In Progress straight away when a CO is assigned).
  -- The stage trigger notifies the assigned CO (STAGE_CREDIT_EVALUATION), or the CO Managers if none.
  select user_id into v_co from application_assignments
  where application_id = p_application_id and assignee_role = 'CREDIT_OFFICER' and unassigned_at is null;
  insert into application_stages (application_id, stage) values (p_application_id, 'CREDIT_EVALUATION')
  returning id into v_ce;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_ce, case when v_co is null then 'PENDING' else 'IN_PROGRESS' end::stage_status, auth.uid(),
          'CI done by ' || v_me);

  update loan_applications set status = 'UNDER_CREDIT_EVALUATION' where id = p_application_id;

  -- The assigned AO always hears about it (the CO / CO Managers are told by the stage trigger)
  begin
    v_no := notification_app_no(p_application_id);
    perform send_notification('CI_DONE', 'CI results are in for ' || v_no, 'Done by ' || v_me || '.',
      p_application_id, p_assigned => array['ACCOUNT_OFFICER']);
  exception when others then
    raise warning 'CI_DONE notification failed: %', sqlerrm;
  end;

  return '{}';
end $$;
revoke execute on function public.complete_ci(bigint) from anon;

-- ============================================================
-- 7. Notifications
-- ============================================================
-- Assigned / removed by someone else. assigned_by null = CATCH's auto-assignment.
create or replace function public.notify_on_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_no text;
  v_role text := case new.assignee_role::text when 'ACCOUNT_OFFICER' then 'Account Officer' else 'Credit Officer' end;
begin
  begin
    v_no := notification_app_no(new.application_id);
    if tg_op = 'INSERT' and new.assigned_by is distinct from new.user_id then
      perform send_notification('ASSIGNED', 'You were assigned to ' || v_no || ' as ' || v_role,
        case when new.assigned_by is null then 'Assigned automatically by CATCH (balanced workload).'
             else 'By ' || coalesce(staff_name(new.assigned_by), 'your Manager') end,
        new.application_id, p_users => array[new.user_id], p_skip_actor => false);
    elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null
          and new.unassigned_by is distinct from new.user_id then
      perform send_notification('UNASSIGNED', 'You were removed from ' || v_no || ' as ' || v_role,
        'By ' || coalesce(staff_name(new.unassigned_by), 'your Manager'), new.application_id,
        p_users => array[new.user_id], p_link => '/adminHomePage', p_skip_actor => false);
    end if;
  exception when others then
    raise warning 'notify_assignment failed: %', sqlerrm;
  end;
  return null;
end $$;

-- Same as 20261111_notification_fixes.sql except: a new submission no longer goes to every AO ("claim it";
-- the auto-assigned AO gets ASSIGNED instead), and "no CO assigned" at Credit Evaluation goes to the CO Managers.
create or replace function public.notify_on_stage_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit application_stages;
  v_prev text;
  v_no text;
  v_stage text;
  v_roles text[];
  v_assigned text[];
begin
  begin
    select * into v_visit from application_stages where id = new.stage_visit_id;
    v_stage := v_visit.stage::text;
    v_no := notification_app_no(v_visit.application_id);
    select status::text into v_prev from stage_status_changes
    where stage_visit_id = new.stage_visit_id and id <> new.id
    order by changed_at desc, id desc limit 1;

    -- Who owns the stage
    v_assigned := case v_stage when 'INTAKE' then array['ACCOUNT_OFFICER']
                               when 'CREDIT_INVESTIGATION' then array['ACCOUNT_OFFICER']
                               when 'CREDIT_EVALUATION' then array['CREDIT_OFFICER']
                               when 'REVIEW' then array['REVIEWER']
                               when 'APPROVAL' then array['APPROVER'] end;
    v_roles := case when v_stage = 'CREDIT_INVESTIGATION' then array['CREDIT_INVESTIGATOR'] end;

    if new.status::text = 'RETURNED' and v_prev is distinct from 'RETURNED' then
      perform send_notification('STAGE_RETURNED', v_no || ' was returned to ' || stage_label(v_stage),
        left(new.note, 500), v_visit.application_id, p_roles => v_roles, p_assigned => v_assigned);

    elsif v_prev = 'DONE' and new.status::text <> 'DONE' then
      perform send_notification('DONE_REVERTED', v_no || ': ' || stage_label(v_stage) || ' is no longer Done',
        left(new.note, 500), v_visit.application_id,
        p_roles => coalesce(v_roles, '{}') || array['DISPATCH_ADMIN'], p_assigned => v_assigned);

    elsif v_prev is null then
      -- INTAKE: nothing here; the auto-assigned AO / CO get ASSIGNED, the Managers NO_AVAILABLE_OFFICER
      if v_stage = 'CREDIT_EVALUATION' then
        if exists (select 1 from application_assignments where application_id = v_visit.application_id
                   and assignee_role = 'CREDIT_OFFICER' and unassigned_at is null) then
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation', null,
            v_visit.application_id, p_assigned => array['CREDIT_OFFICER']);
        else
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation',
            'No Credit Officer is assigned yet. Assign one from the work tray.', v_visit.application_id,
            p_users => team_managers('CREDIT_OFFICER'));
        end if;
      elsif v_stage = 'APPROVAL' then
        perform send_notification('APPROVAL_ROUTED', v_no || ' is ready for your approval', null,
          v_visit.application_id, p_assigned => array['APPROVER']);
      elsif v_stage = 'DECIDED' then
        perform send_notification('DECIDED', 'A decision was recorded on ' || v_no, null, v_visit.application_id,
          p_roles => array['DISPATCH_ADMIN'], p_assigned => array['ACCOUNT_OFFICER', 'CREDIT_OFFICER', 'APPROVER']);
      end if;
      -- Credit Investigation and Review: notified by notify_ci_request / notify_review_routing
    end if;
  exception when others then
    raise warning 'notify_stage_status failed: %', sqlerrm;
  end;
  return null;
end $$;

update public.notification_switches set note = 'Not sent any more: new files are auto-assigned (20261120)'
where kind = 'NEW_APPLICATION';
