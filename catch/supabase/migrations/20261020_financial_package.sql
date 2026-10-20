-- CATCH — Financial Package & Credit Recommendation (KYC-FP "FP" tab), filled in by the Credit Officer
-- Run after 20261020_ao_view_all.sql. Re-runnable, no drops of data.
--
-- Josh, 2026-10-20:
--   * COs follow the AO rule: they can open every submitted application (read-only) and edit
--     the FP only once they claim it ("Assign me") or a head assigns them.
--   * The assigned CO can edit the FP at any open stage (Intake through Approval), not just
--     Credit Evaluation, because nothing moves an application there yet.
--   * The fields the FP copies from the KYC (names, employer, loan, collateral) are NOT stored
--     here; the page reads them live from the record, read-only. The AO fixes them in the KYC.
--   * The CO picks an income basis per borrower: COE (80%), payslip (90%) or as declared (100%).
--     The factors and every computed figure (gross income, amortization, DBR, LCR) live in the
--     front end (src/pages/financialPackage/compute.js); only the CO's inputs are stored.
--   * The Credit Result (Endorsed / Not endorsed / Deferred) is saved on the FP only. It does
--     not move the stage yet.
--   * Credit checking (BRAS / NFIS / TU) results come from the CI and aren't built yet.
--
-- Interest rate and fixing period already exist on loan_applications ("set by the bank");
-- the CO sets them through save_financial_package(). interest_rate = % per annum (6.5 = 6.5%).
--
-- Writes only go through save_financial_package() (one transaction, one permission check).
-- Every change is logged in audit_log by the existing trigger.

-- ============================================================
-- 1. Access: COs read every submitted application, like AOs
--    (replaces staff_can_access() from 20261020_ao_view_all.sql; if that file or
--    20261020_ci_request.sql is re-run, run this one again)
-- ============================================================
create or replace function public.staff_can_access(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and (current_user_role() in ('ACCOUNT_OFFICER', 'CREDIT_OFFICER', 'DISPATCH_ADMIN', 'REVIEWER',
                                   'APPROVER', 'DEPT_HEAD')
           or (current_user_role() = 'CREDIT_INVESTIGATOR'
               and exists (select 1 from ci_requests r where r.application_id = la.id))
           or exists (select 1 from application_assignments aa
                      where aa.application_id = la.id
                        and aa.user_id = auth.uid()
                        and aa.unassigned_at is null)));
$$;

-- Edit rights: the assigned CO, while the application is in any stage before Decided
create or replace function public.co_can_edit(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select current_user_role() = 'CREDIT_OFFICER' and exists (
    select 1
    from loan_applications la
    join application_stages s on s.application_id = la.id and s.left_at is null
    join application_assignments aa on aa.application_id = la.id
         and aa.assignee_role = 'CREDIT_OFFICER' and aa.unassigned_at is null
    where la.id = p_application_id
      and la.status <> 'DRAFT'
      and s.stage <> 'DECIDED'
      and aa.user_id = auth.uid());
$$;

revoke execute on function public.co_can_edit(bigint) from anon;

-- ============================================================
-- 2. Enums
-- ============================================================
do $$ begin
  create type public.credit_result as enum ('ENDORSED', 'NOT_ENDORSED', 'DEFERRED');
exception when duplicate_object then null; end $$;

-- Which document the CO bases a borrower's income on (factor in the front end: 80 / 90 / 100%)
do $$ begin
  create type public.income_basis as enum ('COE', 'PAYSLIP', 'DECLARED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.title_kind as enum ('PRESENT', 'PRECEDING');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 3. Tables (CO inputs only; everything copied from the KYC is read live)
-- ============================================================

-- One per application: header, facility, collateral appraisal, T&Cs, credit result
create table if not exists public.financial_packages (
  id bigint generated always as identity primary key,
  application_id bigint not null unique references public.loan_applications(id) on delete cascade,
  date_prepared date,
  dosri_rpt boolean,                -- Directors, Officers, Stockholders and Related Interests / Related Party Transaction
  variant text,
  manner_of_repayment text,
  hgc_eligibility text,
  date_of_enrollment date,
  appraised_value numeric(14,2) check (appraised_value > 0),  -- when set, LCR uses it instead of the TCP
  date_of_appraisal date,
  other_information text,
  statement_of_account text,
  terms_and_conditions text,
  credit_result credit_result,
  justification text,
  amendment text,
  waiver_and_acceptance text,
  deferrals text,
  check (credit_result is null or nullif(trim(justification), '') is not null)
);

-- Per borrower (principal, spouse, co-borrowers): income basis, other income (B), remarks
create table if not exists public.fp_party_details (
  id bigint generated always as identity primary key,
  applicant_id bigint not null unique references public.applicants(id) on delete cascade,
  income_basis income_basis,
  other_income numeric(14,2) check (other_income >= 0),
  employment_remarks text,          -- VIII. Employment / Business Verification
  cash_flow_remarks text,           -- IX. Financial Capacity / Cash Flow
  other_information text            -- XIV. Customer Information: ARSS, TU, submitted IDs / documents, remarks
);

-- V. Exceptions
create table if not exists public.fp_exceptions (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  policy text,
  exception_recommendation text,
  mitigant text
);

-- X. Deposit checking
create table if not exists public.fp_deposit_checks (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  bank_name text,
  account_name text,
  account_type text,
  account_number text,
  amd numeric(14,2),                -- average monthly deposit
  adb numeric(14,2),                -- average daily balance
  remarks text
);

-- XI. Loan verification (based on Loandex and disclosure)
create table if not exists public.fp_loan_checks (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  bank_name text,
  facility text,
  original_loan numeric(14,2),
  outstanding_balance numeric(14,2),
  amortization numeric(14,2),
  contract_date date,
  maturity_date date,
  remarks text
);

-- XII. Trade checking (if applicable)
create table if not exists public.fp_trade_checks (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  company_name text,
  transaction_type text,
  product_service text,
  volume text,
  frequency text,
  payment_handling text,
  remarks text
);

-- XIII. Title verification and traceback: present title + first preceding title
create table if not exists public.fp_title_verifications (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  title_kind title_kind not null,
  title_no text,
  registered_owner text,
  date_of_verification date,
  place_of_verification text,
  mode_of_conveyance text,
  date_of_inscription date,
  remarks text,
  unique (application_id, title_kind)
);

create index if not exists fp_exceptions_application on public.fp_exceptions (application_id);
create index if not exists fp_deposit_checks_application on public.fp_deposit_checks (application_id);
create index if not exists fp_loan_checks_application on public.fp_loan_checks (application_id);
create index if not exists fp_trade_checks_application on public.fp_trade_checks (application_id);

-- ============================================================
-- 4. RLS: staff with access read; no client writes (save_financial_package() only).
--    The applicant doesn't see the FP.
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['financial_packages', 'fp_party_details', 'fp_exceptions', 'fp_deposit_checks',
                           'fp_loan_checks', 'fp_trade_checks', 'fp_title_verifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('drop policy if exists "staff read fp" on public.%I', t);
    if t = 'fp_party_details' then
      execute format('create policy "staff read fp" on public.%I for select to authenticated '
                     'using (public.staff_can_access_applicant(applicant_id))', t);
    else
      execute format('create policy "staff read fp" on public.%I for select to authenticated '
                     'using (public.staff_can_access(application_id))', t);
    end if;

    -- Audit trail (same trigger as the KYC tables)
    execute format('drop trigger if exists log_application_change on public.%I', t);
    execute format('create trigger log_application_change after insert or update or delete on public.%I '
                   'for each row execute function public.log_application_change(%L)',
                   t, case when t = 'fp_party_details' then 'applicant_id' else 'application_id' end);
  end loop;
end $$;

-- ============================================================
-- 5. Saving
-- ============================================================

-- Syncs one row list (exceptions, deposit / loan / trade checks) with what the page sent:
-- rows with an id are updated, rows without one are inserted, missing ones are deleted.
-- Unchanged rows don't touch audit_log. Internal: only called by save_financial_package().
create or replace function public.fp_sync_rows(p_table text, p_application_id bigint, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cols text;
  v_vals text;
  v_set text;
begin
  if p_table not in ('fp_exceptions', 'fp_deposit_checks', 'fp_loan_checks', 'fp_trade_checks') then
    raise exception 'Unknown FP table %', p_table;
  end if;
  p_rows := coalesce(p_rows, '[]'::jsonb);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(format('%1$I = r.%1$I', column_name), ', ' order by ordinal_position)
  into v_cols, v_vals, v_set
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and column_name not in ('id', 'application_id');

  execute format('delete from public.%I t where t.application_id = $1 and t.id not in '
                 '(select (e->>''id'')::bigint from jsonb_array_elements($2) e where e->>''id'' is not null)', p_table)
  using p_application_id, p_rows;

  execute format('update public.%1$I t set %2$s from jsonb_populate_recordset(null::public.%1$I, $2) r '
                 'where r.id = t.id and t.application_id = $1', p_table, v_set)
  using p_application_id, p_rows;

  execute format('insert into public.%1$I (application_id, %2$s) select $1, %3$s '
                 'from jsonb_populate_recordset(null::public.%1$I, $2) r where r.id is null', p_table, v_cols, v_vals)
  using p_application_id, p_rows;
end $$;

revoke execute on function public.fp_sync_rows(text, bigint, jsonb) from public, anon, authenticated;

-- p_fp = {
--   package:   { date_prepared, dosri_rpt, variant, ..., credit_result, justification, ... },
--   pricing:   { interest_rate, fixing_period },              -> loan_applications
--   parties:   [{ applicant_id, income_basis, other_income, employment_remarks, cash_flow_remarks, other_information }],
--   exceptions / deposit_checks / loan_checks / trade_checks: [{ id?, ...columns }],
--   titles:    [{ title_kind, title_no, ... }]
-- }
-- Empty strings must already be nulls (the page's toRow() does that).
create or replace function public.save_financial_package(p_application_id bigint, p_fp jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pkg financial_packages;
  v_party fp_party_details;
  v_title fp_title_verifications;
  e jsonb;
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  if not co_can_edit(p_application_id) then
    raise exception 'Only the assigned Credit Officer can edit the Financial Package';
  end if;

  -- Header, facility, collateral, T&Cs, credit result
  v_pkg := jsonb_populate_record(null::financial_packages, coalesce(p_fp->'package', '{}'));
  if v_pkg.credit_result is not null and nullif(trim(v_pkg.justification), '') is null then
    raise exception 'Add a justification for the credit result';
  end if;

  insert into financial_packages (application_id, date_prepared, dosri_rpt, variant, manner_of_repayment,
    hgc_eligibility, date_of_enrollment, appraised_value, date_of_appraisal, other_information,
    statement_of_account, terms_and_conditions, credit_result, justification, amendment,
    waiver_and_acceptance, deferrals)
  values (p_application_id, v_pkg.date_prepared, v_pkg.dosri_rpt, v_pkg.variant, v_pkg.manner_of_repayment,
    v_pkg.hgc_eligibility, v_pkg.date_of_enrollment, v_pkg.appraised_value, v_pkg.date_of_appraisal,
    v_pkg.other_information, v_pkg.statement_of_account, v_pkg.terms_and_conditions, v_pkg.credit_result,
    v_pkg.justification, v_pkg.amendment, v_pkg.waiver_and_acceptance, v_pkg.deferrals)
  on conflict (application_id) do update set
    date_prepared = excluded.date_prepared, dosri_rpt = excluded.dosri_rpt, variant = excluded.variant,
    manner_of_repayment = excluded.manner_of_repayment, hgc_eligibility = excluded.hgc_eligibility,
    date_of_enrollment = excluded.date_of_enrollment, appraised_value = excluded.appraised_value,
    date_of_appraisal = excluded.date_of_appraisal, other_information = excluded.other_information,
    statement_of_account = excluded.statement_of_account, terms_and_conditions = excluded.terms_and_conditions,
    credit_result = excluded.credit_result, justification = excluded.justification,
    amendment = excluded.amendment, waiver_and_acceptance = excluded.waiver_and_acceptance,
    deferrals = excluded.deferrals;

  -- Interest rate / fixing period (audit trigger skips it when nothing changed)
  if p_fp ? 'pricing' then
    update loan_applications
    set interest_rate = (p_fp->'pricing'->>'interest_rate')::numeric,
        fixing_period = nullif(trim(p_fp->'pricing'->>'fixing_period'), '')
    where id = p_application_id
      and (interest_rate, fixing_period) is distinct from
          ((p_fp->'pricing'->>'interest_rate')::numeric, nullif(trim(p_fp->'pricing'->>'fixing_period'), ''));
  end if;

  -- Per borrower
  for e in select * from jsonb_array_elements(coalesce(p_fp->'parties', '[]')) loop
    v_party := jsonb_populate_record(null::fp_party_details, e);
    if not exists (select 1 from applicants where id = v_party.applicant_id and application_id = p_application_id
                   and role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')) then
      raise exception 'Borrower % is not on this application', v_party.applicant_id;
    end if;
    insert into fp_party_details (applicant_id, income_basis, other_income, employment_remarks,
      cash_flow_remarks, other_information)
    values (v_party.applicant_id, v_party.income_basis, v_party.other_income, v_party.employment_remarks,
      v_party.cash_flow_remarks, v_party.other_information)
    on conflict (applicant_id) do update set
      income_basis = excluded.income_basis, other_income = excluded.other_income,
      employment_remarks = excluded.employment_remarks, cash_flow_remarks = excluded.cash_flow_remarks,
      other_information = excluded.other_information;
  end loop;

  -- Row lists
  perform fp_sync_rows('fp_exceptions', p_application_id, p_fp->'exceptions');
  perform fp_sync_rows('fp_deposit_checks', p_application_id, p_fp->'deposit_checks');
  perform fp_sync_rows('fp_loan_checks', p_application_id, p_fp->'loan_checks');
  perform fp_sync_rows('fp_trade_checks', p_application_id, p_fp->'trade_checks');

  -- Present / first preceding title
  for e in select * from jsonb_array_elements(coalesce(p_fp->'titles', '[]')) loop
    v_title := jsonb_populate_record(null::fp_title_verifications, e);
    if v_title.title_kind is null then raise exception 'Title kind is required'; end if;
    insert into fp_title_verifications (application_id, title_kind, title_no, registered_owner,
      date_of_verification, place_of_verification, mode_of_conveyance, date_of_inscription, remarks)
    values (p_application_id, v_title.title_kind, v_title.title_no, v_title.registered_owner,
      v_title.date_of_verification, v_title.place_of_verification, v_title.mode_of_conveyance,
      v_title.date_of_inscription, v_title.remarks)
    on conflict (application_id, title_kind) do update set
      title_no = excluded.title_no, registered_owner = excluded.registered_owner,
      date_of_verification = excluded.date_of_verification, place_of_verification = excluded.place_of_verification,
      mode_of_conveyance = excluded.mode_of_conveyance, date_of_inscription = excluded.date_of_inscription,
      remarks = excluded.remarks;
  end loop;
end $$;

revoke execute on function public.save_financial_package(bigint, jsonb) from anon;
