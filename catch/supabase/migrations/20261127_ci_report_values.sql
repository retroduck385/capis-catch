-- CATCH — every field on a CI report is a box, typed by the Credit Investigator or filled by Run AI (2026-11-22)
-- Run after 20261126_ci_facts.sql. Re-runnable, no drops of data.
--
-- Decided with Josh (2026-11-22):
--   * Besides the result, report date, summary, NFIS records and TU accounts, the CI report page shows a box for every
--     field the AI can read from the report (extraction_field_defs for CI_NFIS / CI_TU: who was searched and the
--     request keys, the TU subject's identity, IDs, addresses, employers, summary totals, score, bureau flags,
--     previous inquiries). The CI types them or Run AI fills them; they're saved with the rest of the boxes.
--     Identity boxes show Matches / Differs against the application on the page (never written to the application).
--   * Stored as one row per field (ci_report_values), using the same field list as the AI (extraction_field_defs),
--     each value checked against the field's type. The values the score and the policy check use keep their own
--     typed columns (ci_checks, ci_nfis_records, ci_tu_accounts), so the TU "accounts" rows and the report date are
--     not stored here.
--   * NFIS records: a new kind "Fraud / fake documents", and "Filed by" (who filed it) on court cases.
--
-- Re-runs of earlier files:
--   * 20261126_ci_facts.sql re-run -> ci_save_nfis_records() and save_ci_card() go back to the versions without
--     "Filed by" and the other boxes: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.ci_nfis_records') is null or to_regprocedure('public.extraction_check_value(text, text, text)') is null then
    raise exception 'Run 20261126_ci_facts.sql (and 20261109_ci_extraction.sql) first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. NFIS records: "Fraud / fake documents", "Filed by"
-- ============================================================
-- The new value can't be used in this same run of the file; nothing below uses it as a literal of the type.
alter type public.ci_nfis_record_type add value if not exists 'FRAUD';

alter table public.ci_nfis_records add column if not exists case_filed_by text check (length(case_filed_by) <= 200);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ci_nfis_records_filed_by_court_only') then
    alter table public.ci_nfis_records add constraint ci_nfis_records_filed_by_court_only
      check (record_type = 'COURT_CASE' or case_filed_by is null);
  end if;
end $$;

-- Same as 20261126_ci_facts.sql, plus case_filed_by
create or replace function public.ci_save_nfis_records(p_applicant_id bigint, p_rows jsonb, p_run_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n int := 0;
  v ci_nfis_records;
  v_keep bigint[] := '{}';
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      v := jsonb_populate_record(null::ci_nfis_records, r - 'applicant_id' - 'extraction_run_id');
    exception when others then
      raise exception 'Record %: a value is not valid (%).', n, sqlerrm;
    end;
    if v.record_type is null then raise exception 'Record %: pick the kind of record.', n; end if;
    if v.date_reported is null then raise exception 'Record %: enter the date it was reported.', n; end if;
    if v.date_reported > current_date or v.date_closed > current_date then
      raise exception 'Record %: a date is in the future.', n;
    end if;
    if v.record_type in ('CANCELLED_CARD', 'ADVERSE_LOAN') and v.settlement is null then
      raise exception 'Record %: pick whether it is unpaid, fully paid or zero balance.', n;
    end if;
    if v.record_type = 'COURT_CASE' and v.case_type is null then
      raise exception 'Record %: pick the kind of case.', n;
    end if;
    if v.case_type in ('SUM_OF_MONEY', 'DAMAGES', 'ESTAFA', 'BP22') and v.amount_involved is null then
      raise exception 'Record %: enter the amount involved (required for this kind of case).', n;
    end if;
    if v.full_payment_doc_id is not null and not exists (
        select 1 from ci_documents where id = v.full_payment_doc_id and applicant_id = p_applicant_id and check_type = 'NFIS') then
      raise exception 'Record %: the certificate of full payment must be one of this borrower''s NFIS files.', n;
    end if;
    v.remarks := nullif(btrim(v.remarks), '');
    v.institution := nullif(btrim(v.institution), '');
    v.case_reference := nullif(btrim(v.case_reference), '');
    v.case_filed_by := nullif(btrim(v.case_filed_by), '');

    if v.id is not null then
      if not exists (select 1 from ci_nfis_records where id = v.id and applicant_id = p_applicant_id) then
        raise exception 'Record %: it is no longer saved. Reload the page.', n;
      end if;
      update ci_nfis_records set
        record_type = v.record_type, institution = v.institution, date_reported = v.date_reported,
        date_closed = v.date_closed, outstanding_balance = v.outstanding_balance, settlement = v.settlement,
        full_payment_doc_id = v.full_payment_doc_id, returned_checks = v.returned_checks, case_type = v.case_type,
        case_reference = v.case_reference, case_filed_by = v.case_filed_by, amount_involved = v.amount_involved,
        case_status = v.case_status, remarks = v.remarks
      where id = v.id
        and (record_type, institution, date_reported, date_closed, outstanding_balance, settlement, full_payment_doc_id,
             returned_checks, case_type, case_reference, case_filed_by, amount_involved, case_status, remarks)
        is distinct from
            (v.record_type, v.institution, v.date_reported, v.date_closed, v.outstanding_balance, v.settlement,
             v.full_payment_doc_id, v.returned_checks, v.case_type, v.case_reference, v.case_filed_by, v.amount_involved,
             v.case_status, v.remarks);
      v_keep := v_keep || v.id;
    else
      insert into ci_nfis_records (applicant_id, record_type, institution, date_reported, date_closed,
        outstanding_balance, settlement, full_payment_doc_id, returned_checks, case_type, case_reference, case_filed_by,
        amount_involved, case_status, remarks, extraction_run_id)
      values (p_applicant_id, v.record_type, v.institution, v.date_reported, v.date_closed,
        v.outstanding_balance, v.settlement, v.full_payment_doc_id, v.returned_checks, v.case_type, v.case_reference,
        v.case_filed_by, v.amount_involved, v.case_status, v.remarks,
        case when (r->>'from_ai')::boolean then p_run_id end)
      returning id into v.id;
      v_keep := v_keep || v.id;
    end if;
  end loop;
  delete from ci_nfis_records where applicant_id = p_applicant_id and not (id = any (v_keep));
end $$;
revoke execute on function public.ci_save_nfis_records(bigint, jsonb, bigint) from public, anon, authenticated;

-- TU accounts: same as 20261126_ci_facts.sql. Recreated here too, so this file works whichever version of
-- 20261126 was run (an early one had no p_run_id); the old two-argument versions are removed.
create or replace function public.ci_save_tu_accounts(p_applicant_id bigint, p_rows jsonb, p_run_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n int := 0;
  v ci_tu_accounts;
  v_keep bigint[] := '{}';
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      v := jsonb_populate_record(null::ci_tu_accounts, r - 'applicant_id' - 'extraction_run_id');
    exception when others then
      raise exception 'Account %: a value is not valid (%).', n, sqlerrm;
    end;
    v.account_type := nullif(btrim(v.account_type), '');
    v.lender_type := nullif(btrim(v.lender_type), '');
    v.lender_name := nullif(btrim(v.lender_name), '');
    if v.is_open is null then raise exception 'Account %: pick open or closed.', n; end if;
    if v.account_type is null then raise exception 'Account %: enter the account type.', n; end if;
    if v.opened_on > current_date or v.closed_on > current_date then
      raise exception 'Account %: a date is in the future.', n;
    end if;

    if v.id is not null then
      if not exists (select 1 from ci_tu_accounts where id = v.id and applicant_id = p_applicant_id) then
        raise exception 'Account %: it is no longer saved. Reload the page.', n;
      end if;
      update ci_tu_accounts set
        is_open = v.is_open, lender_type = v.lender_type, lender_name = v.lender_name, account_type = v.account_type,
        ownership = v.ownership, status = v.status, opened_on = v.opened_on, closed_on = v.closed_on,
        maturity_on = v.maturity_on, original_amount = v.original_amount, credit_limit = v.credit_limit,
        balance = v.balance, past_due = v.past_due, installment = v.installment, max_dpd = v.max_dpd,
        legal_action = v.legal_action
      where id = v.id
        and (is_open, lender_type, lender_name, account_type, ownership, status, opened_on, closed_on, maturity_on,
             original_amount, credit_limit, balance, past_due, installment, max_dpd, legal_action)
        is distinct from
            (v.is_open, v.lender_type, v.lender_name, v.account_type, v.ownership, v.status, v.opened_on, v.closed_on,
             v.maturity_on, v.original_amount, v.credit_limit, v.balance, v.past_due, v.installment, v.max_dpd,
             v.legal_action);
      v_keep := v_keep || v.id;
    else
      insert into ci_tu_accounts (applicant_id, is_open, lender_type, lender_name, account_type, ownership, status,
        opened_on, closed_on, maturity_on, original_amount, credit_limit, balance, past_due, installment, max_dpd,
        legal_action, extraction_run_id)
      values (p_applicant_id, v.is_open, v.lender_type, v.lender_name, v.account_type, v.ownership, v.status,
        v.opened_on, v.closed_on, v.maturity_on, v.original_amount, v.credit_limit, v.balance, v.past_due,
        v.installment, v.max_dpd, v.legal_action, case when (r->>'from_ai')::boolean then p_run_id end)
      returning id into v.id;
      v_keep := v_keep || v.id;
    end if;
  end loop;
  delete from ci_tu_accounts where applicant_id = p_applicant_id and not (id = any (v_keep));
end $$;
revoke execute on function public.ci_save_tu_accounts(bigint, jsonb, bigint) from public, anon, authenticated;
drop function if exists public.ci_save_nfis_records(bigint, jsonb);
drop function if exists public.ci_save_tu_accounts(bigint, jsonb);

-- ============================================================
-- 2. Every other field on the report (one row per field; rows of a list are item_no 1..n per list)
-- ============================================================
create table if not exists public.ci_report_values (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  check_type public.ci_check_type not null,
  field_key text not null,                 -- extraction_field_defs.field_key of CI_<check_type>
  item_no smallint not null default 0 check (item_no >= 0),   -- 0 = a single field; 1..n = row n of its list
  value text not null check (length(value) between 1 and 1000),
  unique (applicant_id, check_type, field_key, item_no)
);

alter table public.ci_report_values enable row level security;
revoke insert, update, delete, truncate on public.ci_report_values from anon, authenticated;
grant select on public.ci_report_values to authenticated;
drop policy if exists "staff read ci report values" on public.ci_report_values;
create policy "staff read ci report values" on public.ci_report_values
  for select to authenticated using (public.staff_can_access_applicant(applicant_id));
drop trigger if exists log_application_change on public.ci_report_values;
create trigger log_application_change after insert or update or delete on public.ci_report_values
  for each row execute function public.log_application_change('applicant_id');

-- Fields with their own typed home, never stored here
create or replace function public.ci_report_value_skipped(p_field_key text)
returns boolean language sql immutable as $$
  select p_field_key like 'acct\_%' or p_field_key in ('report_date', 'date_reported');
$$;

-- p_values: the full list for that borrower x check, [{"field_key": "...", "item_no": 0, "value": "..."}]. Empty values
-- are left out (and removed if saved before). Each value is checked against its field's type (extraction_check_value:
-- dates YYYY-MM-DD, amounts, numbers, MALE / FEMALE), with the field's label in the error.
create or replace function public.ci_save_report_values(p_applicant_id bigint, p_check_type public.ci_check_type, p_values jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  v_def extraction_field_defs;
  v_item int;
  v_value text;
  v_keep bigint[] := '{}';
  v_id bigint;
begin
  if jsonb_typeof(coalesce(p_values, '[]'::jsonb)) <> 'array' then raise exception 'Send the report values as a list.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) loop
    select * into v_def from extraction_field_defs
    where document_type = 'CI_' || p_check_type::text and field_key = x->>'field_key';
    if v_def.field_key is null or ci_report_value_skipped(v_def.field_key) then
      raise exception 'Unknown field % for % reports.', x->>'field_key', p_check_type;
    end if;
    v_item := coalesce((x->>'item_no')::int, 0);
    if (v_def.scope = 'HEADER') <> (v_item = 0) or v_item > 500 then
      raise exception '%: wrong row number.', v_def.label;
    end if;
    v_value := extraction_check_value(v_def.data_type, v_def.label, x->>'value');
    if v_value is null then continue; end if;
    if length(v_value) > 1000 then raise exception '%: too long (1,000 characters at most).', v_def.label; end if;

    insert into ci_report_values (applicant_id, check_type, field_key, item_no, value)
    values (p_applicant_id, p_check_type, v_def.field_key, v_item, v_value)
    on conflict (applicant_id, check_type, field_key, item_no) do update set value = excluded.value
      where ci_report_values.value is distinct from excluded.value
    returning id into v_id;
    if v_id is null then
      select id into v_id from ci_report_values
      where applicant_id = p_applicant_id and check_type = p_check_type and field_key = v_def.field_key and item_no = v_item;
    end if;
    v_keep := v_keep || v_id;
    v_id := null;
  end loop;
  delete from ci_report_values
  where applicant_id = p_applicant_id and check_type = p_check_type and not (id = any (v_keep));
end $$;
revoke execute on function public.ci_save_report_values(bigint, public.ci_check_type, jsonb) from public, anon, authenticated;

-- ============================================================
-- 3. save_ci_card: also saves the other boxes (p_values; null = leave them as they are)
-- ============================================================
drop function if exists public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb);
drop function if exists public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb, bigint);
create or replace function public.save_ci_card(p_applicant_id bigint, p_check_type public.ci_check_type,
                                               p_result text, p_summary text, p_report_date date, p_rows jsonb,
                                               p_run_id bigint default null, p_values jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app bigint := ci_borrower_application(p_applicant_id);
  v_result ci_check_result;
  v_summary text := nullif(btrim(p_summary), '');
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_run extraction_runs;
  v_doc ci_documents;
begin
  if v_app is null then raise exception 'That borrower is not on this application'; end if;
  perform 1 from loan_applications where id = v_app for update;
  if not ci_can_edit(v_app) then perform ci_refuse(); end if;
  if p_check_type not in ('NFIS', 'TU') then raise exception 'Only NFIS and TU results are recorded.'; end if;
  begin
    v_result := nullif(btrim(p_result), '')::ci_check_result;
  exception when others then
    raise exception 'Pick the result: No adverse findings, With findings or Inconclusive.';
  end;
  if length(v_summary) > 4000 then raise exception 'The summary is too long (4,000 characters at most).'; end if;
  if p_report_date > current_date then raise exception 'The report date is in the future.'; end if;
  if p_report_date < date '2000-01-01' then raise exception 'Check the report date.'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Send the rows as a list.'; end if;
  if p_check_type = 'NFIS' and v_result::text = 'NO_ADVERSE_FINDINGS' and jsonb_array_length(v_rows) > 0 then
    raise exception 'The result is No adverse findings, but % NFIS record(s) are listed. Remove them or change the result.',
      jsonb_array_length(v_rows);
  end if;
  if p_run_id is not null then
    select * into v_run from extraction_runs where id = p_run_id for update;
    select cd.* into v_doc from ocr_runs o join ci_documents cd on cd.id = o.ci_document_id where o.id = v_run.ocr_run_id;
    if v_run.id is null or v_doc.id is null or v_doc.applicant_id <> p_applicant_id or v_doc.check_type <> p_check_type then
      raise exception 'That AI reading is not of this borrower''s % report.', p_check_type;
    end if;
    if v_run.status <> 'DONE' then raise exception 'The AI has not finished reading the report.'; end if;
    if v_run.confirmed_at is not null then raise exception 'That AI reading was already checked and saved. Reload the page.'; end if;
  end if;

  insert into ci_checks (applicant_id, check_type, result, summary, report_date)
  values (p_applicant_id, p_check_type, v_result, v_summary, p_report_date)
  on conflict (applicant_id, check_type) do update
    set result = excluded.result, summary = excluded.summary, report_date = excluded.report_date
    where (ci_checks.result, ci_checks.summary, ci_checks.report_date)
          is distinct from (excluded.result, excluded.summary, excluded.report_date);

  if p_check_type = 'NFIS' then
    perform ci_save_nfis_records(p_applicant_id, v_rows, p_run_id);
  else
    perform ci_save_tu_accounts(p_applicant_id, v_rows, p_run_id);
  end if;
  if p_values is not null then
    perform ci_save_report_values(p_applicant_id, p_check_type, p_values);
  end if;

  if p_run_id is not null then
    -- The AI's values, as read, stay in extraction_fields; what the CI saved is in ci_checks, the rows and
    -- ci_report_values (all audited)
    update extraction_fields set final_value = extracted_value where run_id = p_run_id;
    insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
    values (v_app, 'extraction_runs', p_run_id, 'UPDATE', null, jsonb_build_object(
      'document', v_doc.file_name,
      'rows_filled_by_ai', (select count(*) from jsonb_array_elements(v_rows) x where (x->>'from_ai')::boolean),
      'rows_saved', jsonb_array_length(v_rows)), auth.uid());
    update extraction_runs set confirmed_by = auth.uid(), confirmed_at = now() where id = p_run_id;
  end if;

  perform ci_mark_started(v_app);
end $$;

revoke execute on function public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb, bigint, jsonb) to authenticated;
