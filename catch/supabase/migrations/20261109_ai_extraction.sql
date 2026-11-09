-- CATCH — AI field extraction from OCR text + AO confirmation (Module 1, HITL)
-- Run after 20261108_reviewer_signoff.sql (needs the OCR, CI results and KYC verification migrations).
-- Re-runnable, no drops of data.
--
-- Decided with Josh (2026-11-09):
--   * The LLM (Gemini, called by the ocr-service worker) never sees the file. It reads the PaddleOCR lines
--     already saved in ocr_lines and labels them into fields. Cheaper, and the OCR step stays the only reader.
--   * Documents: Valid ID / Passport, COE / ITR, Payslips / remittances, Bank statements.
--   * Every AI value is a proposal in a staging table (extraction_fields). The assigned AO checks each field
--     side by side with the document, corrects it if needed and, where it differs from what the applicant
--     typed, picks per field: keep the application value or update the application to the document value.
--     "Confirm & lock" (confirm_extraction) writes the picked values to the record (audited by the existing
--     triggers) and locks the extraction. Nothing reaches the application record without that step.
--
-- Flow: upload -> ocr_runs PENDING -> worker OCRs (ocr_lines + ocr_pages) -> OCR DONE queues an
-- extraction_runs row (trigger) -> worker claims it, sends the lines to Gemini, saves the fields with
-- save_extraction() -> AO confirms on /documentCheckPage.
--
-- Re-runs of earlier files:
--   * 20261007_id_ocr.sql or 20261010_ocr_income_docs.sql re-run -> ocr_document_types() loses bank
--     statements: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.ocr_runs', '20261007_id_ocr.sql'),
               ('public.audit_log', '20261007_ao_kyc_verification.sql'),
               ('public.ci_documents', '20261108_ci_results.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. OCR page sizes (to draw where a value was read on the page)
-- ============================================================
-- Pixel size of the page image PaddleOCR read (PDF pages are rendered at 2x). ocr_lines.bbox is in these
-- pixels, so the viewer turns boxes into percentages. angle = rotation PaddleOCR applied (0/90/180/270);
-- boxes are drawn only when it is 0. Runs from before this migration have no rows here.
create table if not exists public.ocr_pages (
  run_id bigint not null references public.ocr_runs(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  width int not null check (width > 0),
  height int not null check (height > 0),
  angle int not null default 0,
  primary key (run_id, page_no)
);

-- Bank statements are OCR'd too now
create or replace function public.ocr_document_types()
returns text[] language sql immutable as $$
  select array['VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS'];
$$;

insert into public.ocr_runs (document_id)
select d.id from public.documents d
where d.document_type = any (public.ocr_document_types())
  and not exists (select 1 from public.ocr_runs r where r.document_id = d.id);

-- ============================================================
-- 2. Which fields to extract, per document type (single source for the worker, the page and confirm)
-- ============================================================
-- scope HEADER = one value per document; ROW = repeated (one per pay period / statement month).
-- target_table/target_column = the application column the AO may update from this field (whitelisted below).
-- compare_with = a value the page derives from the record to compare against, when there is no single column.
create table if not exists public.extraction_field_defs (
  document_type text not null,
  field_key text not null,
  label text not null,
  scope text not null check (scope in ('HEADER', 'ROW')),
  data_type text not null check (data_type in ('TEXT', 'DATE', 'MONTH', 'AMOUNT', 'SEX')),
  hint text,                  -- what the LLM should put here
  target_table text,
  target_column text,
  compare_with text check (compare_with in ('FULL_NAME', 'PRESENT_ADDRESS')),
  sort_order int not null,
  primary key (document_type, field_key),
  check ((target_table is null) = (target_column is null)),
  check (target_table is null or scope = 'HEADER'),
  check ((target_table, target_column) in (
    ('applicants', 'last_name'), ('applicants', 'first_name'), ('applicants', 'middle_name'),
    ('applicants', 'name_extension'), ('applicants', 'date_of_birth'), ('applicants', 'gender'),
    ('applicants', 'birth_place'), ('applicants', 'citizenship'), ('applicants', 'tin'), ('applicants', 'sss_no'),
    ('employment_info', 'employer_business_name'), ('employment_info', 'occupation'),
    ('employment_info', 'employment_date'), ('employment_info', 'employer_tin'),
    ('employment_info', 'gross_monthly_income'))
    or target_table is null)
);

insert into public.extraction_field_defs
  (document_type, field_key, label, scope, data_type, hint, target_table, target_column, compare_with, sort_order)
values
  -- Valid ID / Passport
  ('VALID_ID_PASSPORT', 'id_type', 'ID type', 'HEADER', 'TEXT', 'Kind of ID as printed, e.g. Passport, Driver''s License, UMID, PhilSys ID, PRC ID, Postal ID', null, null, null, 10),
  ('VALID_ID_PASSPORT', 'id_number', 'ID number', 'HEADER', 'TEXT', 'The ID / passport / license number, exactly as printed', null, null, null, 20),
  ('VALID_ID_PASSPORT', 'last_name', 'Last name', 'HEADER', 'TEXT', 'Surname', 'applicants', 'last_name', null, 30),
  ('VALID_ID_PASSPORT', 'first_name', 'First name', 'HEADER', 'TEXT', 'All given names', 'applicants', 'first_name', null, 40),
  ('VALID_ID_PASSPORT', 'middle_name', 'Middle name', 'HEADER', 'TEXT', 'Middle name (mother''s maiden surname)', 'applicants', 'middle_name', null, 50),
  ('VALID_ID_PASSPORT', 'name_extension', 'Suffix', 'HEADER', 'TEXT', 'Jr., Sr., III, if printed', 'applicants', 'name_extension', null, 60),
  ('VALID_ID_PASSPORT', 'date_of_birth', 'Date of birth', 'HEADER', 'DATE', null, 'applicants', 'date_of_birth', null, 70),
  ('VALID_ID_PASSPORT', 'sex', 'Sex', 'HEADER', 'SEX', null, 'applicants', 'gender', null, 80),
  ('VALID_ID_PASSPORT', 'place_of_birth', 'Place of birth', 'HEADER', 'TEXT', null, 'applicants', 'birth_place', null, 90),
  ('VALID_ID_PASSPORT', 'nationality', 'Nationality', 'HEADER', 'TEXT', null, 'applicants', 'citizenship', null, 100),
  ('VALID_ID_PASSPORT', 'address', 'Address', 'HEADER', 'TEXT', 'Full address as printed, on one line', null, null, 'PRESENT_ADDRESS', 110),
  ('VALID_ID_PASSPORT', 'issue_date', 'Date of issue', 'HEADER', 'DATE', null, null, null, null, 120),
  ('VALID_ID_PASSPORT', 'expiry_date', 'Valid until', 'HEADER', 'DATE', 'Expiry / valid until date', null, null, null, 130),
  ('VALID_ID_PASSPORT', 'issuing_authority', 'Issued by', 'HEADER', 'TEXT', 'Issuing agency or authority', null, null, null, 140),
  -- COE / COEC / ITR
  ('COE_ITR', 'employee_name', 'Employee name', 'HEADER', 'TEXT', 'Full name of the employee, without Mr./Ms.', null, null, 'FULL_NAME', 10),
  ('COE_ITR', 'employer_name', 'Employer', 'HEADER', 'TEXT', 'Company name of the employer', 'employment_info', 'employer_business_name', null, 20),
  ('COE_ITR', 'employer_address', 'Employer address', 'HEADER', 'TEXT', null, null, null, null, 30),
  ('COE_ITR', 'employer_tin', 'Employer TIN', 'HEADER', 'TEXT', null, 'employment_info', 'employer_tin', null, 40),
  ('COE_ITR', 'employee_tin', 'Employee TIN', 'HEADER', 'TEXT', null, 'applicants', 'tin', null, 50),
  ('COE_ITR', 'position', 'Position', 'HEADER', 'TEXT', 'Job title', 'employment_info', 'occupation', null, 60),
  ('COE_ITR', 'employment_status', 'Employment status', 'HEADER', 'TEXT', 'e.g. Regular, Probationary, Contractual', null, null, null, 70),
  ('COE_ITR', 'date_hired', 'Date hired', 'HEADER', 'DATE', 'Start of employment ("employed since")', 'employment_info', 'employment_date', null, 80),
  ('COE_ITR', 'monthly_basic_salary', 'Monthly basic salary', 'HEADER', 'AMOUNT', null, null, null, null, 90),
  ('COE_ITR', 'monthly_gross_income', 'Monthly gross income', 'HEADER', 'AMOUNT', 'Regular monthly pay: basic plus fixed monthly allowances. Empty if the document gives no monthly figures', 'employment_info', 'gross_monthly_income', null, 100),
  ('COE_ITR', 'annual_compensation', 'Annual compensation', 'HEADER', 'AMOUNT', 'Total annual compensation (COE) or gross compensation income (ITR)', null, null, null, 110),
  ('COE_ITR', 'tax_year', 'Tax year', 'HEADER', 'TEXT', 'ITR only: the year covered', null, null, null, 120),
  ('COE_ITR', 'issue_date', 'Date issued', 'HEADER', 'DATE', 'Date the certificate was issued / signed', null, null, null, 130),
  ('COE_ITR', 'signatory', 'Signed by', 'HEADER', 'TEXT', 'Name and position of the signatory', null, null, null, 140),
  -- Payslips / remittances
  ('PAYSLIPS_REMITTANCES', 'employee_name', 'Employee / beneficiary', 'HEADER', 'TEXT', 'Employee on the payslips, or the beneficiary of the remittances', null, null, 'FULL_NAME', 10),
  ('PAYSLIPS_REMITTANCES', 'employer_name', 'Employer / sender', 'HEADER', 'TEXT', 'Employer on the payslips, or the remittance sender', 'employment_info', 'employer_business_name', null, 20),
  ('PAYSLIPS_REMITTANCES', 'position', 'Position', 'HEADER', 'TEXT', null, 'employment_info', 'occupation', null, 30),
  ('PAYSLIPS_REMITTANCES', 'employee_no', 'Employee no.', 'HEADER', 'TEXT', null, null, null, null, 40),
  ('PAYSLIPS_REMITTANCES', 'employee_tin', 'TIN', 'HEADER', 'TEXT', null, 'applicants', 'tin', null, 50),
  ('PAYSLIPS_REMITTANCES', 'sss_no', 'SSS no.', 'HEADER', 'TEXT', null, 'applicants', 'sss_no', null, 60),
  ('PAYSLIPS_REMITTANCES', 'period_start', 'Period from', 'ROW', 'DATE', 'Payslips: start of the pay period', null, null, null, 110),
  ('PAYSLIPS_REMITTANCES', 'period_end', 'Period to', 'ROW', 'DATE', 'Payslips: end of the pay period', null, null, null, 120),
  ('PAYSLIPS_REMITTANCES', 'pay_date', 'Pay / transfer date', 'ROW', 'DATE', 'Pay date, or the remittance date', null, null, null, 130),
  ('PAYSLIPS_REMITTANCES', 'basic_pay', 'Basic pay', 'ROW', 'AMOUNT', null, null, null, null, 140),
  ('PAYSLIPS_REMITTANCES', 'gross_pay', 'Gross pay', 'ROW', 'AMOUNT', 'Gross pay, or the remitted amount in pesos', null, null, null, 150),
  ('PAYSLIPS_REMITTANCES', 'total_deductions', 'Deductions', 'ROW', 'AMOUNT', null, null, null, null, 160),
  ('PAYSLIPS_REMITTANCES', 'net_pay', 'Net pay', 'ROW', 'AMOUNT', null, null, null, null, 170),
  ('PAYSLIPS_REMITTANCES', 'currency', 'Currency', 'ROW', 'TEXT', 'Currency of the amounts (PHP if pesos)', null, null, null, 180),
  -- Bank statements
  ('FS_BANK_STATEMENTS', 'bank_name', 'Bank', 'HEADER', 'TEXT', null, null, null, null, 10),
  ('FS_BANK_STATEMENTS', 'account_name', 'Account name', 'HEADER', 'TEXT', null, null, null, 'FULL_NAME', 20),
  ('FS_BANK_STATEMENTS', 'account_number', 'Account no.', 'HEADER', 'TEXT', null, null, null, null, 30),
  ('FS_BANK_STATEMENTS', 'account_type', 'Account type', 'HEADER', 'TEXT', 'e.g. Savings, Checking', null, null, null, 40),
  ('FS_BANK_STATEMENTS', 'currency', 'Currency', 'HEADER', 'TEXT', null, null, null, null, 50),
  ('FS_BANK_STATEMENTS', 'statement_from', 'Statement from', 'HEADER', 'DATE', 'First day covered by the statements', null, null, null, 60),
  ('FS_BANK_STATEMENTS', 'statement_to', 'Statement to', 'HEADER', 'DATE', 'Last day covered by the statements', null, null, null, 70),
  ('FS_BANK_STATEMENTS', 'month', 'Month', 'ROW', 'MONTH', 'One row per calendar month', null, null, null, 110),
  ('FS_BANK_STATEMENTS', 'opening_balance', 'Opening balance', 'ROW', 'AMOUNT', null, null, null, null, 120),
  ('FS_BANK_STATEMENTS', 'total_deposits', 'Deposits', 'ROW', 'AMOUNT', 'Total deposits / credits for the month', null, null, null, 130),
  ('FS_BANK_STATEMENTS', 'total_withdrawals', 'Withdrawals', 'ROW', 'AMOUNT', 'Total withdrawals / debits for the month', null, null, null, 140),
  ('FS_BANK_STATEMENTS', 'ending_balance', 'Ending balance', 'ROW', 'AMOUNT', null, null, null, null, 150),
  ('FS_BANK_STATEMENTS', 'average_daily_balance', 'Avg. daily balance', 'ROW', 'AMOUNT', 'Only if printed on the statement', null, null, null, 160)
on conflict (document_type, field_key) do update set
  label = excluded.label, scope = excluded.scope, data_type = excluded.data_type, hint = excluded.hint,
  target_table = excluded.target_table, target_column = excluded.target_column,
  compare_with = excluded.compare_with, sort_order = excluded.sort_order;

create or replace function public.extraction_document_types()
returns text[] language sql stable as $$
  select coalesce(array_agg(distinct document_type), '{}') from extraction_field_defs;
$$;

-- ============================================================
-- 3. Staging: extraction runs and their proposed fields
-- ============================================================
-- One row per AI attempt on one OCR run. output = the model's raw answer (kept for the audit trail;
-- the page reads document_kind and issues from it). requested_by null = queued automatically after OCR.
create table if not exists public.extraction_runs (
  id bigint generated always as identity primary key,
  ocr_run_id bigint not null references public.ocr_runs(id) on delete cascade,
  status ocr_run_status not null default 'PENDING',
  model text,
  output jsonb,
  input_tokens int,
  output_tokens int,
  requested_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  check ((confirmed_by is null) = (confirmed_at is null)),
  check (confirmed_at is null or status = 'DONE')
);
create index if not exists extraction_runs_ocr_run_idx on public.extraction_runs (ocr_run_id);
create index if not exists extraction_runs_pending_idx on public.extraction_runs (created_at) where status = 'PENDING';
create unique index if not exists extraction_runs_one_open
  on public.extraction_runs (ocr_run_id) where status in ('PENDING', 'RUNNING');

-- item_no 0 = HEADER field; 1..n = row n of the ROW fields.
-- final_value / apply_to_record are set by the AO on confirm (null before).
create table if not exists public.extraction_fields (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.extraction_runs(id) on delete cascade,
  field_key text not null,
  item_no smallint not null default 0 check (item_no >= 0),
  extracted_value text,
  final_value text,
  apply_to_record boolean,
  unique (run_id, field_key, item_no)
);

-- Which OCR lines each value was read from (drawn on the document; their confidence flags poor scans)
create table if not exists public.extraction_field_lines (
  field_id bigint not null references public.extraction_fields(id) on delete cascade,
  line_id bigint not null references public.ocr_lines(id) on delete cascade,
  primary key (field_id, line_id)
);
create index if not exists extraction_field_lines_line_idx on public.extraction_field_lines (line_id);

-- Application of an extraction run (null when the OCR run is a CI file)
create or replace function public.extraction_application(p_run_id bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select d.application_id
  from extraction_runs e
  join ocr_runs o on o.id = e.ocr_run_id
  join documents d on d.id = o.document_id
  where e.id = p_run_id;
$$;

-- ============================================================
-- 4. Queue: OCR done -> extraction pending (application documents only, not CI files)
-- ============================================================
create or replace function public.queue_extraction_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'DONE' and old.status is distinct from 'DONE' and new.document_id is not null
     and (select document_type from documents where id = new.document_id) = any (extraction_document_types())
     -- a confirmed (locked) extraction for the same document stays the one in use
     and not exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
                     where o.document_id = new.document_id and e.confirmed_at is not null) then
    insert into extraction_runs (ocr_run_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists queue_extraction_run on public.ocr_runs;
create trigger queue_extraction_run after update of status on public.ocr_runs
  for each row execute function public.queue_extraction_run();

-- Backfill: latest finished OCR run of each document that has never been extracted
insert into public.extraction_runs (ocr_run_id)
select distinct on (o.document_id) o.id
from public.ocr_runs o
join public.documents d on d.id = o.document_id
where o.status = 'DONE'
  and d.document_type = any (public.extraction_document_types())
  and not exists (select 1 from public.extraction_runs e join public.ocr_runs o2 on o2.id = e.ocr_run_id
                  where o2.document_id = o.document_id)
order by o.document_id, o.id desc;

-- Worker claims pending runs (re-queues runs stuck in RUNNING > 15 min)
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
  select c.eid, c.oid, d.document_type, d.file_name
  from claimed c
  join ocr_runs o on o.id = c.oid
  join documents d on d.id = o.document_id;
end $$;

-- Worker saves the model's answer in one transaction.
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
  select d.document_type, e.ocr_run_id into v_type, v_ocr_run
  from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id join documents d on d.id = o.document_id
  where e.id = p_run_id and e.status = 'RUNNING' for update of e;
  if not found then raise exception 'Extraction run % is not running', p_run_id; end if;

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
-- 5. AO actions
-- ============================================================
-- Run the AI again on a document's latest OCR (e.g. after a failure). Not after it was confirmed.
create or replace function public.request_extraction(p_document_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_doc documents;
  v_ocr bigint;
  v_id bigint;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or not ao_can_edit(v_doc.application_id) then
    raise exception 'Only the assigned Account Officer can run the extraction, while the application is in Intake or Credit Investigation.';
  end if;
  if not v_doc.document_type = any (extraction_document_types()) then
    raise exception 'This document type has no AI extraction.';
  end if;
  if exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
             where o.document_id = p_document_id and e.confirmed_at is not null) then
    raise exception 'This document was already confirmed and is locked. Upload a new file to check it again.';
  end if;
  select id into v_ocr from ocr_runs where document_id = p_document_id and status = 'DONE' order by id desc limit 1;
  if v_ocr is null then raise exception 'The document has not been read (OCR) yet.'; end if;
  if exists (select 1 from extraction_runs where ocr_run_id = v_ocr and status in ('PENDING', 'RUNNING')) then
    raise exception 'The extraction is already running.';
  end if;
  insert into extraction_runs (ocr_run_id, requested_by) values (v_ocr, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Confirm & lock. p_fields must list every field of the run once:
--   [{"id": extraction_fields.id, "final_value": "..." | null, "apply_to_record": true | false | null}]
-- apply_to_record = true writes final_value into the field's target column for the document's borrower
-- (only fields with a target). The record's own audit triggers log those changes.
create or replace function public.confirm_extraction(p_run_id bigint, p_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_run extraction_runs;
  v_doc documents;
  v_def extraction_field_defs;
  v_field extraction_fields;
  f jsonb;
  v_value text;
  v_apply boolean;
  v_coltype text;
  v_rows int;
begin
  select * into v_run from extraction_runs where id = p_run_id for update;
  if not found then raise exception 'Extraction not found.'; end if;
  select d.* into v_doc from ocr_runs o join documents d on d.id = o.document_id where o.id = v_run.ocr_run_id;
  if v_doc.id is null or not ao_can_edit(v_doc.application_id) then
    raise exception 'Only the assigned Account Officer can confirm, while the application is in Intake or Credit Investigation.';
  end if;
  if v_run.status <> 'DONE' then raise exception 'The extraction has not finished.'; end if;
  if exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
             where o.document_id = v_doc.id and e.confirmed_at is not null) then
    raise exception 'This document was already confirmed and is locked.';
  end if;
  if exists (select 1 from extraction_runs e join ocr_runs o on o.id = e.ocr_run_id
             where o.document_id = v_doc.id and e.id > p_run_id) then
    raise exception 'A newer extraction exists for this document. Reload the page.';
  end if;
  if jsonb_typeof(p_fields) is distinct from 'array'
     or jsonb_array_length(p_fields) <> (select count(*) from extraction_fields where run_id = p_run_id)
     or (select count(distinct x->>'id') from jsonb_array_elements(p_fields) x) <> jsonb_array_length(p_fields) then
    raise exception 'Send every field of the extraction exactly once.';
  end if;

  for f in select * from jsonb_array_elements(p_fields) loop
    select * into v_field from extraction_fields where id = (f->>'id')::bigint and run_id = p_run_id;
    if not found then raise exception 'Field % is not part of this extraction.', f->>'id'; end if;
    select * into v_def from extraction_field_defs
    where document_type = v_doc.document_type and field_key = v_field.field_key;

    v_value := nullif(btrim(f->>'final_value'), '');
    v_apply := (f->>'apply_to_record')::boolean;

    if v_value is not null then
      begin
        case v_def.data_type
          when 'DATE' then v_value := v_value::date::text;
          when 'MONTH' then v_value := to_char((v_value || '-01')::date, 'YYYY-MM');
          when 'AMOUNT' then v_value := round(replace(v_value, ',', '')::numeric, 2)::text;
          when 'SEX' then
            v_value := upper(v_value);
            if v_value not in ('MALE', 'FEMALE') then raise exception 'sex'; end if;
          else null;
        end case;
      exception when others then
        raise exception '%: "%" is not a valid %.', v_def.label, f->>'final_value',
          case v_def.data_type when 'DATE' then 'date (YYYY-MM-DD)' when 'MONTH' then 'month (YYYY-MM)'
               when 'AMOUNT' then 'amount' when 'SEX' then 'sex (Male or Female)' else 'value' end;
      end;
    end if;

    if v_def.target_column is null then
      v_apply := null;
    elsif v_apply then
      if v_value is null then
        raise exception '%: an empty value can''t be copied to the application.', v_def.label;
      end if;
      if v_doc.applicant_id is null then
        raise exception 'This document is not linked to a borrower, so nothing can be copied to the application.';
      end if;
      select format_type(a.atttypid, a.atttypmod) into v_coltype
      from pg_attribute a
      where a.attrelid = format('public.%I', v_def.target_table)::regclass and a.attname = v_def.target_column;
      execute format('update public.%I set %I = $1::%s where %I = $2', v_def.target_table, v_def.target_column,
                     v_coltype, case v_def.target_table when 'applicants' then 'id' else 'applicant_id' end)
        using v_value, v_doc.applicant_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception '%: the borrower has no employment record yet. Fill in the Employment section first.', v_def.label;
      end if;
    else
      v_apply := false;
    end if;

    update extraction_fields set final_value = v_value, apply_to_record = v_apply where id = v_field.id;
  end loop;

  update extraction_runs set confirmed_by = auth.uid(), confirmed_at = now() where id = p_run_id;
end $$;

revoke execute on function public.request_extraction(bigint) from public, anon;
revoke execute on function public.confirm_extraction(bigint, jsonb) from public, anon;
grant execute on function public.request_extraction(bigint) to authenticated;
grant execute on function public.confirm_extraction(bigint, jsonb) to authenticated;

-- ============================================================
-- 6. Audit trail: agent runs finishing / failing and AO confirmations
-- ============================================================
create or replace function public.log_extraction_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_app bigint;
  v_file text;
  v_new jsonb;
begin
  select d.application_id, d.file_name into v_app, v_file
  from ocr_runs o join documents d on d.id = o.document_id where o.id = new.ocr_run_id;
  if v_app is null then return null; end if;

  if new.confirmed_at is not null and old.confirmed_at is null then
    v_new := jsonb_build_object(
      'document', v_file, 'confirmed_by', new.confirmed_by,
      'fields', (select count(*) from extraction_fields where run_id = new.id),
      'corrected', (select count(*) from extraction_fields
                    where run_id = new.id and final_value is distinct from extracted_value),
      'copied_to_application', (select count(*) from extraction_fields where run_id = new.id and apply_to_record));
  elsif new.status is distinct from old.status and new.status in ('DONE', 'FAILED') then
    v_new := jsonb_build_object('document', v_file, 'status', new.status, 'model', new.model,
                                'fields', (select count(*) from extraction_fields where run_id = new.id),
                                'error', new.error);
  else
    return null;
  end if;

  insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (v_app, 'extraction_runs', new.id, 'UPDATE', null, jsonb_strip_nulls(v_new), auth.uid());
  return null;
end $$;

drop trigger if exists log_extraction_run on public.extraction_runs;
create trigger log_extraction_run after update on public.extraction_runs
  for each row execute function public.log_extraction_run();

-- ============================================================
-- 7. Access: staff with access to the application read; writes only through the functions above
-- ============================================================
alter table public.ocr_pages enable row level security;
alter table public.extraction_field_defs enable row level security;
alter table public.extraction_runs enable row level security;
alter table public.extraction_fields enable row level security;
alter table public.extraction_field_lines enable row level security;

revoke insert, update, delete, truncate on public.ocr_pages, public.extraction_field_defs, public.extraction_runs,
  public.extraction_fields, public.extraction_field_lines from anon, authenticated;
grant select on public.ocr_pages, public.extraction_field_defs, public.extraction_runs,
  public.extraction_fields, public.extraction_field_lines to authenticated;

drop policy if exists "staff reads ocr pages" on public.ocr_pages;
create policy "staff reads ocr pages" on public.ocr_pages
  for select to authenticated
  using (exists (select 1 from public.ocr_runs r where r.id = run_id));

drop policy if exists "signed-in users read field definitions" on public.extraction_field_defs;
create policy "signed-in users read field definitions" on public.extraction_field_defs
  for select to authenticated using (true);

drop policy if exists "staff reads extraction runs" on public.extraction_runs;
create policy "staff reads extraction runs" on public.extraction_runs
  for select to authenticated
  using (public.staff_can_access(public.extraction_application(id)));

drop policy if exists "staff reads extraction fields" on public.extraction_fields;
create policy "staff reads extraction fields" on public.extraction_fields
  for select to authenticated
  using (exists (select 1 from public.extraction_runs e where e.id = run_id));

drop policy if exists "staff reads extraction field lines" on public.extraction_field_lines;
create policy "staff reads extraction field lines" on public.extraction_field_lines
  for select to authenticated
  using (exists (select 1 from public.extraction_fields f where f.id = field_id));

-- Worker wakes on new extraction runs too (AO "Run again"); staff only receive rows they can read
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'extraction_runs') then
    alter publication supabase_realtime add table public.extraction_runs;
  end if;
end $$;
