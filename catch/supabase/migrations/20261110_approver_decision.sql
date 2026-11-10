-- CATCH — Approver decision: the last step of the As-Is BPMN (A.7, Approver lane)
-- Run after 20261108_reviewer_signoff.sql. Re-runnable, no drops of data.
--
-- Josh, 2026-11-10: the approver sees the information (CO and reviewer recommendations, figures, CI, score,
-- exceptions) and records Approve, Approve with conditions, or Disapprove. No checklist, no return to the CO
-- (that's the reviewer's job).
--
-- Rules
--   * Only a routed approver (active APPROVER row in review_assignments, role APPROVER) can decide, only while
--     the application is in Approval, once each.
--   * Approve: remarks optional. Approve with conditions: the conditions are required (stored in `conditions`;
--     it counts as an approval). Disapprove: a reason is required.
--   * Approved once the approvals meet the authority (approval_requirements() of financial_packages.approval_tier,
--     e.g. "Credit Dept Head AND Lending Dept Head"): Approval closes, Decided opens, status APPROVED.
--   * Josh, 2026-11-10: one Disapprove does NOT end it while the other approvers can still meet the authority
--     (e.g. "Division Head OR 2 Dept Heads" and one Dept Head said no). Disapproved (status REJECTED) only once
--     the approvals plus the approvers who haven't decided yet can no longer meet it.
--   * Until then the Approval stage shows IN_PROGRESS with who decided what.
--   * Only decisions on ACTIVE assignments count (a head's re-routing can unassign someone; a re-added person
--     gets a new assignment and decides again).
--   * The position the approver signed as is kept on the decision (their account's position can change later).
--
-- The existing triggers do the rest: notify_stage_status sends DECIDED (AO, CO, Dispatch Admins) when Decided
-- opens; applicant_outcome_event records APPROVED / REJECTED for the applicant notice (AO sends it).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.review_decisions') is null then
    raise exception 'Run 20261108_reviewer_signoff.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. Decisions
-- ============================================================
do $$ begin
  create type public.approval_action as enum ('APPROVED', 'DISAPPROVED');
exception when duplicate_object then null; end $$;

create table if not exists public.approval_decisions (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  assignment_id bigint not null unique,                 -- one decision per approver assignment
  action approval_action not null,
  approval_position approval_position,                  -- what they signed as, at the time
  remarks text check (remarks is null or length(trim(remarks)) > 0),
  conditions text check (conditions is null or length(trim(conditions)) > 0),  -- "Approve with conditions"
  decided_at timestamptz not null default now(),
  foreign key (assignment_id, application_id) references public.review_assignments (id, application_id),
  check (action = 'APPROVED' or remarks is not null),   -- a disapproval needs a reason
  check (action = 'APPROVED' or conditions is null)     -- only an approval has conditions
);
-- If the table came from an earlier run of this file
alter table public.approval_decisions add column if not exists conditions text
  check (conditions is null or length(trim(conditions)) > 0);
do $$ begin
  alter table public.approval_decisions add constraint approval_decisions_conditions_on_approval
    check (action = 'APPROVED' or conditions is null);
exception when duplicate_object then null; end $$;
create index if not exists approval_decisions_application on public.approval_decisions (application_id, decided_at);

alter table public.approval_decisions enable row level security;
revoke insert, update, delete, truncate on public.approval_decisions from anon, authenticated;

drop policy if exists "staff read approval decisions" on public.approval_decisions;
create policy "staff read approval decisions" on public.approval_decisions
  for select to authenticated using (public.staff_can_access(application_id));

drop trigger if exists log_application_change on public.approval_decisions;
create trigger log_application_change after insert or update or delete on public.approval_decisions
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 2. Whose turn / is the authority met
-- ============================================================
-- The caller's active approver assignment on this application without a decision, while it's in Approval
create or replace function public.my_open_approval(p_application_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select ra.id from review_assignments ra
  where ra.application_id = p_application_id and ra.assignee_role = 'APPROVER' and ra.unassigned_at is null
    and ra.user_id = auth.uid()
    and coalesce(current_user_role() = 'APPROVER', false)
    and exists (select 1 from application_stages s
                where s.application_id = p_application_id and s.left_at is null and s.stage = 'APPROVAL')
    and not exists (select 1 from approval_decisions d where d.assignment_id = ra.id)
  limit 1;
$$;

create or replace function public.approver_can_act(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select my_open_approval(p_application_id) is not null;
$$;

-- Every group of the authority met by the approvals on active assignments; with p_include_undecided, also counting
-- the routed approvers who haven't decided yet (= can it still be met?)
create or replace function public.approval_requirements_met(p_application_id bigint, p_include_undecided boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  with tier as (select approval_tier from financial_packages where application_id = p_application_id),
  counted as (
    select coalesce(d.approval_position, u.approval_position)::text as position
    from review_assignments ra
    join users u on u.id = ra.user_id
    left join approval_decisions d on d.assignment_id = ra.id
    where ra.application_id = p_application_id and ra.assignee_role = 'APPROVER' and ra.unassigned_at is null
      and (d.action = 'APPROVED' or (p_include_undecided and d.id is null and u.is_active)))
  select coalesce((select approval_tier from tier) is not null, false)
     and not exists (
       select 1 from jsonb_array_elements(approval_requirements((select approval_tier from tier))) g
       where not exists (
         select 1 from jsonb_array_elements(g) o
         where (select count(*) from counted c where c.position = o ->> 'position') >= (o ->> 'count')::int));
$$;

-- Internal helpers (the page computes progress from what the caller can already read)
revoke execute on function public.my_open_approval(bigint) from public, anon, authenticated;
drop function if exists public.approval_requirements_met(bigint);
revoke execute on function public.approval_requirements_met(bigint, boolean) from public, anon, authenticated;
revoke execute on function public.approver_can_act(bigint) from public, anon;
grant execute on function public.approver_can_act(bigint) to authenticated;

-- ============================================================
-- 3. Approver: approve or disapprove
-- ============================================================
-- p_conditions: only with APPROVED ("Approve with conditions"). Returns APPROVED / DISAPPROVED (decided) or WAITING.
drop function if exists public.submit_approval(bigint, approval_action, text);
create or replace function public.submit_approval(p_application_id bigint, p_action approval_action, p_remarks text,
                                                  p_conditions text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_assignment bigint;
  v_visit application_stages;
  v_decided bigint;
  v_me text := coalesce(staff_name(auth.uid()), 'Approver');
  v_position approval_position;
  v_note text;
  v_outcome text;
  v_conditions text := nullif(trim(p_conditions), '');
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  v_assignment := my_open_approval(p_application_id);
  if v_assignment is null then
    raise exception 'Only a routed approver who hasn''t decided yet can do this, while the application is in Approval';
  end if;
  if p_action is null then raise exception 'Pick Approve or Disapprove'; end if;
  if p_action = 'DISAPPROVED' and nullif(trim(p_remarks), '') is null then
    raise exception 'Give the reason for disapproving';
  end if;
  if p_action = 'DISAPPROVED' and v_conditions is not null then
    raise exception 'Only an approval can have conditions';
  end if;

  select approval_position into v_position from users where id = auth.uid();
  insert into approval_decisions (application_id, assignment_id, action, approval_position, remarks, conditions)
  values (p_application_id, v_assignment, p_action, v_position, nullif(trim(p_remarks), ''), v_conditions);

  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  v_note := v_me || coalesce(' (' || initcap(replace(v_position::text, '_', ' ')) || ')', '')
            || case when p_action = 'DISAPPROVED' then ' disapproved'
                    when v_conditions is not null then ' approved with conditions (' || v_conditions || ')'
                    else ' approved' end
            || coalesce(': ' || nullif(trim(p_remarks), ''), '');

  v_outcome := case when approval_requirements_met(p_application_id) then 'APPROVED'
                    when not approval_requirements_met(p_application_id, true) then 'DISAPPROVED' end;
  if v_outcome is null then
    -- The other approver/s can still meet the authority
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'IN_PROGRESS', auth.uid(), left(v_note || '; waiting for the other approver/s', 1000));
    return 'WAITING';
  end if;

  -- Decided (notify_stage_status sends DECIDED when the stage opens)
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_visit.id, 'DONE', auth.uid(), left(v_note, 1000));
  update application_stages set left_at = now() where id = v_visit.id;
  insert into application_stages (application_id, stage) values (p_application_id, 'DECIDED')
  returning id into v_decided;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_decided, 'DONE', auth.uid(),
          left(case v_outcome when 'APPROVED' then 'Approved. ' else 'Disapproved. ' end || v_note, 1000));
  update loan_applications set status = case v_outcome when 'APPROVED' then 'APPROVED' else 'REJECTED' end::application_status
  where id = p_application_id;
  return v_outcome;
end $$;

revoke execute on function public.submit_approval(bigint, approval_action, text, text) from public, anon;
grant execute on function public.submit_approval(bigint, approval_action, text, text) to authenticated;
