-- CATCH — Reviewer sign-off: the reviewer is a second layer of checking on the Credit Officer's work
-- Run after 20261108_approver_positions.sql and 20261024_notifications.sql. Re-runnable, no drops of data.
--
-- Why (CATCH Document): Ch. 1.3 — the reviewer stage "checks whether the documents are clear and complete and
-- whether revisions are needed, and returns the package to the credit officer when they are"; the CO interview
-- — "Credit Underwriter → Reviewer → Approver, may check sa bawat step", the reviewing officer re-checks that the
-- computation matches the supporting documents; the Credit Head interview — revisions are minor or major, the
-- account goes back to the CO, the CO acknowledges, fixes it, and it comes back for a final check.
--
-- Josh, 2026-11-08:
--   * The reviewer works through a short checklist (review_check_items: OK / Needs revision + remark per item),
--     then Endorses or Doesn't endorse with a justification, like the CO. Not an approval or a rejection:
--     that stays with the approvers.
--   * Or returns it to the CO for revision (Minor / Major + what to fix). The application goes back to Credit
--     Evaluation with status RETURNED (the existing notify_stage_status trigger tells the assigned CO). The CO
--     answers with what they changed and resends (resend_for_review()); review CONTINUES from the reviewer who
--     returned it (earlier reviewers' sign-offs stand).
--   * Reviewers act in order: only the current reviewer (lowest seq without a sign-off) can act.
--   * After the last reviewer signs off, the application moves to Approval and the approvers are notified
--     (the existing APPROVAL_ROUTED notification on the Approval stage opening).
--   * Desk / field CI request by the first reviewer (BPMN A.5): left out for now (out of scope).
--
-- Every sign-off / return is a row in review_decisions (logged in audit_log); its checklist is in
-- review_decision_items. Both are append-only for clients (no client writes at all; RPCs only insert, and only
-- fill in the CO's response on a return). The round of a decision = 1 + returns before it (not stored).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.review_assignments', '20261021_review_routing.sql'),
               ('public.notifications', '20261024_notifications.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is null and to_regprocedure('public.approval_tier_for(bigint)') is null then
    v_missing := '20261108_approver_positions.sql';
  end if;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Checklist items (what the reviewer checks)
-- ============================================================
create table if not exists public.review_check_items (
  code text primary key check (code ~ '^[A-Z][A-Z_]*$'),
  label text not null,
  hint text,
  sort_order smallint not null
);

insert into public.review_check_items (code, label, hint, sort_order) values
  ('DOCUMENTS', 'Documents clear, complete and matching the KYC',
   'IDs readable; names, birthdates and addresses on the documents match the KYC; every required document is there.', 1),
  ('INCOME', 'Income computation supported by the documents',
   'The income basis fits the document (COE 80% / payslip 90%); other income (bonus, allowances) is backed by a document, not just declared.', 2),
  ('LOAN_TERMS', 'Facility: amount, term, rate and amortization',
   'II. Facility matches the loan details; rate and fixing period set.', 3),
  ('COLLATERAL', 'Collateral and LCR',
   'III. Collateral details, TCP / appraised value, LCR.', 4),
  ('CREDIT_CHECKS', 'CI results reflected in IV. Credit Checking',
   'NFIS / TU / BRAS findings are reflected; loans the CI found are counted in (C) / DBR.', 5),
  ('EXCEPTIONS', 'V. Exception/s complete',
   'Every policy deviation is listed with its mitigant.', 6),
  ('CREDIT_SCORE', 'Credit score',
   'All criteria scored; bands that differ from the suggestion are justified.', 7),
  ('TERMS', 'VI. Terms and Conditions', null, 8),
  ('RECOMMENDATION', 'Credit Officer''s recommendation supported',
   'The Credit Result and justification follow from the figures and findings.', 9)
on conflict (code) do update set label = excluded.label, hint = excluded.hint, sort_order = excluded.sort_order;

alter table public.review_check_items enable row level security;
revoke insert, update, delete, truncate on public.review_check_items from anon, authenticated;
drop policy if exists "staff read review check items" on public.review_check_items;
create policy "staff read review check items" on public.review_check_items
  for select to authenticated using (public.is_staff());

-- ============================================================
-- 2. Decisions
-- ============================================================
do $$ begin
  create type public.review_action as enum ('ENDORSED', 'NOT_ENDORSED', 'RETURNED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.revision_severity as enum ('MINOR', 'MAJOR');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.review_check_result as enum ('OK', 'NEEDS_REVISION');
exception when duplicate_object then null; end $$;

-- So a decision can't point at another application's assignment
do $$ begin
  alter table public.review_assignments add constraint review_assignments_id_application unique (id, application_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- Who decided = the assignment's user_id (not stored twice)
create table if not exists public.review_decisions (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  assignment_id bigint not null,
  action review_action not null,
  severity revision_severity,                 -- returns only
  remarks text not null check (length(trim(remarks)) > 0),  -- justification, or what to revise
  decided_at timestamptz not null default now(),
  -- The CO's answer to a return (what they changed), filled in by resend_for_review()
  response text check (response is null or length(trim(response)) > 0),
  responded_by uuid references public.users(id),
  responded_at timestamptz,
  foreign key (assignment_id, application_id) references public.review_assignments (id, application_id),
  check ((action = 'RETURNED') = (severity is not null)),
  check (action = 'RETURNED' or response is null),
  check ((response is null) = (responded_at is null) and (response is null) = (responded_by is null)),
  check (responded_at is null or responded_at >= decided_at)
);
create index if not exists review_decisions_application on public.review_decisions (application_id, decided_at);
-- One sign-off per assignment (returns can repeat)
create unique index if not exists one_signoff_per_assignment
  on public.review_decisions (assignment_id) where action <> 'RETURNED';
-- At most one unanswered return per application
create unique index if not exists one_open_return
  on public.review_decisions (application_id) where action = 'RETURNED' and response is null;

create table if not exists public.review_decision_items (
  decision_id bigint not null references public.review_decisions(id) on delete cascade,
  item_code text not null references public.review_check_items(code),
  result review_check_result not null,
  remark text,
  primary key (decision_id, item_code),
  check (result = 'OK' or length(trim(coalesce(remark, ''))) > 0)
);

alter table public.review_decisions enable row level security;
alter table public.review_decision_items enable row level security;
revoke insert, update, delete, truncate on public.review_decisions from anon, authenticated;
revoke insert, update, delete, truncate on public.review_decision_items from anon, authenticated;

drop policy if exists "staff read review decisions" on public.review_decisions;
create policy "staff read review decisions" on public.review_decisions
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "staff read review decision items" on public.review_decision_items;
create policy "staff read review decision items" on public.review_decision_items
  for select to authenticated using (exists (
    select 1 from public.review_decisions d
    where d.id = decision_id and public.staff_can_access(d.application_id)));

drop trigger if exists log_application_change on public.review_decisions;
create trigger log_application_change after insert or update or delete on public.review_decisions
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 3. Whose turn
-- ============================================================
-- The current reviewer's assignment: lowest seq active reviewer without a sign-off; null = all signed off
create or replace function public.current_review_assignment(p_application_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select ra.id from review_assignments ra
  where ra.application_id = p_application_id and ra.assignee_role = 'REVIEWER' and ra.unassigned_at is null
    and not exists (select 1 from review_decisions d where d.assignment_id = ra.id and d.action <> 'RETURNED')
  order by ra.seq, ra.id
  limit 1;
$$;

-- True only for the current reviewer while the application is in Review
create or replace function public.reviewer_can_act(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role() = 'REVIEWER', false)
     and exists (select 1 from application_stages s
                 where s.application_id = p_application_id and s.left_at is null and s.stage = 'REVIEW')
     and exists (select 1 from review_assignments ra
                 where ra.id = current_review_assignment(p_application_id) and ra.user_id = auth.uid());
$$;

revoke execute on function public.current_review_assignment(bigint) from anon;
revoke execute on function public.reviewer_can_act(bigint) from anon;

-- ============================================================
-- 4. Reviewer: sign off or return
-- ============================================================
-- p_items: [{ "code": "INCOME", "result": "OK" | "NEEDS_REVISION", "remark": "..." }, ...]
--   Endorse / Not endorse: every checklist item marked. Return: at least one item marked Needs revision.
create or replace function public.submit_review(p_application_id bigint, p_action review_action,
                                                p_remarks text, p_items jsonb,
                                                p_severity revision_severity default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_assignment review_assignments;
  v_visit application_stages;
  v_decision bigint;
  v_next review_assignments;
  v_total int;
  v_no text;
  v_me text := coalesce(staff_name(auth.uid()), 'Reviewer');
  v_label text := case p_action when 'ENDORSED' then 'endorsed' when 'NOT_ENDORSED' then 'did not endorse'
                                else 'returned it' end;
  v_note text;
  v_ce bigint;
  v_approval bigint;
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  if not reviewer_can_act(p_application_id) then
    raise exception 'Only the current reviewer can sign off, while the application is in Review';
  end if;
  select * into v_assignment from review_assignments where id = current_review_assignment(p_application_id);
  select * into v_visit from application_stages where application_id = p_application_id and left_at is null;
  select count(*) into v_total from review_assignments
  where application_id = p_application_id and assignee_role = 'REVIEWER' and unassigned_at is null;
  v_no := notification_app_no(p_application_id);

  -- Inputs
  if p_action is null then raise exception 'Pick Endorse, Not endorse or Return to the Credit Officer'; end if;
  if nullif(trim(p_remarks), '') is null then
    raise exception '%', case when p_action = 'RETURNED' then 'Say what the Credit Officer needs to revise'
                              else 'Write the justification' end;
  end if;
  if p_action = 'RETURNED' and p_severity is null then raise exception 'Pick Minor or Major revision'; end if;
  if p_action <> 'RETURNED' and p_severity is not null then raise exception 'Only a return has a severity'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' then raise exception 'Checklist must be a list'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) i
             where not exists (select 1 from review_check_items c where c.code = i ->> 'code')
                or i ->> 'result' is null or i ->> 'result' not in ('OK', 'NEEDS_REVISION')) then
    raise exception 'Unknown checklist item or result';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_items, '[]')))
     <> (select count(distinct i ->> 'code') from jsonb_array_elements(coalesce(p_items, '[]')) i) then
    raise exception 'A checklist item is listed twice';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) i
             where i ->> 'result' = 'NEEDS_REVISION' and nullif(trim(i ->> 'remark'), '') is null) then
    raise exception 'Add a remark to every item marked Needs revision';
  end if;
  if p_action <> 'RETURNED' and exists (
       select 1 from review_check_items c
       where not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) i where i ->> 'code' = c.code)) then
    raise exception 'Mark every checklist item before signing off';
  end if;
  if p_action = 'RETURNED' and not exists (
       select 1 from jsonb_array_elements(coalesce(p_items, '[]')) i where i ->> 'result' = 'NEEDS_REVISION') then
    raise exception 'Mark at least one checklist item as Needs revision';
  end if;

  insert into review_decisions (application_id, assignment_id, action, severity, remarks)
  values (p_application_id, v_assignment.id, p_action, p_severity, trim(p_remarks))
  returning id into v_decision;
  insert into review_decision_items (decision_id, item_code, result, remark)
  select v_decision, i ->> 'code', (i ->> 'result')::review_check_result, nullif(trim(i ->> 'remark'), '')
  from jsonb_array_elements(coalesce(p_items, '[]')) i;

  if p_action = 'RETURNED' then
    -- Review ends here; Credit Evaluation reopens as RETURNED (notify_stage_status tells the assigned CO)
    v_note := 'Returned to the Credit Officer by reviewer ' || v_assignment.seq || ' (' || v_me || '), '
              || lower(p_severity::text) || ' revision: ' || trim(p_remarks);
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'DONE', auth.uid(), left(v_note, 1000));
    update application_stages set left_at = now() where id = v_visit.id;
    insert into application_stages (application_id, stage) values (p_application_id, 'CREDIT_EVALUATION')
    returning id into v_ce;
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_ce, 'RETURNED', auth.uid(), left(v_note, 1000));
    update loan_applications set status = 'UNDER_CREDIT_EVALUATION' where id = p_application_id;
    return;
  end if;

  v_note := 'Reviewer ' || v_assignment.seq || ' of ' || v_total || ' (' || v_me || ') ' || v_label;
  select * into v_next from review_assignments where id = current_review_assignment(p_application_id);

  if v_next.id is not null then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'IN_PROGRESS', auth.uid(), v_note || '; now with reviewer ' || v_next.seq);
    begin
      perform send_notification('REVIEW_YOUR_TURN',
        v_no || ' is ready for your review (reviewer ' || v_next.seq || ' of ' || v_total || ')',
        v_note || '.', p_application_id, p_users => array[v_next.user_id],
        p_link => '/reviewSummaryPage?id=' || p_application_id);
    exception when others then raise warning 'REVIEW_YOUR_TURN notification failed: %', sqlerrm;
    end;
  else
    -- Last reviewer: Review done, Approval opens (notify_stage_status tells the routed approvers)
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit.id, 'DONE', auth.uid(), v_note || '; review complete');
    update application_stages set left_at = now() where id = v_visit.id;
    insert into application_stages (application_id, stage) values (p_application_id, 'APPROVAL')
    returning id into v_approval;
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_approval, 'PENDING', auth.uid(), 'Review complete; sent to the approvers');
    update loan_applications set status = 'FOR_APPROVAL' where id = p_application_id;
    begin
      perform send_notification('REVIEW_COMPLETE', v_no || ' passed review and is with the approvers',
        v_note || '.', p_application_id, p_assigned => array['CREDIT_OFFICER', 'ACCOUNT_OFFICER']);
    exception when others then raise warning 'REVIEW_COMPLETE notification failed: %', sqlerrm;
    end;
  end if;
end $$;

revoke execute on function public.submit_review(bigint, review_action, text, jsonb, revision_severity) from public, anon;
grant execute on function public.submit_review(bigint, review_action, text, jsonb, revision_severity) to authenticated;

-- ============================================================
-- 5. Credit Officer: answer a return and send it back
-- ============================================================
-- Assigned CO, in Credit Evaluation, with an unanswered return. Review continues from the reviewer who returned it.
-- The approval authority only goes UP here (e.g. an exception was added during the revision); a head's
-- override that is higher than the matrix is kept.
create or replace function public.resend_for_review(p_application_id bigint, p_response text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stage application_stages;
  v_return review_decisions;
  v_pkg financial_packages;
  v_tier approval_tier;
  v_review bigint;
  v_current review_assignments;
  v_total int;
  v_note text := 'Revised and sent back to review by ' || coalesce(staff_name(auth.uid()), 'the Credit Officer');
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  select * into v_stage from application_stages where application_id = p_application_id and left_at is null;
  select * into v_return from review_decisions
  where application_id = p_application_id and action = 'RETURNED' and response is null;
  if not co_can_edit(p_application_id) or not coalesce(v_stage.stage = 'CREDIT_EVALUATION', false)
     or v_return.id is null then
    raise exception 'Only the assigned Credit Officer can send it back, after a reviewer returned it for revision';
  end if;
  if nullif(trim(p_response), '') is null then raise exception 'Say what you changed'; end if;

  select * into v_pkg from financial_packages where application_id = p_application_id;
  if v_pkg.credit_result is null or v_pkg.credit_result = 'DEFERRED' then
    raise exception 'Save a Credit Result of Endorsed or Not endorsed in the Financial Package first';
  end if;

  select * into v_current from review_assignments where id = current_review_assignment(p_application_id);
  if v_current.id is null then
    raise exception 'No reviewer is left to review it. Ask the Dept Head or the Dispatch Admin to add one.';
  end if;

  v_tier := greatest(v_pkg.approval_tier, approval_tier_for(p_application_id));
  if v_tier is null then raise exception 'The application has no loan amount, so the approval authority can''t be set'; end if;
  if v_tier is distinct from v_pkg.approval_tier then
    perform check_approvers_cover(v_tier);
    update financial_packages set approval_tier = v_tier where application_id = p_application_id;
    perform sync_review_assignments(p_application_id, 'APPROVER', approvers_for_tier(v_tier));
  end if;

  update review_decisions set response = trim(p_response), responded_by = auth.uid(), responded_at = now()
  where id = v_return.id;

  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_stage.id, 'DONE', auth.uid(), v_note);
  update application_stages set left_at = now() where id = v_stage.id;
  insert into application_stages (application_id, stage) values (p_application_id, 'REVIEW')
  returning id into v_review;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_review, 'PENDING', auth.uid(), v_note);
  update loan_applications set status = 'UNDER_REVIEW' where id = p_application_id;

  select count(*) into v_total from review_assignments
  where application_id = p_application_id and assignee_role = 'REVIEWER' and unassigned_at is null;
  begin
    perform send_notification('REVIEW_RESUBMITTED',
      notification_app_no(p_application_id) || ' was revised and is back for your review (reviewer '
        || v_current.seq || ' of ' || v_total || ')',
      left(trim(p_response), 500), p_application_id, p_users => array[v_current.user_id],
      p_link => '/reviewSummaryPage?id=' || p_application_id);
  exception when others then raise warning 'REVIEW_RESUBMITTED notification failed: %', sqlerrm;
  end;
end $$;

revoke execute on function public.resend_for_review(bigint, text) from public, anon;
grant execute on function public.resend_for_review(bigint, text) to authenticated;
