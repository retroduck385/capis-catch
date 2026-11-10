-- CATCH — Notification and notice fixes after the approver decision (20261110_approver_decision.sql)
-- Run after 20261110_approver_decision.sql. Re-runnable, no drops of data.
--
-- What changes (each replaces one function of 20261024_notifications.sql / 20261029_applicant_notices.sql;
-- nothing else in them changes):
--   1. notice_reason_suggestions(): for REJECTED, no longer offers the Credit Officer's justification (it argues
--      for the CO's own result, e.g. "Endorsed", not for the rejection). It is still offered for DEFERRED.
--   2. notice_reason_suggestions(): for REJECTED, offers each approver's reason for disapproving
--      (approval_decisions.remarks, active assignments only).
--   3. notice_reason_suggestions(): for APPROVED, offers the conditions of an "Approve with conditions" as an
--      optional suggestion. The AO's panel adds a suggestion only when the AO clicks "Use this" and the text stays
--      editable, so nothing is added to the notice automatically.
--   4. notify_on_stage_status(): DECIDED also goes to the routed approvers (active assignments), so the ones who
--      decided earlier or whose decision was no longer needed learn the result. The approver whose decision closed
--      it is the actor and is skipped, as before.
--   5. notify_on_review_routing(): REVIEW_ROUTED now says where the reviewer is in the turn order:
--        the reviewer whose turn it is   "HL-... is ready for your review (reviewer 1 of 3)"
--        a later reviewer                "You were added as reviewer 2 of 3 on HL-..."
--                                        body "You'll be notified when it's your turn."
--      The trigger becomes a DEFERRABLE INITIALLY DEFERRED constraint trigger: send_for_review() and
--      update_review_routing() insert the reviewers one by one before the Review stage opens, so the total and
--      whose turn it is are only known at the end of the transaction. If the transaction fails, nothing is sent.
--
-- Re-runs of earlier files: 20261024_notifications.sql or 20261029_applicant_notices.sql re-run -> run this file
-- again afterwards (they put back their own versions of these functions and the plain trigger).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.approval_decisions') is null then
    raise exception 'Run 20261110_approver_decision.sql first, then this file again';
  end if;
  if to_regprocedure('public.notice_reason_suggestions(bigint, text)') is null then
    raise exception 'Run 20261029_applicant_notices.sql first, then this file again';
  end if;
  if to_regprocedure('public.current_review_assignment(bigint)') is null then
    raise exception 'Run 20261108_reviewer_signoff.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1-3. Reason suggestions for the AO's notice
-- ============================================================
-- Internal staff text: the AO rewrites it for the applicant
create or replace function public.notice_reason_suggestions(p_application_id bigint, p_outcome text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'text', s.text) order by s.ord, s.at), '[]'::jsonb)
  from (
    -- The approvers' own words: why they disapproved, or the conditions of their approval (optional)
    select 0 as ord, d.decided_at as at,
           case when d.action::text = 'DISAPPROVED' then 'Approver''s reason for disapproving'
                else 'Approver''s conditions (optional)' end
           || coalesce(' (' || initcap(replace(d.approval_position::text, '_', ' ')) || ')', '') as source,
           btrim(case when d.action::text = 'DISAPPROVED' then d.remarks else d.conditions end) as text
    from approval_decisions d
    join review_assignments ra on ra.id = d.assignment_id and ra.unassigned_at is null
    where d.application_id = p_application_id
      and ((p_outcome = 'REJECTED' and d.action::text = 'DISAPPROVED' and nullif(btrim(d.remarks), '') is not null)
        or (p_outcome = 'APPROVED' and d.action::text = 'APPROVED' and nullif(btrim(d.conditions), '') is not null))
    union all
    select 1, null, 'Financial Package V. Exceptions: policy', btrim(e.policy)
    from fp_exceptions e
    where e.application_id = p_application_id and p_outcome = 'REJECTED' and nullif(btrim(e.policy), '') is not null
    union all
    select 2, null, 'Credit Officer justification (' || initcap(replace(fp.credit_result::text, '_', ' ')) || ')', btrim(fp.justification)
    from financial_packages fp
    where fp.application_id = p_application_id and p_outcome = 'DEFERRED'
      and nullif(btrim(fp.justification), '') is not null
    union all
    select 3, null, 'Credit Officer deferrals (Financial Package)', btrim(fp.deferrals)
    from financial_packages fp
    where fp.application_id = p_application_id and p_outcome = 'DEFERRED' and nullif(btrim(fp.deferrals), '') is not null
    union all
    select 4, null, 'KYC check marked Needs clarification: ' || k.section, btrim(k.remarks)
    from (select distinct on (section) section, result, remarks from kyc_checks
          where application_id = p_application_id order by section, checked_at desc, id desc) k
    where p_outcome = 'DEFERRED' and k.result::text = 'NEEDS_CLARIFICATION' and nullif(btrim(k.remarks), '') is not null
    union all
    select 5, null, 'Required documents not uploaded',
           'Missing documents: ' || string_agg(m.label, ', ' order by m.label)
    from (select requirement_label(ar.requirement_type) || ' (' ||
                 case a.role::text when 'PRINCIPAL' then 'principal borrower' when 'SPOUSE' then 'spouse'
                      when 'CO_BORROWER' then 'co-borrower ' || a.party_no else lower(a.role::text) end || ')' as label
          from application_requirements ar
          join applicants a on a.id = ar.applicant_id and a.application_id = p_application_id
          left join documents d on d.requirement_id = ar.id
          group by ar.id, ar.requirement_type, a.role, a.party_no
          having count(d.id) < required_document_min(ar.requirement_type)) m
    where p_outcome = 'DEFERRED'
    having count(*) > 0
  ) s;
$$;

revoke execute on function public.notice_reason_suggestions(bigint, text) from public, anon, authenticated;

-- ============================================================
-- 4. Stage opened / returned / Done reverted: DECIDED also to the routed approvers
-- ============================================================
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
      if v_stage = 'INTAKE' then
        perform send_notification('NEW_APPLICATION', 'New application ' || v_no || ' is in the work tray',
          'Open the work tray to claim it.', v_visit.application_id, p_roles => array['ACCOUNT_OFFICER']);
      elsif v_stage = 'CREDIT_EVALUATION' then
        if exists (select 1 from application_assignments where application_id = v_visit.application_id
                   and assignee_role = 'CREDIT_OFFICER' and unassigned_at is null) then
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation', null,
            v_visit.application_id, p_assigned => array['CREDIT_OFFICER']);
        else
          perform send_notification('STAGE_CREDIT_EVALUATION', v_no || ' is ready for credit evaluation',
            'No Credit Officer is assigned yet.', v_visit.application_id, p_roles => array['DISPATCH_ADMIN']);
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

-- ============================================================
-- 5. Reviewers routed / removed; approvers only once the file is in Approval (else when Approval opens)
-- ============================================================
-- Runs at the end of the transaction (constraint trigger below), so the turn order is final.
create or replace function public.notify_on_review_routing() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_no text;
  v_stage text;
  v_label text := case new.assignee_role::text when 'REVIEWER' then 'reviewer' else 'approver' end;
  v_row review_assignments;
  v_total int;
begin
  begin
    v_no := notification_app_no(new.application_id);
    select stage::text into v_stage from application_stages
    where application_id = new.application_id and left_at is null;

    if tg_op = 'INSERT' then
      -- The row as it is now (a later step of the same transaction may have moved or removed it)
      select * into v_row from review_assignments where id = new.id;
      if v_row.id is null or v_row.unassigned_at is not null then return null; end if;

      if new.assignee_role::text = 'REVIEWER' then
        select count(*) into v_total from review_assignments
        where application_id = new.application_id and assignee_role = 'REVIEWER' and unassigned_at is null;
        if v_stage = 'REVIEW' and current_review_assignment(new.application_id) = new.id then
          perform send_notification('REVIEW_ROUTED',
            v_no || ' is ready for your review (reviewer ' || v_row.seq || ' of ' || v_total || ')',
            'By ' || coalesce(staff_name(new.assigned_by), 'the Credit Officer'), new.application_id,
            p_users => array[new.user_id], p_link => '/reviewSummaryPage?id=' || new.application_id);
        else
          perform send_notification('REVIEW_ROUTED',
            'You were added as reviewer ' || v_row.seq || ' of ' || v_total || ' on ' || v_no,
            case when v_stage = 'APPROVAL' then 'Review is already complete; the file is with the approvers.'
                 else 'You''ll be notified when it''s your turn.' end,
            new.application_id, p_users => array[new.user_id], p_link => '/reviewSummaryPage?id=' || new.application_id);
        end if;
      elsif v_stage = 'APPROVAL' then
        perform send_notification('APPROVAL_ROUTED', 'You were added as approver on ' || v_no,
          'By ' || coalesce(staff_name(new.assigned_by), 'a head'), new.application_id,
          p_users => array[new.user_id], p_link => '/reviewSummaryPage?id=' || new.application_id);
      end if;
    elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null
          and (new.assignee_role::text = 'REVIEWER' or v_stage = 'APPROVAL') then
      perform send_notification('REVIEW_UNROUTED', 'You were removed as ' || v_label || ' on ' || v_no,
        'By ' || coalesce(staff_name(new.unassigned_by), 'a head'), new.application_id,
        p_users => array[new.user_id], p_link => '/adminHomePage');
    end if;
  exception when others then
    raise warning 'notify_review_routing failed: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_review_routing on public.review_assignments;
create constraint trigger notify_review_routing after insert or update on public.review_assignments
  deferrable initially deferred
  for each row execute function public.notify_on_review_routing();
