-- CATCH — Account Officers can view every submitted application (read-only)
-- Run after 20261020_ci_request.sql. Re-runnable, no drops of data.
--
-- Josh, 2026-10-20: an AO sees and opens every application in the work tray, but can only
-- edit once they claim it ("Assign me") or a head assigns them. Editing is still gated by
-- ao_can_edit() (assigned AO, stage Intake or Credit Investigation), which is unchanged.
--
-- staff_can_access() is the read gate for the record, child tables, documents/storage, OCR,
-- KYC checks, audit log and CI requests, so opening it to AOs gives them read access everywhere.
-- Replaces staff_can_access() from 20261020_ci_request.sql; if that file is re-run, run this one again.
-- COs are unchanged: they still only read what's assigned to them.

create or replace function public.staff_can_access(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and (current_user_role() in ('ACCOUNT_OFFICER', 'DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD')
           or (current_user_role() = 'CREDIT_INVESTIGATOR'
               and exists (select 1 from ci_requests r where r.application_id = la.id))
           or exists (select 1 from application_assignments aa
                      where aa.application_id = la.id
                        and aa.user_id = auth.uid()
                        and aa.unassigned_at is null)));
$$;
