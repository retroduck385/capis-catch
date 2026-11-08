-- CATCH — Credit Investigator results (BPMN CI lane: TU, NFIS, BRAS -> upload results -> Done)
-- Run after 20261108_approver_positions.sql (needs the CI request, OCR and notification migrations).
-- Re-runnable, no drops of data.
--
-- Decided with Josh (2026-11-08):
--   * Per borrower (principal, spouse, co-borrowers) and per check (NFIS, TU, BRAS): uploaded report file(s),
--     a result (No adverse findings / With findings) and the CI's summarized findings. Plus overall CI remarks.
--   * Any active Credit Investigator can work any application with a CI request (no claiming), while the
--     application is in Credit Investigation. Every change is in audit_log with who made it.
--   * "Mark CI Done" (complete_ci): Credit Investigation -> Done, Credit Evaluation opened, status
--     UNDER_CREDIT_EVALUATION, and the Credit Officer is notified (the assigned CO; every active CO when nobody
--     is assigned yet). The assigned AO hears about it too. Needs an NFIS and a TU result + report for every borrower.
--   * Uploaded reports are OCR'd by the same PaddleOCR worker (raw lines in ocr_runs / ocr_lines, checked in
--     Supabase only; no field mapping yet, the LLM comes later).
--
-- CI files are NOT in public.documents and NOT in the applicant's storage folder: the applicant can read both,
-- and must never see bureau / NFIS results. They live in ci_documents, stored at ci/{application_id}/... in the
-- same bucket. The applicant's storage policy only matches {their user id}/..., so they can't read them; staff
-- read them through the existing "staff reads files" policy (folder 2 = application id).
--
-- Re-runs of earlier files:
--   * 20261007_id_ocr.sql re-run -> claim_ocr_runs(), the ocr_run_text view and the ocr_runs read policy go back
--     to documents only: run this file again afterwards.
--   * 20261007_ao_kyc_verification.sql re-run -> the AO delete-files policy loses the "not ci/" guard: run this again.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.ci_requests', '20261020_ci_request.sql'),
               ('public.ocr_runs', '20261007_id_ocr.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql'),
               ('public.notifications', '20261024_notifications.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Types and tables
-- ============================================================
do $$ begin
  create type public.ci_check_type as enum ('NFIS', 'TU', 'BRAS');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ci_check_result as enum ('NO_ADVERSE_FINDINGS', 'WITH_FINDINGS');
exception when duplicate_object then null; end $$;

-- One row per borrower per check. Written only through save_ci_findings() / add_ci_document().
create table if not exists public.ci_checks (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  check_type public.ci_check_type not null,
  result public.ci_check_result,
  summary text check (length(summary) <= 4000),
  unique (applicant_id, check_type)
);

-- Uploaded CI reports (TU credit report, NFIS result, BRAS printout, ...). Written only through the RPCs.
create table if not exists public.ci_documents (
  id bigint generated always as identity primary key,
  applicant_id bigint not null,
  check_type public.ci_check_type not null,
  file_name text not null,                 -- renamed: LAST-FIRST_PRINCIPAL_TU_1.pdf
  original_file_name text not null,
  file_path text not null unique check (file_path ~ '^ci/[0-9]+/'),
  uploaded_by uuid not null default auth.uid() references public.users(id),
  uploaded_at timestamptz not null default now(),
  foreign key (applicant_id, check_type) references public.ci_checks (applicant_id, check_type) on delete cascade
);
create index if not exists ci_documents_check on public.ci_documents (applicant_id, check_type);

-- Overall remarks of the CI, on the request they answer
alter table public.ci_requests add column if not exists ci_remarks text check (length(ci_remarks) <= 4000);

-- ============================================================
-- 2. Access: staff with access to the application read (the CI only once requested); no client writes
-- ============================================================
alter table public.ci_checks enable row level security;
alter table public.ci_documents enable row level security;
revoke insert, update, delete, truncate on public.ci_checks, public.ci_documents from anon, authenticated;
grant select on public.ci_checks, public.ci_documents to authenticated;

drop policy if exists "staff read ci checks" on public.ci_checks;
create policy "staff read ci checks" on public.ci_checks
  for select to authenticated using (public.staff_can_access_applicant(applicant_id));

drop policy if exists "staff read ci documents" on public.ci_documents;
create policy "staff read ci documents" on public.ci_documents
  for select to authenticated using (public.staff_can_access_applicant(applicant_id));

-- Audit trail (same trigger as the KYC record)
drop trigger if exists log_application_change on public.ci_checks;
create trigger log_application_change after insert or update or delete on public.ci_checks
  for each row execute function public.log_application_change('applicant_id');
drop trigger if exists log_application_change on public.ci_documents;
create trigger log_application_change after insert or update or delete on public.ci_documents
  for each row execute function public.log_application_change('applicant_id');
drop trigger if exists log_application_change on public.ci_requests;
create trigger log_application_change after insert or update or delete on public.ci_requests
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 3. Helpers
-- ============================================================
-- Any active Credit Investigator, while the application is in Credit Investigation and was requested
create or replace function public.ci_can_edit(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_user_role() = 'CREDIT_INVESTIGATOR', false)
     and exists (select 1 from application_stages s
                 where s.application_id = p_application_id and s.left_at is null
                   and s.stage = 'CREDIT_INVESTIGATION')
     and exists (select 1 from ci_requests r where r.application_id = p_application_id);
$$;

-- Application of a borrower (principal / spouse / co-borrower); null for anyone else
create or replace function public.ci_borrower_application(p_applicant_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select application_id from applicants
  where id = p_applicant_id and role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER');
$$;

create or replace function public.ci_party_label(p_role party_role, p_party_no int)
returns text language sql immutable as $$
  select case p_role when 'PRINCIPAL' then 'Principal' when 'SPOUSE' then 'Spouse'
                     else 'Co-borrower ' || coalesce(p_party_no, 1) end;
$$;

-- First thing a CI saves or uploads: Credit Investigation Requested -> In Progress (shows in the work tray)
create or replace function public.ci_mark_started(p_application_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_visit bigint;
begin
  select id into v_visit from application_stages
  where application_id = p_application_id and left_at is null and stage = 'CREDIT_INVESTIGATION';
  if v_visit is not null and current_stage_status(v_visit) = 'REQUESTED' then
    insert into stage_status_changes (stage_visit_id, status, changed_by, note)
    values (v_visit, 'IN_PROGRESS', auth.uid(), 'Started by ' || coalesce(staff_name(auth.uid()), 'Credit Investigator'));
  end if;
end $$;

create or replace function public.ci_refuse() returns void language plpgsql as $$
begin
  raise exception 'Only a Credit Investigator can record CI results, while the application is in Credit Investigation';
end $$;

-- ============================================================
-- 4. RPCs (the page's only way to write)
-- ============================================================
-- Save results + summaries (full list from the page) and the overall remarks.
-- p_checks: [{"applicant_id": 1, "check_type": "TU", "result": "WITH_FINDINGS" | null, "summary": "..."}]
-- Unchanged rows are not touched, so the audit log only shows real changes.
create or replace function public.save_ci_findings(p_application_id bigint, p_checks jsonb, p_remarks text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  v_applicant bigint;
  v_type ci_check_type;
  v_result ci_check_result;
  v_summary text;
  v_request bigint;
begin
  perform 1 from loan_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not ci_can_edit(p_application_id) then perform ci_refuse(); end if;

  for c in select * from jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) loop
    v_applicant := (c->>'applicant_id')::bigint;
    v_type := (c->>'check_type')::ci_check_type;
    v_result := nullif(c->>'result', '')::ci_check_result;
    v_summary := nullif(trim(c->>'summary'), '');

    if ci_borrower_application(v_applicant) is distinct from p_application_id then
      raise exception 'That borrower is not on this application';
    end if;

    if v_result is null and v_summary is null
       and not exists (select 1 from ci_checks where applicant_id = v_applicant and check_type = v_type) then
      continue;  -- nothing to save, nothing saved before
    end if;

    insert into ci_checks (applicant_id, check_type, result, summary)
    values (v_applicant, v_type, v_result, v_summary)
    on conflict (applicant_id, check_type) do update
      set result = excluded.result, summary = excluded.summary
      where (ci_checks.result, ci_checks.summary) is distinct from (excluded.result, excluded.summary);
  end loop;

  select id into v_request from ci_requests where application_id = p_application_id
  order by requested_at desc, id desc limit 1;
  update ci_requests set ci_remarks = nullif(trim(p_remarks), '')
  where id = v_request and ci_remarks is distinct from nullif(trim(p_remarks), '');

  perform ci_mark_started(p_application_id);
end $$;

-- Register a file the page just uploaded to Storage at ci/{application_id}/... Returns the new row id.
create or replace function public.add_ci_document(p_applicant_id bigint, p_check_type ci_check_type,
                                                  p_file_name text, p_file_path text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_app bigint := ci_borrower_application(p_applicant_id);
  v_party applicants;
  v_ext text := lower(substring(p_file_name from '\.([A-Za-z0-9]+)$'));
  v_n int;
  v_id bigint;
begin
  if v_app is null then raise exception 'That borrower is not on this application'; end if;
  perform 1 from loan_applications where id = v_app for update;
  if not ci_can_edit(v_app) then perform ci_refuse(); end if;
  if p_file_path is null or p_file_path not like 'ci/' || v_app || '/%' then
    raise exception 'File is not in this application''s CI folder';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'application-documents' and name = p_file_path) then
    raise exception 'Upload the file first';
  end if;

  insert into ci_checks (applicant_id, check_type) values (p_applicant_id, p_check_type)
  on conflict (applicant_id, check_type) do nothing;

  select * into v_party from applicants where id = p_applicant_id;
  select coalesce(max(substring(file_name from '_(\d+)(\.[A-Za-z0-9]+)?$')::int), 0) + 1 into v_n
  from ci_documents where applicant_id = p_applicant_id and check_type = p_check_type;

  insert into ci_documents (applicant_id, check_type, file_name, original_file_name, file_path)
  values (p_applicant_id, p_check_type,
          concat_ws('_',
            nullif(trim(both '-' from upper(regexp_replace(
                concat_ws(' ', v_party.first_name, v_party.middle_name, v_party.last_name, v_party.name_extension),
                '[^A-Za-z0-9]+', '-', 'g'))), ''),
            case when v_party.role = 'CO_BORROWER' then 'COBORROWER' || v_party.party_no else v_party.role::text end,
            p_check_type::text,
            v_n) || coalesce('.' || v_ext, ''),
          coalesce(nullif(trim(p_file_name), ''), 'file'),
          p_file_path)
  returning id into v_id;

  perform ci_mark_started(v_app);
  return v_id;
end $$;

-- Remove a CI file's row; returns its Storage path so the page can delete the file too
create or replace function public.remove_ci_document(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_doc ci_documents;
  v_app bigint;
begin
  select * into v_doc from ci_documents where id = p_id;
  if not found then raise exception 'File not found'; end if;
  v_app := ci_borrower_application(v_doc.applicant_id);
  perform 1 from loan_applications where id = v_app for update;
  if not ci_can_edit(v_app) then perform ci_refuse(); end if;
  delete from ci_documents where id = p_id;
  return v_doc.file_path;
end $$;

-- What's still missing before CI can be marked Done (empty = ready). Anyone who can read the file may ask.
create or replace function public.ci_missing(p_application_id bigint)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(msg order by ord, party_ord, t, kind), '{}')
  from (
    select ci_party_label(a.role, a.party_no) || ': ' || t::text || ' result' as msg,
           1 as ord, case a.role when 'PRINCIPAL' then 0 when 'SPOUSE' then 1 else 1 + a.party_no end as party_ord,
           t, 1 as kind
    from applicants a cross join unnest(array['NFIS', 'TU']::ci_check_type[]) t
    left join ci_checks c on c.applicant_id = a.id and c.check_type = t
    where a.application_id = p_application_id and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
      and c.result is null
    union all
    select ci_party_label(a.role, a.party_no) || ': ' || t::text || ' report (upload the file)',
           1, case a.role when 'PRINCIPAL' then 0 when 'SPOUSE' then 1 else 1 + a.party_no end, t, 2
    from applicants a cross join unnest(array['NFIS', 'TU']::ci_check_type[]) t
    where a.application_id = p_application_id and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
      and not exists (select 1 from ci_documents d where d.applicant_id = a.id and d.check_type = t)
  ) m
  where staff_can_access(p_application_id);
$$;

-- Mark CI Done: Credit Investigation -> Done, Credit Evaluation opened, CO (and AO) notified.
-- Returns what's missing instead (nothing changes then), like submit_application().
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

  -- Open Credit Evaluation (In Progress straight away if a CO already claimed the file).
  -- The stage trigger notifies the assigned CO (STAGE_CREDIT_EVALUATION), or the Dispatch Admins if none.
  select user_id into v_co from application_assignments
  where application_id = p_application_id and assignee_role = 'CREDIT_OFFICER' and unassigned_at is null;
  insert into application_stages (application_id, stage) values (p_application_id, 'CREDIT_EVALUATION')
  returning id into v_ce;
  insert into stage_status_changes (stage_visit_id, status, changed_by, note)
  values (v_ce, case when v_co is null then 'PENDING' else 'IN_PROGRESS' end::stage_status, auth.uid(),
          'CI done by ' || v_me);

  update loan_applications set status = 'UNDER_CREDIT_EVALUATION' where id = p_application_id;

  -- Nobody claimed it yet: every active Credit Officer hears about it. The assigned AO always does.
  begin
    v_no := notification_app_no(p_application_id);
    if v_co is null then
      perform send_notification('CI_DONE', 'CI results are in for ' || v_no,
        'Credit Investigation is done. Open the Financial Package and assign yourself to evaluate it.',
        p_application_id, p_roles => array['CREDIT_OFFICER']);
    end if;
    perform send_notification('CI_DONE', 'CI results are in for ' || v_no, 'Done by ' || v_me || '.',
      p_application_id, p_assigned => array['ACCOUNT_OFFICER']);
  exception when others then
    raise warning 'CI_DONE notification failed: %', sqlerrm;
  end;

  return '{}';
end $$;

revoke execute on function public.ci_mark_started(bigint) from public, anon, authenticated;
revoke execute on function public.ci_refuse() from public, anon, authenticated;
revoke execute on function public.ci_can_edit(bigint) from anon;
revoke execute on function public.save_ci_findings(bigint, jsonb, text) from anon;
revoke execute on function public.add_ci_document(bigint, ci_check_type, text, text) from anon;
revoke execute on function public.remove_ci_document(bigint) from anon;
revoke execute on function public.ci_missing(bigint) from anon;
revoke execute on function public.complete_ci(bigint) from anon;

-- ============================================================
-- 5. Storage: CI files at ci/{application_id}/{applicant_id}/{check}/{timestamp}.ext
-- ============================================================
drop policy if exists "CI uploads ci files" on storage.objects;
create policy "CI uploads ci files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-documents'
              and (storage.foldername(name))[1] = 'ci'
              and public.ci_can_edit(((storage.foldername(name))[2])::bigint));

drop policy if exists "CI deletes ci files" on storage.objects;
create policy "CI deletes ci files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and (storage.foldername(name))[1] = 'ci'
         and public.ci_can_edit(((storage.foldername(name))[2])::bigint));

-- Same as 20261007_ao_kyc_verification.sql, but the AO can't delete the CI's files
drop policy if exists "assigned AO deletes files" on storage.objects;
create policy "assigned AO deletes files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and (storage.foldername(name))[1] <> 'ci'
         and public.ao_can_edit(((storage.foldername(name))[2])::bigint));

-- ============================================================
-- 6. OCR: CI files go through the same queue and worker (worker code unchanged)
-- ============================================================
alter table public.ocr_runs alter column document_id drop not null;
alter table public.ocr_runs add column if not exists ci_document_id bigint
  references public.ci_documents(id) on delete cascade;
create index if not exists ocr_runs_ci_document_idx on public.ocr_runs (ci_document_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ocr_runs_one_source') then
    alter table public.ocr_runs add constraint ocr_runs_one_source
      check (num_nonnulls(document_id, ci_document_id) = 1);
  end if;
end $$;

create or replace function public.queue_ci_ocr_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into ocr_runs (ci_document_id) values (new.id);
  return new;
end $$;

drop trigger if exists queue_ci_ocr_run on public.ci_documents;
create trigger queue_ci_ocr_run after insert on public.ci_documents
  for each row execute function public.queue_ci_ocr_run();

-- Same result columns as before (the worker reads run_id + file_path); CI files report document_type CI_<check>.
create or replace function public.claim_ocr_runs(p_limit int default 1)
returns table (run_id bigint, document_id bigint, file_path text, file_name text, document_type text)
language plpgsql security definer set search_path = public as $$
begin
  update ocr_runs set status = 'PENDING', started_at = null
  where status = 'RUNNING' and started_at < now() - interval '15 minutes';

  return query
  with picked as (
    select r.id from ocr_runs r
    where r.status = 'PENDING'
    order by r.created_at
    limit p_limit
    for update skip locked),
  claimed as (
    update ocr_runs r set status = 'RUNNING', started_at = now()
    from picked where r.id = picked.id
    returning r.id as rid, r.document_id as did, r.ci_document_id as cid)
  select c.rid, c.did,
         coalesce(d.file_path, cd.file_path),
         coalesce(d.file_name, cd.file_name),
         coalesce(d.document_type, 'CI_' || cd.check_type::text)
  from claimed c
  left join documents d on d.id = c.did
  left join ci_documents cd on cd.id = c.cid;
end $$;

revoke execute on function public.claim_ocr_runs(int) from public, anon, authenticated;
grant execute on function public.claim_ocr_runs(int) to service_role;

-- Re-OCR a CI file (worker / SQL Editor only)
create or replace function public.requeue_ci_ocr(p_ci_document_id bigint)
returns bigint language sql security definer set search_path = public as $$
  insert into ocr_runs (ci_document_id) values (p_ci_document_id) returning id;
$$;
revoke execute on function public.requeue_ci_ocr(bigint) from public, anon, authenticated;
grant execute on function public.requeue_ci_ocr(bigint) to service_role;

-- Same columns as before + ci_document_id at the end
create or replace view public.ocr_run_text with (security_invoker = true) as
select r.id as run_id, r.document_id,
       coalesce(d.application_id, a.application_id) as application_id,
       coalesce(d.document_type, 'CI_' || cd.check_type::text) as document_type,
       coalesce(d.file_name, cd.file_name) as file_name,
       r.status, r.engine, r.finished_at, r.error,
       count(l.id) as line_count,
       round(avg(l.confidence), 4) as avg_confidence,
       string_agg(l.text, E'\n' order by l.page_no, l.line_no) as full_text,
       r.ci_document_id
from ocr_runs r
left join documents d on d.id = r.document_id
left join ci_documents cd on cd.id = r.ci_document_id
left join applicants a on a.id = cd.applicant_id
left join ocr_lines l on l.run_id = r.id
group by r.id, d.id, cd.id, a.id;

drop policy if exists "staff reads ocr runs" on public.ocr_runs;
create policy "staff reads ocr runs" on public.ocr_runs
  for select to authenticated
  using (public.staff_can_access(coalesce(
    (select application_id from public.documents where id = document_id),
    (select a.application_id from public.ci_documents cd join public.applicants a on a.id = cd.applicant_id
     where cd.id = ci_document_id))));
