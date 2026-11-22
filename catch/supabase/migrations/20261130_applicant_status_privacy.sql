-- CATCH — the applicant can no longer read the internal status, the bank's terms or the stage history (2026-11-22)
-- Run after 20261129_flag_inconclusive.sql (needs 20261029_applicant_notices.sql and 20261112_document_requests.sql).
-- Re-runnable, no drops of data.
--
-- The gap: "read own applications" (20260928_application_side.sql) let an applicant read their whole loan_applications
-- row in every status, so APPROVED / REJECTED was readable before the Account Officer sent the notice. No screen
-- showed it, but a technical user could. "read stages" / "read stage status" (20261005_work_tray.sql) also let the
-- owner read application_stages and stage_status_changes, whose notes hold staff names, reviewer remarks and the
-- approvers' decisions and reasons. my_application_statuses() (20261029) returned the raw status too.
--
-- What changes
--   1. "read own applications": the applicant reads their own row directly only while it is a DRAFT (the form's
--      create / edit / delete). Submitted files are read through my_loan_applications().
--   2. my_loan_applications(): the caller's own applications with every loan_applications column, except
--        status         APPROVED / REJECTED / DEFERRED show as FOR_APPROVAL until the AO has sent the notice for that
--                       outcome (the same rule as applicant_visible_status()); every other status as it is
--        interest_rate, fixing_period   null until the AO has sent the outcome notice
--      It returns the table's row type, so PostgREST can still nest the child tables (applicants, documents, ...),
--      which stay readable through owns_application() as before.
--   3. my_application_statuses(): same columns; status is the masked value of 2.
--   4. "read stages" / "read stage status": staff only (staff_can_access), the applicant no longer reads them.
--
-- Not changed: storage policies, document requests, applicant notices, submit_application() and every staff policy.
-- They read loan_applications through security definer functions (owns_application(), document_request_open_for_me(),
-- ...), so the new DRAFT-only rule doesn't touch them.
--
-- Re-runs of earlier files:
--   * 20260928_application_side.sql or 20261005_work_tray.sql re-run -> the old policies come back: run this file again.
--   * 20261029_applicant_notices.sql re-run -> my_application_statuses() returns the raw status again: run
--     20261112_document_requests.sql and then this file again.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regprocedure('public.current_applicant_outcome(bigint)') is null
     or to_regprocedure('public.my_application_statuses()') is null then
    raise exception 'Run 20261029_applicant_notices.sql first, then this file again';
  end if;
  if to_regclass('public.document_requests') is null then
    raise exception 'Run 20261112_document_requests.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. What the applicant may know about their own file
-- ============================================================
-- Whether the AO has sent the notice for the outcome the file is in now (false when the status isn't an outcome)
create or replace function public.applicant_outcome_notice_sent(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from applicant_notices n where n.outcome_id = current_applicant_outcome(p_application_id));
$$;

-- The status the applicant may know: an outcome shows as FOR_APPROVAL (Final approval) until its notice was sent
create or replace function public.applicant_known_status(p_status application_status, p_notice_sent boolean)
returns application_status language sql immutable as $$
  select case when p_status in ('APPROVED', 'REJECTED', 'DEFERRED') and not p_notice_sent
              then 'FOR_APPROVAL'::application_status else p_status end;
$$;

revoke execute on function public.applicant_outcome_notice_sent(bigint) from public, anon, authenticated;
revoke execute on function public.applicant_known_status(application_status, boolean) from public, anon, authenticated;

-- ============================================================
-- 2. Applicants read their row directly only while it is a draft
-- ============================================================
drop policy if exists "read own applications" on public.loan_applications;
create policy "read own applications" on public.loan_applications
  for select to authenticated using (user_id = auth.uid() and status = 'DRAFT');

-- ============================================================
-- 3. The applicant's own applications, masked
-- ============================================================
create or replace function public.my_loan_applications()
returns setof public.loan_applications
language plpgsql stable security definer set search_path = public as $$
declare
  r loan_applications;
  v_sent boolean;
begin
  for r in select * from loan_applications where user_id = auth.uid() order by id loop
    v_sent := applicant_outcome_notice_sent(r.id);
    r.status := applicant_known_status(r.status, v_sent);
    if not v_sent then
      r.interest_rate := null;
      r.fixing_period := null;
    end if;
    return next r;
  end loop;
end $$;

revoke execute on function public.my_loan_applications() from public, anon;
grant execute on function public.my_loan_applications() to authenticated;

-- Same columns as 20261029; status is now the masked value
create or replace function public.my_application_statuses()
returns table (application_id bigint, status text, visible_status text, notice_sent boolean)
language sql stable security definer set search_path = public as $$
  select la.id, applicant_known_status(la.status, applicant_outcome_notice_sent(la.id))::text,
         case when la.status::text = 'DRAFT' then 'DRAFT' else applicant_visible_status(la.id) end,
         applicant_outcome_notice_sent(la.id)
  from loan_applications la where la.user_id = auth.uid()
  order by la.id;
$$;

revoke execute on function public.my_application_statuses() from public, anon;
grant execute on function public.my_application_statuses() to authenticated;

-- ============================================================
-- 4. Stage history: staff only
-- ============================================================
drop policy if exists "read stages" on public.application_stages;
create policy "read stages" on public.application_stages
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "read stage status" on public.stage_status_changes;
create policy "read stage status" on public.stage_status_changes
  for select to authenticated
  using (exists (select 1 from public.application_stages s
                 where s.id = stage_visit_id and public.staff_can_access(s.application_id)));
