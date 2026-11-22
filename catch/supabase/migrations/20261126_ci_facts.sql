-- CATCH — CI facts: NFIS records and TU accounts as data, typed by the Credit Investigator (2026-11-22)
-- Run after 20261125_ci_ocr_opt_in.sql (needs 20261108_ci_results.sql and 20261109_ci_extraction.sql).
-- Re-runnable, no drops of data.
--
-- Why: the credit score's Character items, the RAAC NFIS rule ("No derogatory record ... acceptable records") and
-- FP XI Loan Verification need each NFIS record and each TU account, not just a PDF and one sentence. Until now
-- those values only existed inside a confirmed AI extraction, so with the AI optional they were never there.
--
-- Decided with Josh (2026-11-22):
--   * One set of boxes per borrower x check, on the CI report page (report on the left, boxes on the right): result,
--     report date, summary and the rows, saved in one go (save_ci_card). "Run AI" fills the SAME boxes; the CI checks
--     them against the report and saves. Saving after the AI filled them (p_run_id) confirms that AI run (locked, in
--     the audit trail: what the AI proposed vs what was saved) and tags the rows it filled (extraction_run_id).
--   * New result "Inconclusive" (consumer credit manual IV.D: discrepancies with the application form, or
--     information that can't be verified).
--   * Report date on every NFIS / TU result (validity: the CI report <= 1 year, court information <= 4 months).
--   * NFIS: one row per record (cancelled card, adverse loan, closed / mishandled checking account, returned checks,
--     court case, replevin, foreclosure). Court cases of the four kinds the Credit Policy Manual names (sum of money,
--     damages, estafa, BP 22) need the amount involved. The namesake check is out of scope (the CI notes it in remarks).
--   * TU: every account, open and closed (Josh: all of them, they are needed). Max days past due + current past due
--     give the score's loan history band (Good: none late / Fair: 1-30 days / Poor: past due).
--   * Mark CI Done also needs: a report date on every NFIS / TU result, at least one NFIS record when the NFIS result
--     is "With findings", and none when it is "No adverse findings".
--   * Same access as ci_checks: staff who can open the file read, nobody writes except through the RPC, the applicant
--     never sees it, every change is in audit_log.
--
-- Re-runs of earlier files:
--   * 20261108_ci_results.sql re-run -> ci_missing() goes back to the old rules: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.ci_checks') is null or to_regprocedure('public.ci_can_edit(bigint)') is null
     or to_regprocedure('public.ci_mark_started(bigint)') is null or to_regclass('public.extraction_runs') is null then
    raise exception 'Run 20261108_ci_results.sql and 20261109_ci_extraction.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. Types and columns
-- ============================================================
-- The new value can't be used in this same run of the file; nothing below uses it as a literal of the type.
alter type public.ci_check_result add value if not exists 'INCONCLUSIVE';

alter table public.ci_checks add column if not exists report_date date;

do $$ begin
  create type public.ci_nfis_record_type as enum ('CANCELLED_CARD', 'ADVERSE_LOAN', 'CLOSED_CHECKING_ACCOUNT',
    'RETURNED_CHECKS', 'COURT_CASE', 'REPLEVIN', 'FORECLOSURE', 'OTHER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ci_settlement as enum ('UNPAID', 'FULLY_PAID', 'ZERO_BALANCE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ci_case_type as enum ('SUM_OF_MONEY', 'DAMAGES', 'ESTAFA', 'BP22', 'OTHER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ci_case_status as enum ('PENDING', 'DISMISSED', 'DECIDED', 'OTHER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ci_tu_ownership as enum ('INDIVIDUAL', 'JOINT', 'GUARANTOR', 'CO_MAKER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ci_tu_account_status as enum ('CURRENT', 'PAST_DUE', 'WRITTEN_OFF', 'RESTRUCTURED', 'LEGAL', 'CLOSED');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. Tables (written only through save_ci_card)
-- ============================================================
-- One row per record on a borrower's NFIS result
create table if not exists public.ci_nfis_records (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  record_type public.ci_nfis_record_type not null,
  institution text check (length(institution) <= 200),          -- who reported it
  date_reported date not null,
  date_closed date,                                               -- closed / settled / case closed
  outstanding_balance numeric(14,2) check (outstanding_balance >= 0),
  settlement public.ci_settlement,
  full_payment_doc_id bigint references public.ci_documents(id) on delete set null,  -- certificate of full payment
  returned_checks int check (returned_checks >= 0),
  case_type public.ci_case_type,
  case_reference text check (length(case_reference) <= 200),     -- case no. / court
  amount_involved numeric(14,2) check (amount_involved >= 0),
  case_status public.ci_case_status,
  remarks text check (length(remarks) <= 1000),
  extraction_run_id bigint references public.extraction_runs(id) on delete set null,  -- set when the AI filled it
  check (record_type = 'COURT_CASE'
         or (case_type is null and case_reference is null and amount_involved is null and case_status is null))
);
create index if not exists ci_nfis_records_applicant on public.ci_nfis_records (applicant_id);

-- One row per account on a borrower's TU credit report (open and closed)
create table if not exists public.ci_tu_accounts (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  is_open boolean not null,                                       -- OPEN ACCOUNTS / CLOSED ACCOUNTS section
  lender_type text check (length(lender_type) <= 100),            -- member type, e.g. BANK, FINANCING
  lender_name text check (length(lender_name) <= 200),
  account_type text not null check (length(account_type) between 1 and 100),  -- e.g. CREDIT CARD, AUTO LOAN
  ownership public.ci_tu_ownership,
  status public.ci_tu_account_status,
  opened_on date,
  closed_on date,
  maturity_on date,
  original_amount numeric(14,2) check (original_amount >= 0),    -- loans
  credit_limit numeric(14,2) check (credit_limit >= 0),          -- cards / lines
  balance numeric(14,2) check (balance >= 0),
  past_due numeric(14,2) check (past_due >= 0),
  installment numeric(14,2) check (installment >= 0),            -- monthly installment (cards: payment amount)
  max_dpd int check (max_dpd >= 0),                               -- maximum days past due
  legal_action boolean,
  extraction_run_id bigint references public.extraction_runs(id) on delete set null
);
create index if not exists ci_tu_accounts_applicant on public.ci_tu_accounts (applicant_id);

-- ============================================================
-- 3. Access and audit (same as ci_checks)
-- ============================================================
alter table public.ci_nfis_records enable row level security;
alter table public.ci_tu_accounts enable row level security;
revoke insert, update, delete, truncate on public.ci_nfis_records, public.ci_tu_accounts from anon, authenticated;
grant select on public.ci_nfis_records, public.ci_tu_accounts to authenticated;

drop policy if exists "staff read nfis records" on public.ci_nfis_records;
create policy "staff read nfis records" on public.ci_nfis_records
  for select to authenticated using (public.staff_can_access_applicant(applicant_id));
drop policy if exists "staff read tu accounts" on public.ci_tu_accounts;
create policy "staff read tu accounts" on public.ci_tu_accounts
  for select to authenticated using (public.staff_can_access_applicant(applicant_id));

drop trigger if exists log_application_change on public.ci_nfis_records;
create trigger log_application_change after insert or update or delete on public.ci_nfis_records
  for each row execute function public.log_application_change('applicant_id');
drop trigger if exists log_application_change on public.ci_tu_accounts;
create trigger log_application_change after insert or update or delete on public.ci_tu_accounts
  for each row execute function public.log_application_change('applicant_id');

-- ============================================================
-- 4. Saving one report card: result, summary, report date and the rows, in one go
-- ============================================================
-- Rows: the full list for that borrower x check, as {column: value}. A row with an "id" updates that row (only if
-- something changed), one without is added, a saved row left out is removed: the audit log shows real changes only.
-- extraction_run_id can't be set from a row's values: a new row marked "from_ai": true gets p_run_id (the AI run
-- that filled it); an updated row keeps what it had.
create or replace function public.ci_save_nfis_records(p_applicant_id bigint, p_rows jsonb, p_run_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n int := 0;
  v ci_nfis_records;
  v_keep bigint[] := '{}';
  v_old ci_nfis_records;
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

    if v.id is not null then
      select * into v_old from ci_nfis_records where id = v.id and applicant_id = p_applicant_id;
      if not found then raise exception 'Record %: it is no longer saved. Reload the page.', n; end if;
      update ci_nfis_records set
        record_type = v.record_type, institution = v.institution, date_reported = v.date_reported,
        date_closed = v.date_closed, outstanding_balance = v.outstanding_balance, settlement = v.settlement,
        full_payment_doc_id = v.full_payment_doc_id, returned_checks = v.returned_checks, case_type = v.case_type,
        case_reference = v.case_reference, amount_involved = v.amount_involved, case_status = v.case_status,
        remarks = v.remarks
      where id = v.id
        and (record_type, institution, date_reported, date_closed, outstanding_balance, settlement, full_payment_doc_id,
             returned_checks, case_type, case_reference, amount_involved, case_status, remarks)
        is distinct from
            (v.record_type, v.institution, v.date_reported, v.date_closed, v.outstanding_balance, v.settlement,
             v.full_payment_doc_id, v.returned_checks, v.case_type, v.case_reference, v.amount_involved, v.case_status,
             v.remarks);
      v_keep := v_keep || v.id;
    else
      insert into ci_nfis_records (applicant_id, record_type, institution, date_reported, date_closed,
        outstanding_balance, settlement, full_payment_doc_id, returned_checks, case_type, case_reference,
        amount_involved, case_status, remarks, extraction_run_id)
      values (p_applicant_id, v.record_type, v.institution, v.date_reported, v.date_closed,
        v.outstanding_balance, v.settlement, v.full_payment_doc_id, v.returned_checks, v.case_type, v.case_reference,
        v.amount_involved, v.case_status, v.remarks, case when (r->>'from_ai')::boolean then p_run_id end)
      returning id into v.id;
      v_keep := v_keep || v.id;
    end if;
  end loop;
  delete from ci_nfis_records where applicant_id = p_applicant_id and not (id = any (v_keep));
end $$;

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

revoke execute on function public.ci_save_nfis_records(bigint, jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.ci_save_tu_accounts(bigint, jsonb, bigint) from public, anon, authenticated;

-- The page's only way to write a card. p_result: NO_ADVERSE_FINDINGS | WITH_FINDINGS | INCONCLUSIVE | null.
-- p_run_id: the AI run that filled the boxes, if the CI used "Run AI" (a finished, unconfirmed run of one of this
-- borrower's reports of this check). Saving confirms it: the CI has checked the boxes it filled.
create or replace function public.save_ci_card(p_applicant_id bigint, p_check_type public.ci_check_type,
                                               p_result text, p_summary text, p_report_date date, p_rows jsonb,
                                               p_run_id bigint default null)
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

  if p_run_id is not null then
    -- The AI's values, as read, stay in extraction_fields; what the CI saved is in ci_checks and the rows (audited).
    update extraction_fields set final_value = extracted_value where run_id = p_run_id;
    -- Confirming fires log_extraction_run (proposed vs saved result); this row adds how many rows the AI filled
    insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
    values (v_app, 'extraction_runs', p_run_id, 'UPDATE', null, jsonb_build_object(
      'document', v_doc.file_name,
      'rows_filled_by_ai', (select count(*) from jsonb_array_elements(v_rows) x where (x->>'from_ai')::boolean),
      'rows_saved', jsonb_array_length(v_rows)), auth.uid());
    update extraction_runs set confirmed_by = auth.uid(), confirmed_at = now() where id = p_run_id;
  end if;

  perform ci_mark_started(v_app);
end $$;

revoke execute on function public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb, bigint) from public, anon;
grant execute on function public.save_ci_card(bigint, public.ci_check_type, text, text, date, jsonb, bigint) to authenticated;

-- ============================================================
-- 5. What's still missing before Mark CI Done (complete_ci() calls this; same signature as before)
-- ============================================================
create or replace function public.ci_missing(p_application_id bigint)
returns text[] language sql stable security definer set search_path = public as $$
  with b as (
    select a.id, ci_party_label(a.role, a.party_no) as who,
           case a.role when 'PRINCIPAL' then 0 when 'SPOUSE' then 1 else 1 + a.party_no end as party_ord
    from applicants a
    where a.application_id = p_application_id and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
  ), slot as (
    select b.*, t, c.result::text as result, c.report_date
    from b cross join unnest(array['NFIS', 'TU']::ci_check_type[]) t
    left join ci_checks c on c.applicant_id = b.id and c.check_type = t
  )
  select coalesce(array_agg(msg order by party_ord, t, kind), '{}')
  from (
    select who || ': ' || t::text || ' report (upload the file)' as msg, party_ord, t, 1 as kind
    from slot where not exists (select 1 from ci_documents d where d.applicant_id = slot.id and d.check_type = slot.t)
    union all
    select who || ': ' || t::text || ' result', party_ord, t, 2 from slot where result is null
    union all
    select who || ': ' || t::text || ' report date', party_ord, t, 3 from slot where report_date is null
    union all
    select who || ': NFIS records (list each finding)', party_ord, t, 4
    from slot where t = 'NFIS' and result = 'WITH_FINDINGS'
      and not exists (select 1 from ci_nfis_records r where r.applicant_id = slot.id)
    union all
    select who || ': NFIS says No adverse findings but lists records (remove them or change the result)', party_ord, t, 4
    from slot where t = 'NFIS' and result = 'NO_ADVERSE_FINDINGS'
      and exists (select 1 from ci_nfis_records r where r.applicant_id = slot.id)
  ) m
  where staff_can_access(p_application_id);
$$;
