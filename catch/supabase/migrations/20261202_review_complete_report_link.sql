-- CATCH — once every reviewer has endorsed a file, the Account Officer and the Credit Officer are told the final report
-- is ready, and the notification opens it (2026-11-23, Josh)
-- Run after 20261201_review_endorse_all_ok.sql (needs 20261108_reviewer_signoff.sql and 20261024_notifications.sql).
-- Re-runnable, no data dropped, no table changed.
--
-- What changes: submit_review() is recreated exactly as in 20261108_reviewer_signoff.sql except for the
-- REVIEW_COMPLETE notification sent after the last reviewer's endorsement (it already went to the assigned CO and AO):
--   title  "<app no> passed review: final report ready"
--   body   who endorsed it + "Generate the final report ..."
--   link   /finalReportPage?id=<id> (was the default: the CO's Financial Package, the AO's loan folder)
-- The final report page gives them the FINAL version from Approval on (reportMode() in finalReport/signoffs.js).
-- Notifications already sent keep their old link.

do $$
begin
  if to_regprocedure('public.submit_review(bigint, review_action, text, jsonb, revision_severity)') is null
     or to_regprocedure('public.send_notification(text, text, text, bigint, uuid[], text[], text[], text, text, boolean, boolean)') is null then
    raise exception 'Run these migrations first, then this file again: 20261024_notifications.sql, 20261108_reviewer_signoff.sql';
  end if;
end $$;

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
      -- Changed in 20261202: opens the final report (was the role's default page)
      perform send_notification('REVIEW_COMPLETE', v_no || ' passed review: final report ready',
        v_note || '; it is with the approvers. Generate the final report (Financial Package, credit scoring sheet, '
          || 'Decision Support and sign-offs) and download it as PDF.',
        p_application_id, p_assigned => array['CREDIT_OFFICER', 'ACCOUNT_OFFICER'],
        p_link => '/finalReportPage?id=' || p_application_id);
    exception when others then raise warning 'REVIEW_COMPLETE notification failed: %', sqlerrm;
    end;
  end if;
end $$;

revoke execute on function public.submit_review(bigint, review_action, text, jsonb, revision_severity) from public, anon;
grant execute on function public.submit_review(bigint, review_action, text, jsonb, revision_severity) to authenticated;
