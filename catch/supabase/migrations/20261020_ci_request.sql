-- CATCH — CI request (KYC-FP "CI Request" tab: NFIS Request Form + TransUnion Request Template)
-- Run after 20261007_ao_kyc_verification.sql. Re-runnable, no drops of data.
--
-- The assigned AO sends the application to the Credit Investigator. That is the first stage move:
--   Intake (-> Done, closed)  ->  Credit Investigation (opened as Requested)
-- and the applicant-facing status goes SUBMITTED -> UNDER_CI.
-- KYC sections don't have to be Verified first (Josh, 2026-10-20).
--
-- The assigned AO can still edit the KYC record after the request (Josh, 2026-10-20):
-- ao_can_edit() now allows Intake and Credit Investigation.
--
-- The NFIS / TU forms are NOT stored: the page builds them from the application record, so the
-- CI always sees the current values. Anything the AO changes after the request is in audit_log.
-- Only the AO's remarks are stored here.
-- ID type / number / expiry (TU) are left blank until ID OCR labeling exists.

-- ============================================================
-- 1. Table: one row per request (an application can be re-requested later, e.g. after
--    the CI sends it back for missing details). Insert only through request_ci().
-- ============================================================
create table if not exists public.ci_requests (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  stage_visit_id bigint not null references public.application_stages(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  requested_at timestamptz not null default now(),
  nfis_remarks text,
  tu_remarks text
);
create index if not exists ci_requests_application on public.ci_requests (application_id, requested_at);

alter table public.ci_requests enable row level security;
revoke insert, update, delete, truncate on public.ci_requests from anon, authenticated;

drop policy if exists "staff read ci requests" on public.ci_requests;
create policy "staff read ci requests" on public.ci_requests
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 2. AO edit rights: assigned AO, while in Intake or Credit Investigation
--    (replaces the Intake-only version in 20261007_ao_kyc_verification.sql;
--    if that file is re-run, run this one again)
-- ============================================================
create or replace function public.ao_can_edit(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() = 'ACCOUNT_OFFICER' and exists (
    select 1
    from loan_applications la
    join application_stages s on s.application_id = la.id and s.left_at is null
    join application_assignments aa on aa.application_id = la.id
         and aa.assignee_role = 'ACCOUNT_OFFICER' and aa.unassigned_at is null
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and s.stage in ('INTAKE', 'CREDIT_INVESTIGATION')
      and aa.user_id = auth.uid());
$$;

-- ============================================================
-- 3. request_ci(): assigned AO, while the application is in Intake
-- ============================================================
create or replace function public.request_ci(p_application_id bigint, p_nfis_remarks text default null,
                                             p_tu_remarks text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_intake application_stages;
  v_ci_visit bigint;
  v_request bigint;
  v_me text := coalesce(staff_name(auth.uid()), 'Account Officer');
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  select * into v_intake from application_stages where application_id = p_application_id and left_at is null;

  if not ao_can_edit(p_application_id) or v_intake.stage <> 'INTAKE' then
    raise exception 'Only the assigned Account Officer can request CI, while the application is in Intake';
  end if;

  -- Close Intake
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_intake.id, 'DONE', auth.uid(), 'CI requested by ' || v_me);
  update application_stages set left_at = now() where id = v_intake.id;

  -- Open Credit Investigation
  insert into application_stages (application_id, stage) values (p_application_id, 'CREDIT_INVESTIGATION')
  returning id into v_ci_visit;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_ci_visit, 'REQUESTED', auth.uid(), 'CI requested by ' || v_me);

  insert into ci_requests (application_id, stage_visit_id, requested_by, nfis_remarks, tu_remarks)
  values (p_application_id, v_ci_visit, auth.uid(),
          nullif(trim(p_nfis_remarks), ''), nullif(trim(p_tu_remarks), ''))
  returning id into v_request;

  -- Applicant-facing status (logged in audit_log by the existing trigger)
  update loan_applications set status = 'UNDER_CI' where id = p_application_id;

  return v_request;
end $$;

revoke execute on function public.request_ci(bigint, text, text) from anon;

-- ============================================================
-- 4. The Credit Investigator only sees applications an AO has sent a CI request for:
--    in the work tray and in the record itself (RLS goes through staff_can_access()).
--    Replaces both functions from 20261005_work_tray.sql; if that file is re-run, run this one again.
-- ============================================================
drop function if exists public.get_ci_tray();

create or replace function public.staff_can_access(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and (current_user_role() in ('DISPATCH_ADMIN', 'REVIEWER', 'APPROVER', 'DEPT_HEAD')
           or (current_user_role() = 'CREDIT_INVESTIGATOR'
               and exists (select 1 from ci_requests r where r.application_id = la.id))
           or exists (select 1 from application_assignments aa
                      where aa.application_id = la.id
                        and aa.user_id = auth.uid()
                        and aa.unassigned_at is null)));
$$;

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
    -- CI: only what the AOs sent them
    and (current_user_role() <> 'CREDIT_INVESTIGATOR'
         or exists (select 1 from ci_requests cr where cr.application_id = la.id))
  order by la.submitted_at nulls last, la.id;
$$;

revoke execute on function public.get_work_tray() from anon;
