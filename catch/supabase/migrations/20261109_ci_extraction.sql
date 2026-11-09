-- CATCH — AI extraction of CI reports: NFIS results and TransUnion (TU) credit reports (BPMN CI lane, HITL)
-- Run after 20261109_ai_extraction.sql. Re-runnable, no drops of data.
--
-- Decided with Josh (2026-11-09):
--   * Same pipeline as the application documents: PaddleOCR lines -> Gemini labels them into fields -> staging
--     (extraction_runs / extraction_fields) -> a person checks every value next to the document and confirms.
--     The model never sees the file. BRAS is not extracted yet (no field list, no template).
--   * Who confirms: any active Credit Investigator (ci_can_edit, same rule as the CI results), while the
--     application is in Credit Investigation. Everyone with access to the file can view the extraction.
--   * The AI also proposes the CI result for that borrower x check (No adverse findings / With findings) and a
--     short summary of the findings. The CI edits both and confirms; only then are they written to ci_checks
--     (the same row the CI page saves with save_ci_findings). Nothing is saved without that step.
--   * CI extractions never write to the application record. Name, birth date, gender, civil status, dependents,
--     address, IDs and accounts are compared with the application on the page (P2 / P3), for the CI to judge.
--   * The applicant sees none of it (staff_can_access, as for the CI files).
--
-- Field lists can now have several row lists per document (TU: IDs, addresses, employers, accounts, inquiries):
-- extraction_field_defs.row_group. Existing ROW fields are in group 'rows'. item_no counts 1..n per group.
--
-- Re-runs of earlier files:
--   * 20261109_ai_extraction.sql re-run -> its queue / claim / save / audit functions go back to application
--     documents only: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.extraction_field_defs') is null or to_regclass('public.ci_documents') is null then
    raise exception 'Run 20261108_ci_results.sql and 20261109_ai_extraction.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. Field definitions: row groups, plain numbers, more comparisons
-- ============================================================
alter table public.extraction_field_defs add column if not exists row_group text;
update public.extraction_field_defs set row_group = 'rows' where scope = 'ROW' and row_group is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'extraction_field_defs_row_group_check') then
    alter table public.extraction_field_defs add constraint extraction_field_defs_row_group_check
      check (row_group is null or (scope = 'ROW' and row_group ~ '^[a-z_]+$'));
  end if;
end $$;

-- NUMBER = a plain number kept as printed (counts, scores, probabilities); AMOUNT rounds to centavos
alter table public.extraction_field_defs drop constraint if exists extraction_field_defs_data_type_check;
alter table public.extraction_field_defs add constraint extraction_field_defs_data_type_check
  check (data_type in ('TEXT', 'DATE', 'MONTH', 'AMOUNT', 'NUMBER', 'SEX'));

-- What the page compares a value with (from the borrower's record or the loan), without writing to it
alter table public.extraction_field_defs drop constraint if exists extraction_field_defs_compare_with_check;
alter table public.extraction_field_defs add constraint extraction_field_defs_compare_with_check
  check (compare_with in ('FULL_NAME', 'PRESENT_ADDRESS', 'DATE_OF_BIRTH', 'SEX', 'CIVIL_STATUS', 'DEPENDENTS',
                          'LOAN_AMOUNT'));

insert into public.extraction_field_defs
  (document_type, field_key, label, scope, data_type, hint, compare_with, row_group, sort_order)
values
  -- NFIS result
  ('CI_NFIS', 'result_text', 'Result', 'HEADER', 'TEXT', 'The Result(s) section as printed: "No Adverse Findings", or every finding listed, on one line', null, null, 10),
  ('CI_NFIS', 'nfis_class', 'Class', 'HEADER', 'TEXT', 'e.g. Class B', null, null, 20),
  ('CI_NFIS', 'requested_by', 'Requested by', 'HEADER', 'TEXT', null, null, null, 30),
  ('CI_NFIS', 'date_requested', 'Date requested', 'HEADER', 'DATE', 'Printed as MM/DD/YY', null, null, 40),
  ('CI_NFIS', 'date_reported', 'Date reported', 'HEADER', 'DATE', 'Printed as MM/DD/YY', null, null, 50),
  ('CI_NFIS', 'subject_name', 'Name searched', 'HEADER', 'TEXT', 'Request key "Name", as printed', 'FULL_NAME', null, 60),
  ('CI_NFIS', 'birthdate', 'Birthdate searched', 'HEADER', 'DATE', 'Request key "Birthdate" (printed YYYYMMDD)', 'DATE_OF_BIRTH', null, 70),
  ('CI_NFIS', 'spouse_name', 'Spouse searched', 'HEADER', 'TEXT', 'Request key "Spouse", if filled in', null, null, 80),
  ('CI_NFIS', 'bank', 'Bank / branch', 'HEADER', 'TEXT', 'Request keys "Bank" and "Branch"', null, null, 90),
  ('CI_NFIS', 'address', 'Address searched', 'HEADER', 'TEXT', 'Request key "Address", on one line', 'PRESENT_ADDRESS', null, 100),
  -- TU credit report: subject and inquiry
  ('CI_TU', 'report_date', 'Report date', 'HEADER', 'DATE', 'Date printed next to the name at the top', null, null, 10),
  ('CI_TU', 'subject_name', 'Name', 'HEADER', 'TEXT', 'Name under Personal Information', 'FULL_NAME', null, 20),
  ('CI_TU', 'date_of_birth', 'Date of birth', 'HEADER', 'DATE', null, 'DATE_OF_BIRTH', null, 30),
  ('CI_TU', 'sex', 'Gender', 'HEADER', 'SEX', null, 'SEX', null, 40),
  ('CI_TU', 'civil_status', 'Civil status', 'HEADER', 'TEXT', 'As printed, e.g. SINGLE, MARRIED, WIDOWED, SEPARATED', 'CIVIL_STATUS', null, 50),
  ('CI_TU', 'dependents', 'No. of dependents', 'HEADER', 'NUMBER', null, 'DEPENDENTS', null, 60),
  ('CI_TU', 'mothers_maiden_name', 'Mother''s maiden name', 'HEADER', 'TEXT', 'Mother''s Maiden Full Name under Personal Information', null, null, 70),
  ('CI_TU', 'nationality', 'Nationality', 'HEADER', 'TEXT', null, null, null, 80),
  ('CI_TU', 'alias_names', 'Alias names', 'HEADER', 'TEXT', 'Every name under Alias Name Information, separated by "; "', null, null, 90),
  ('CI_TU', 'inquiry_purpose', 'Inquiry purpose', 'HEADER', 'TEXT', 'Inquiry Purpose at the top (this request)', null, null, 100),
  ('CI_TU', 'inquiry_account_type', 'Inquiry account type', 'HEADER', 'TEXT', 'Inquiry Account Type at the top (this request)', null, null, 110),
  ('CI_TU', 'inquiry_amount', 'Inquiry amount', 'HEADER', 'AMOUNT', 'Inquiry Amount at the top (this request)', 'LOAN_AMOUNT', null, 120),
  -- TU: summary and exposure
  ('CI_TU', 'open_accounts', 'Open accounts', 'HEADER', 'NUMBER', 'Summary: Open Account', null, null, 200),
  ('CI_TU', 'closed_accounts', 'Closed accounts', 'HEADER', 'NUMBER', 'Summary: Closed Account', null, null, 210),
  ('CI_TU', 'previous_inquiries', 'Previous inquiries', 'HEADER', 'NUMBER', 'Summary: Previous Enquiry', null, null, 220),
  ('CI_TU', 'revolving_credit_limit', 'Credit limit (revolving)', 'HEADER', 'AMOUNT', 'Revolving Credits: Total Credit Limit', null, null, 230),
  ('CI_TU', 'revolving_used_limit', 'Used credit limit (revolving)', 'HEADER', 'AMOUNT', 'Revolving Credits: Total Used Credit Limit', null, null, 240),
  ('CI_TU', 'revolving_past_due', 'Past due (revolving)', 'HEADER', 'AMOUNT', 'Revolving Credits: Total Past Due Amount', null, null, 250),
  ('CI_TU', 'terms_loan_amount', 'Total loan amount (terms)', 'HEADER', 'AMOUNT', 'Terms & Other Credits: Total Loan Amount', null, null, 260),
  ('CI_TU', 'terms_balance', 'Current balance (terms)', 'HEADER', 'AMOUNT', 'Terms & Other Credits: Total Current Balance', null, null, 270),
  ('CI_TU', 'terms_installment', 'Monthly installments (terms)', 'HEADER', 'AMOUNT', 'Terms & Other Credits: Total Installment Amount', null, null, 280),
  ('CI_TU', 'terms_past_due', 'Past due (terms)', 'HEADER', 'AMOUNT', 'Terms & Other Credits: Total Past Due Amount', null, null, 290),
  -- TU: score
  ('CI_TU', 'score', 'Credit score', 'HEADER', 'NUMBER', 'Score section: Score', null, null, 300),
  ('CI_TU', 'risk_grade', 'Risk grade', 'HEADER', 'TEXT', 'Score section: Risk Grade', null, null, 310),
  ('CI_TU', 'predicted_probability', 'Predicted probability', 'HEADER', 'NUMBER', 'Score section: Predicted Probability, all decimals as printed', null, null, 320),
  -- TU: bureau credit characteristics (BCC)
  ('CI_TU', 'bcc_address_match', 'Inquiry address matches a reported address', 'HEADER', 'TEXT', 'BCC0001 value (Y or N)', null, null, 400),
  ('CI_TU', 'bcc_fraud_address', 'Address linked to a fraud-blocked account', 'HEADER', 'TEXT', 'BCC0009 value as printed (-999 = no record)', null, null, 410),
  ('CI_TU', 'bcc_fraud_phone', 'Phone linked to a fraud-blocked account', 'HEADER', 'TEXT', 'BCC0010 value as printed (-999 = no record)', null, null, 420),
  ('CI_TU', 'bcc_never_paid', 'Never-paid flag', 'HEADER', 'TEXT', 'BCC0273 value (Y or N)', null, null, 430),
  ('CI_TU', 'bcc_accounts_opened_6m', 'Accounts opened, last 6 months', 'HEADER', 'NUMBER', 'BCC0076 value', null, null, 440),
  ('CI_TU', 'bcc_applications_6m', 'New applications, last 6 months', 'HEADER', 'NUMBER', 'BCC0084 value', null, null, 450),
  ('CI_TU', 'bcc_dpd30_12m', 'Times 30-59 days past due, last 12 months', 'HEADER', 'NUMBER', 'BCC0250 value (revolving accounts)', null, null, 460),
  ('CI_TU', 'bcc_dpd60_12m', 'Times 60+ days past due, last 12 months', 'HEADER', 'NUMBER', 'BCC0251 value (revolving accounts)', null, null, 470),
  -- TU rows: IDs
  ('CI_TU', 'id_type', 'ID type', 'ROW', 'TEXT', 'As printed, e.g. TIN, SSS, PP (passport), GSIS, UMID, OTHER ID', null, 'ids', 500),
  ('CI_TU', 'id_number', 'ID number', 'ROW', 'TEXT', 'Exactly as printed', null, 'ids', 510),
  -- TU rows: addresses
  ('CI_TU', 'address', 'Address', 'ROW', 'TEXT', 'On one line', null, 'addresses', 600),
  ('CI_TU', 'address_type', 'Type', 'ROW', 'TEXT', 'e.g. HOME, BILLING ADDRESS, OFFICE', null, 'addresses', 610),
  ('CI_TU', 'address_since', 'File since', 'ROW', 'DATE', null, null, 'addresses', 620),
  ('CI_TU', 'address_last_reported', 'Last reported', 'ROW', 'DATE', null, null, 'addresses', 630),
  -- TU rows: employment
  ('CI_TU', 'employer_name', 'Employer', 'ROW', 'TEXT', null, null, 'employers', 700),
  ('CI_TU', 'employer_occupation', 'Occupation', 'ROW', 'TEXT', null, null, 'employers', 710),
  ('CI_TU', 'employer_tenure', 'Length of employment', 'ROW', 'TEXT', 'As printed, e.g. 6 YEAR(S) 10 MONTHS', null, 'employers', 720),
  ('CI_TU', 'employer_annual_income', 'Annual income', 'ROW', 'AMOUNT', 'Consumer Annual Income', null, 'employers', 730),
  ('CI_TU', 'employer_since', 'File since', 'ROW', 'DATE', null, null, 'employers', 740),
  ('CI_TU', 'employer_last_reported', 'Last reported', 'ROW', 'DATE', null, null, 'employers', 750),
  -- TU rows: accounts (open and closed)
  ('CI_TU', 'acct_section', 'Open / closed', 'ROW', 'TEXT', 'OPEN or CLOSED, from the section heading (OPEN ACCOUNTS / CLOSED ACCOUNTS)', null, 'accounts', 800),
  ('CI_TU', 'acct_lender', 'Lender type', 'ROW', 'TEXT', 'Member type printed above the account, e.g. BANK, FINANCING', null, 'accounts', 810),
  ('CI_TU', 'acct_type', 'Account type', 'ROW', 'TEXT', 'e.g. CREDIT CARD, PERSONAL LOAN, INSTALLMENT LOAN - APPLIANCE/GADGET', null, 'accounts', 820),
  ('CI_TU', 'acct_status', 'Status', 'ROW', 'TEXT', 'Account Status as printed, e.g. A, CLOSED', null, 'accounts', 830),
  ('CI_TU', 'acct_opened', 'Opened', 'ROW', 'DATE', null, null, 'accounts', 840),
  ('CI_TU', 'acct_closed', 'Closed', 'ROW', 'DATE', 'Empty if printed as "-"', null, 'accounts', 850),
  ('CI_TU', 'acct_credit_limit', 'Credit limit', 'ROW', 'AMOUNT', 'Only if printed for this account', null, 'accounts', 860),
  ('CI_TU', 'acct_balance', 'Outstanding balance', 'ROW', 'AMOUNT', null, null, 'accounts', 870),
  ('CI_TU', 'acct_past_due', 'Past due', 'ROW', 'AMOUNT', 'Past Due Amount (current)', null, 'accounts', 880),
  ('CI_TU', 'acct_installment', 'Monthly installment', 'ROW', 'AMOUNT', 'Installment Amount (loans); for cards, the Payment Amount', null, 'accounts', 890),
  ('CI_TU', 'acct_max_dpd', 'Max days past due', 'ROW', 'NUMBER', 'Maximum Days Past Due; empty if blank', null, 'accounts', 900),
  ('CI_TU', 'acct_max_dpd_date', 'Max days past due on', 'ROW', 'DATE', 'Maximum Days Past Due Date; empty if "-"', null, 'accounts', 910),
  ('CI_TU', 'acct_late_months', 'Late months', 'ROW', 'TEXT', 'Months in the Two-Year Payment History whose value is above 000, as YYYY-MM: days, separated by "; ". Empty if none', null, 'accounts', 920),
  ('CI_TU', 'acct_legal_action', 'Legal action', 'ROW', 'TEXT', 'Y or N', null, 'accounts', 930),
  -- TU rows: previous inquiries
  ('CI_TU', 'inq_member', 'Member', 'ROW', 'TEXT', 'Member Short Name', null, 'inquiries', 1000),
  ('CI_TU', 'inq_date', 'Date', 'ROW', 'DATE', null, null, 'inquiries', 1010),
  ('CI_TU', 'inq_account_type', 'Account type', 'ROW', 'TEXT', null, null, 'inquiries', 1020),
  ('CI_TU', 'inq_amount', 'Amount', 'ROW', 'AMOUNT', null, null, 'inquiries', 1030),
  ('CI_TU', 'inq_purpose', 'Purpose', 'ROW', 'TEXT', null, null, 'inquiries', 1040)
on conflict (document_type, field_key) do update set
  label = excluded.label, scope = excluded.scope, data_type = excluded.data_type, hint = excluded.hint,
  target_table = null, target_column = null, compare_with = excluded.compare_with,
  row_group = excluded.row_group, sort_order = excluded.sort_order;

-- ============================================================
-- 2. Helpers: where an OCR run's file comes from (application document or CI file)
-- ============================================================
create or replace function public.extraction_source(p_ocr_run_id bigint)
returns table (application_id bigint, applicant_id bigint, document_type text, file_name text,
               document_id bigint, ci_document_id bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(d.application_id, a.application_id), coalesce(d.applicant_id, cd.applicant_id),
         coalesce(d.document_type, 'CI_' || cd.check_type::text), coalesce(d.file_name, cd.file_name),
         o.document_id, o.ci_document_id
  from ocr_runs o
  left join documents d on d.id = o.document_id
  left join ci_documents cd on cd.id = o.ci_document_id
  left join applicants a on a.id = cd.applicant_id
  where o.id = p_ocr_run_id;
$$;

-- A confirmed extraction locks its document / CI file: later OCR runs aren't re-extracted
create or replace function public.extraction_locked(p_document_id bigint, p_ci_document_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
                 where e.confirmed_at is not null
                   and (o.document_id = p_document_id or o.ci_document_id = p_ci_document_id));
$$;

-- Same checks as confirm_extraction(): returns the value cleaned up, or raises a readable error
create or replace function public.extraction_check_value(p_data_type text, p_label text, p_value text)
returns text language plpgsql stable set search_path = public as $$
declare
  v text := nullif(btrim(p_value), '');
begin
  if v is null then return null; end if;
  begin
    case p_data_type
      -- Postgres date input is lenient (it reads '08-JAN-2026x'), so the format is checked first
      when 'DATE' then
        if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'date'; end if;
        v := v::date::text;
      when 'MONTH' then
        if v !~ '^\d{4}-\d{2}$' then raise exception 'month'; end if;
        v := to_char((v || '-01')::date, 'YYYY-MM');
      when 'AMOUNT' then v := round(replace(v, ',', '')::numeric, 2)::text;
      when 'NUMBER' then
        v := replace(v, ',', '')::numeric::text;
        if v = 'NaN' then raise exception 'number'; end if;
      when 'SEX' then
        v := upper(v);
        if v not in ('MALE', 'FEMALE') then raise exception 'sex'; end if;
      else null;
    end case;
  exception when others then
    raise exception '%: "%" is not a valid %.', p_label, p_value,
      case p_data_type when 'DATE' then 'date (YYYY-MM-DD)' when 'MONTH' then 'month (YYYY-MM)'
           when 'AMOUNT' then 'amount' when 'NUMBER' then 'number' when 'SEX' then 'sex (Male or Female)'
           else 'value' end;
  end;
  return v;
end $$;

revoke execute on function public.extraction_source(bigint) from public, anon, authenticated;
revoke execute on function public.extraction_locked(bigint, bigint) from public, anon, authenticated;

-- Read policy on extraction_runs uses this: now CI files too
create or replace function public.extraction_application(p_run_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select s.application_id from extraction_runs e cross join lateral extraction_source(e.ocr_run_id) s
  where e.id = p_run_id;
$$;

-- ============================================================
-- 3. Queue and worker: CI files (NFIS, TU) go through the same AI queue
-- ============================================================
create or replace function public.queue_extraction_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'DONE' and old.status is distinct from 'DONE'
     and (select document_type from extraction_source(new.id)) = any (extraction_document_types())
     and not extraction_locked(new.document_id, new.ci_document_id) then
    insert into extraction_runs (ocr_run_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- Backfill: latest finished OCR run of each NFIS / TU file that has never been extracted
insert into public.extraction_runs (ocr_run_id)
select distinct on (o.ci_document_id) o.id
from public.ocr_runs o
join public.ci_documents cd on cd.id = o.ci_document_id
where o.status = 'DONE'
  and 'CI_' || cd.check_type::text = any (public.extraction_document_types())
  and not exists (select 1 from public.extraction_runs e join public.ocr_runs o2 on o2.id = e.ocr_run_id
                  where o2.ci_document_id = o.ci_document_id)
order by o.ci_document_id, o.id desc;

create or replace function public.claim_extraction_runs(p_limit int default 1)
returns table (run_id bigint, ocr_run_id bigint, document_type text, file_name text)
language plpgsql security definer set search_path = public as $$
begin
  update extraction_runs set status = 'PENDING', started_at = null
  where status = 'RUNNING' and started_at < now() - interval '15 minutes';

  return query
  with picked as (
    select e.id from extraction_runs e
    where e.status = 'PENDING'
    order by e.created_at
    limit p_limit
    for update skip locked),
  claimed as (
    update extraction_runs e set status = 'RUNNING', started_at = now()
    from picked where e.id = picked.id
    returning e.id as eid, e.ocr_run_id as oid)
  select c.eid, c.oid, s.document_type, s.file_name
  from claimed c cross join lateral extraction_source(c.oid) s;
end $$;

-- p_fields: [{"key": "...", "item_no": 0, "value": "..." | null, "line_ids": [ocr_lines.id, ...]}]
create or replace function public.save_extraction(p_run_id bigint, p_model text, p_output jsonb, p_fields jsonb,
                                                  p_input_tokens int default null, p_output_tokens int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_ocr_run bigint;
  f jsonb;
  v_field_id bigint;
begin
  select ocr_run_id into v_ocr_run from extraction_runs where id = p_run_id and status = 'RUNNING' for update;
  if not found then raise exception 'Extraction run % is not running', p_run_id; end if;
  select document_type into v_type from extraction_source(v_ocr_run);

  for f in select * from jsonb_array_elements(coalesce(p_fields, '[]')) loop
    if not exists (select 1 from extraction_field_defs
                   where document_type = v_type and field_key = f->>'key'
                     and (scope = 'HEADER') = (coalesce((f->>'item_no')::int, 0) = 0)) then
      raise exception 'Unknown field % for %', f->>'key', v_type;
    end if;
    insert into extraction_fields (run_id, field_key, item_no, extracted_value)
    values (p_run_id, f->>'key', coalesce((f->>'item_no')::int, 0), nullif(btrim(f->>'value'), ''))
    returning id into v_field_id;
    -- only lines of this OCR run
    insert into extraction_field_lines (field_id, line_id)
    select distinct v_field_id, l.id
    from jsonb_array_elements_text(coalesce(f->'line_ids', '[]')) x (line_id)
    join ocr_lines l on l.id = x.line_id::bigint and l.run_id = v_ocr_run;
  end loop;

  update extraction_runs
  set status = 'DONE', model = p_model, output = p_output, input_tokens = p_input_tokens,
      output_tokens = p_output_tokens, finished_at = now(), error = null
  where id = p_run_id;
end $$;

revoke execute on function public.claim_extraction_runs(int) from public, anon, authenticated;
revoke execute on function public.save_extraction(bigint, text, jsonb, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.claim_extraction_runs(int) to service_role;
grant execute on function public.save_extraction(bigint, text, jsonb, jsonb, int, int) to service_role;

-- ============================================================
-- 4. Credit Investigator actions
-- ============================================================
create or replace function public.ci_extraction_refuse() returns void language plpgsql as $$
begin
  raise exception 'Only a Credit Investigator can do this, while the application is in Credit Investigation.';
end $$;
revoke execute on function public.ci_extraction_refuse() from public, anon, authenticated;

-- Run the AI again on a CI file's latest OCR (e.g. after a failure). Not after it was confirmed.
create or replace function public.request_ci_extraction(p_ci_document_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_doc ci_documents;
  v_app bigint;
  v_ocr bigint;
  v_id bigint;
begin
  select * into v_doc from ci_documents where id = p_ci_document_id;
  if not found then raise exception 'File not found.'; end if;
  v_app := ci_borrower_application(v_doc.applicant_id);
  if v_app is null or not ci_can_edit(v_app) then perform ci_extraction_refuse(); end if;
  if not ('CI_' || v_doc.check_type::text) = any (extraction_document_types()) then
    raise exception 'There is no AI extraction for % reports yet.', v_doc.check_type;
  end if;
  if extraction_locked(null, p_ci_document_id) then
    raise exception 'This report was already confirmed and is locked. Upload it again to check it again.';
  end if;
  select id into v_ocr from ocr_runs where ci_document_id = p_ci_document_id and status = 'DONE' order by id desc limit 1;
  if v_ocr is null then raise exception 'The report has not been read (OCR) yet.'; end if;
  if exists (select 1 from extraction_runs where ocr_run_id = v_ocr and status in ('PENDING', 'RUNNING')) then
    raise exception 'The extraction is already running.';
  end if;
  insert into extraction_runs (ocr_run_id, requested_by) values (v_ocr, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Confirm & lock a CI report's extraction, and save the CI result + summary for that borrower x check.
-- p_fields must list every field of the run once: [{"id": extraction_fields.id, "final_value": "..." | null}]
-- p_result: NO_ADVERSE_FINDINGS | WITH_FINDINGS (required); p_summary: required with findings.
-- Writes ci_checks (audited by its trigger), never the application record.
create or replace function public.confirm_ci_extraction(p_run_id bigint, p_fields jsonb, p_result text,
                                                        p_summary text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_run extraction_runs;
  v_doc ci_documents;
  v_app bigint;
  v_type text;
  v_def extraction_field_defs;
  v_field extraction_fields;
  f jsonb;
  v_result ci_check_result;
  v_summary text := nullif(btrim(p_summary), '');
begin
  select * into v_run from extraction_runs where id = p_run_id for update;
  if not found then raise exception 'Extraction not found.'; end if;
  select cd.* into v_doc from ocr_runs o join ci_documents cd on cd.id = o.ci_document_id where o.id = v_run.ocr_run_id;
  v_app := ci_borrower_application(v_doc.applicant_id);
  if v_doc.id is null or v_app is null or not ci_can_edit(v_app) then perform ci_extraction_refuse(); end if;
  perform 1 from loan_applications where id = v_app for update;  -- same lock as the other CI writes
  v_type := 'CI_' || v_doc.check_type::text;

  if v_run.status <> 'DONE' then raise exception 'The extraction has not finished.'; end if;
  if extraction_locked(null, v_doc.id) then raise exception 'This report was already confirmed and is locked.'; end if;
  if exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
             where o.ci_document_id = v_doc.id and e.id > p_run_id) then
    raise exception 'A newer extraction exists for this report. Reload the page.';
  end if;

  begin
    v_result := nullif(btrim(p_result), '')::ci_check_result;
  exception when others then
    v_result := null;
  end;
  if v_result is null then raise exception 'Pick the result: No adverse findings or With findings.'; end if;
  if v_result = 'WITH_FINDINGS' and v_summary is null then
    raise exception 'Write a summary of the findings.';
  end if;
  if length(v_summary) > 4000 then raise exception 'The summary is too long (4,000 characters at most).'; end if;

  if jsonb_typeof(p_fields) is distinct from 'array'
     or jsonb_array_length(p_fields) <> (select count(*) from extraction_fields where run_id = p_run_id)
     or (select count(distinct x->>'id') from jsonb_array_elements(p_fields) x) <> jsonb_array_length(p_fields) then
    raise exception 'Send every field of the extraction exactly once.';
  end if;

  for f in select * from jsonb_array_elements(p_fields) loop
    select * into v_field from extraction_fields where id = (f->>'id')::bigint and run_id = p_run_id;
    if not found then raise exception 'Field % is not part of this extraction.', f->>'id'; end if;
    select * into v_def from extraction_field_defs where document_type = v_type and field_key = v_field.field_key;
    update extraction_fields
    set final_value = extraction_check_value(v_def.data_type, coalesce(v_def.label, v_field.field_key), f->>'final_value'),
        apply_to_record = null
    where id = v_field.id;
  end loop;

  -- The CI result for this borrower x check (the row exists since the upload; unchanged rows aren't touched)
  insert into ci_checks (applicant_id, check_type, result, summary)
  values (v_doc.applicant_id, v_doc.check_type, v_result, v_summary)
  on conflict (applicant_id, check_type) do update
    set result = excluded.result, summary = excluded.summary
    where (ci_checks.result, ci_checks.summary) is distinct from (excluded.result, excluded.summary);

  update extraction_runs set confirmed_by = auth.uid(), confirmed_at = now() where id = p_run_id;
  perform ci_mark_started(v_app);
end $$;

revoke execute on function public.request_ci_extraction(bigint) from public, anon;
revoke execute on function public.confirm_ci_extraction(bigint, jsonb, text, text) from public, anon;
grant execute on function public.request_ci_extraction(bigint) to authenticated;
grant execute on function public.confirm_ci_extraction(bigint, jsonb, text, text) to authenticated;

-- ============================================================
-- 5. Audit trail: agent runs and confirmations, for CI files too
-- ============================================================
create or replace function public.log_extraction_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_check ci_checks;
  v_new jsonb;
begin
  select * into s from extraction_source(new.ocr_run_id);
  if s.application_id is null then return null; end if;

  if new.confirmed_at is not null and old.confirmed_at is null then
    v_new := jsonb_build_object(
      'document', s.file_name, 'confirmed_by', new.confirmed_by,
      'fields', (select count(*) from extraction_fields where run_id = new.id),
      'corrected', (select count(*) from extraction_fields
                    where run_id = new.id and final_value is distinct from extracted_value));
    if s.ci_document_id is null then
      v_new := v_new || jsonb_build_object('copied_to_application',
        (select count(*) from extraction_fields where run_id = new.id and apply_to_record));
    else
      -- what the AI proposed vs what the Credit Investigator saved
      select c.* into v_check from ci_checks c join ci_documents cd
        on cd.applicant_id = c.applicant_id and cd.check_type = c.check_type
      where cd.id = s.ci_document_id;
      v_new := v_new || jsonb_build_object(
        'proposed_result', new.output->>'proposed_result',
        'result', v_check.result,
        'summary_edited', v_check.summary is distinct from nullif(btrim(new.output->>'findings_summary'), ''));
    end if;
  elsif new.status is distinct from old.status and new.status in ('DONE', 'FAILED') then
    v_new := jsonb_build_object('document', s.file_name, 'status', new.status, 'model', new.model,
                                'fields', (select count(*) from extraction_fields where run_id = new.id),
                                'proposed_result', new.output->>'proposed_result',
                                'error', new.error);
  else
    return null;
  end if;

  insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (s.application_id, 'extraction_runs', new.id, 'UPDATE', null, jsonb_strip_nulls(v_new), auth.uid());
  return null;
end $$;
