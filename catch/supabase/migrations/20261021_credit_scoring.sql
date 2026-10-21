-- CATCH — Housing Loan Credit Scoring (KYC-FP "Credit_Score" tab), scored by the Credit Officer in the FP
-- Run after 20261020_financial_package.sql. Re-runnable, no drops of data.
--
-- Josh, 2026-10-21: fill in what CATCH can from the applicant's data, but keep a human in the loop.
--   * The page SUGGESTS a band for each criterion it can work out from the record (DBR, income, tenure,
--     collateral, LCR, age, dependents, ...). Suggestions live in the front end
--     (src/pages/financialPackage/creditScore.js); nothing is scored until the CO picks or accepts a band.
--   * The CO can change any band. Each saved entry keeps the band the page suggested when the CO set it
--     (suggested_band), so the audit trail shows where the CO overrode the suggestion.
--   * Points per band come from column B of the sheet and live in credit_score_bands (one source of truth;
--     the FK stops a band that doesn't belong to its criterion). Totals, risk rating and recommendation are
--     computed in the front end, not stored.
--   * The score's recommendation is a guide only; the CO still sets the Credit Result.
--   * Its own page (/creditScorePage, opened from the FP) with its own save: save_credit_score().
--     Same edit rule as the FP (co_can_edit(): assigned CO, any stage before Decided).
--
-- The sheet names the bank in two Character labels; they say "the Bank" here (NDA).

-- ============================================================
-- 1. Scoring rules (reference data, from the Credit_Score tab)
-- ============================================================
do $$ begin
  create type public.credit_score_category as enum ('CAPACITY', 'CHARACTER', 'COLLATERAL', 'CONDITION');
exception when duplicate_object then null; end $$;

create table if not exists public.credit_score_criteria (
  code text primary key,
  category credit_score_category not null,
  label text not null,
  sort_order smallint not null
);

create table if not exists public.credit_score_bands (
  criterion text not null references public.credit_score_criteria(code) on delete cascade,
  code text not null,
  label text not null,
  points smallint not null,
  sort_order smallint not null,
  primary key (criterion, code)
);

insert into public.credit_score_criteria (code, category, label, sort_order) values
  ('DBR',              'CAPACITY',   'Debt to Income Ratio / Debt Burden Ratio', 1),
  ('NDI',              'CAPACITY',   'Net Disposable Income', 2),
  ('TENURE',           'CAPACITY',   'Employment Tenure / Length of Business', 3),
  ('INCOME_SOURCE',    'CAPACITY',   'Source of Income', 4),
  ('LOAN_HISTORY',     'CHARACTER',  'Loan Borrowing/s', 5),
  ('DEPOSIT_HANDLING', 'CHARACTER',  'Deposit / Current Account Handling', 6),
  ('NFIS',             'CHARACTER',  'NFIS Checking', 7),
  ('COLLATERAL_VALUE', 'COLLATERAL', 'Collateral Value', 8),
  ('COLLATERAL_TYPE',  'COLLATERAL', 'Type of Collateral', 9),
  ('PROPERTY_USAGE',   'COLLATERAL', 'Property Usage', 10),
  ('LCR',              'COLLATERAL', 'Loan to Collateral Ratio', 11),
  ('DEPENDENTS',       'CONDITION',  'Number of Dependents', 12),
  ('LENGTH_OF_STAY',   'CONDITION',  'Length of Stay in the Current Address', 13),
  ('AGE',              'CONDITION',  'Age', 14),
  ('CIVIL_STATUS',     'CONDITION',  'Civil Status', 15),
  ('GENDER',           'CONDITION',  'Gender', 16),
  ('RESIDENCE_TYPE',   'CONDITION',  'Type of Residence', 17)
on conflict (code) do update set
  category = excluded.category, label = excluded.label, sort_order = excluded.sort_order;

insert into public.credit_score_bands (criterion, code, label, points, sort_order) values
  -- 1. Capacity (max 30)
  ('DBR', 'BELOW_26',     'Below 26%', 8, 1),
  ('DBR', 'FROM_26_TO_33', '26% – 33%', 6, 2),
  ('DBR', 'FROM_34_TO_40', '34% – 40%', 4, 3),
  ('DBR', 'ABOVE_40',     'Above 40%', 0, 4),
  ('NDI', 'FROM_100K',    'More than ₱100,000', 6, 1),
  ('NDI', 'FROM_80K',     '₱80,000 to ₱99,999', 5, 2),
  ('NDI', 'FROM_60K',     '₱60,000 to ₱79,999', 4, 3),
  ('NDI', 'FROM_40K',     '₱40,000 to ₱59,999', 2, 4),
  ('NDI', 'BELOW_40K',    'Less than ₱40,000', 0, 5),
  ('TENURE', 'ABOVE_5',     'More than 5 years', 5, 1),
  ('TENURE', 'FROM_3_TO_5', 'More than 3 years to 5 years', 2, 2),
  ('TENURE', 'FROM_2_TO_3', '2 to 3 years', 1, 3),
  ('TENURE', 'BELOW_2',     'Less than 2 years', 0, 4),
  ('INCOME_SOURCE', 'LOCALLY_EMPLOYED', 'Locally Employed', 11, 1),
  ('INCOME_SOURCE', 'OFW',              'OFW / Direct-Hired', 2, 2),
  ('INCOME_SOURCE', 'SEAFARER',         'Seafarers', 0, 3),
  ('INCOME_SOURCE', 'SELF_EMPLOYED',    'Self-Employed', 8, 4),
  ('INCOME_SOURCE', 'PENSION',          'Pension', 5, 5),
  -- 2. Character (max 20)
  ('LOAN_HISTORY', 'GOOD', 'GOOD: With existing or fully paid loan with the Bank or other banks / FIs and no history of delayed payment', 8, 1),
  ('LOAN_HISTORY', 'FAIR', 'FAIR: With existing or fully paid loan with the Bank or other banks / FIs with history of 1–30 days delayed payments', 3, 2),
  ('LOAN_HISTORY', 'NONE', 'No existing or previous loans with the Bank or other financial institution', 0, 3),
  ('LOAN_HISTORY', 'POOR', 'POOR: With history of past due with the Bank and other banks', -8, 4),
  ('DEPOSIT_HANDLING', 'GOOD',         'GOOD: No incidences of returned checks', 5, 1),
  ('DEPOSIT_HANDLING', 'FAIR',         'FAIR: With maximum of 5 incidences of returned check', 0, 2),
  ('DEPOSIT_HANDLING', 'POOR',         'POOR: More than 5 incidences of returned check', -5, 3),
  ('DEPOSIT_HANDLING', 'SAVINGS_ONLY', 'With savings account only', 0, 4),
  ('NFIS', 'NO_ADVERSE',               'No adverse record', 7, 1),
  ('NFIS', 'CANCELLED_CARD_SETTLED',   'With cancelled card but fully settled', 3, 2),
  ('NFIS', 'MISHANDLED_CHECKING_OLD',  'With 1 mishandled checking account more than 5 years (from date closed / reported)', 3, 3),
  ('NFIS', 'COURT_CASE_OLD',           'With court case more than 10 years (from date closed / reported)', 0, 4),
  ('NFIS', 'CANCELLED_CARD_UNSETTLED', 'With cancelled card but not yet settled (regardless of balance)', 0, 5),
  ('NFIS', 'MULTIPLE_MISHANDLED',      'With more than 1 mishandled checking account', -7, 6),
  ('NFIS', 'COURT_CASE_RECENT',        'With court case within the last 10 years', -7, 7),
  -- 3. Collateral (max 20)
  ('COLLATERAL_VALUE', 'FROM_1M_TO_3M', '₱1M – ₱3M', 5, 1),
  ('COLLATERAL_VALUE', 'ABOVE_3M',      'Above ₱3M', 4, 2),
  ('COLLATERAL_VALUE', 'BELOW_1M',      'Less than ₱1M', 3, 3),
  ('COLLATERAL_TYPE', 'HOUSE_AND_LOT', 'House and Lot', 2, 1),
  ('COLLATERAL_TYPE', 'CONDOMINIUM',   'Residential Condominium', 2, 2),
  ('COLLATERAL_TYPE', 'TOWNHOUSE',     'Townhouse', 2, 3),
  ('COLLATERAL_TYPE', 'VACANT_LOT',    'Residential Vacant Lot', 1, 4),
  ('COLLATERAL_TYPE', 'ROW_HOUSE',     'Row House', 1, 5),
  ('PROPERTY_USAGE', 'EXISTING_PRIMARY', 'Existing Primary Residence', 5, 1),
  ('PROPERTY_USAGE', 'FOR_PRIMARY',      'For Primary Residence', 4, 2),
  ('PROPERTY_USAGE', 'INVESTMENT',       'For Investment / Others', 3, 3),
  ('LCR', 'BELOW_60',      'LCR below 60%', 8, 1),
  ('LCR', 'FROM_60_TO_80', 'LCR 60% – 80%', 5, 2),
  ('LCR', 'ABOVE_80',      'LCR above 80%', 3, 3),
  -- 4. Condition (max 30)
  ('DEPENDENTS', 'ONE_OR_NONE',     '1 or none', 1, 1),
  ('DEPENDENTS', 'TWO_TO_THREE',    '2 – 3', 5, 2),
  ('DEPENDENTS', 'MORE_THAN_THREE', 'More than 3', 2, 3),
  ('LENGTH_OF_STAY', 'SIX_UP',       '6 years up', 6, 1),
  ('LENGTH_OF_STAY', 'FOUR_TO_FIVE', '4 – 5 years', 4, 2),
  ('LENGTH_OF_STAY', 'TWO_TO_THREE', '2 – 3 years', 3, 3),
  ('LENGTH_OF_STAY', 'ONE_DOWN',     '1 year down', 1, 4),
  ('AGE', 'OUTSIDE_25_65', 'Less than 25 or more than 65 years old', 1, 1),
  ('AGE', 'FROM_25_TO_35', '25 – 35 years old', 6, 2),
  ('AGE', 'FROM_36_TO_45', '36 – 45 years old', 3, 3),
  ('AGE', 'FROM_46_TO_65', '46 – 65 years old', 4, 4),
  ('CIVIL_STATUS', 'MARRIED',     'Married', 4, 1),
  ('CIVIL_STATUS', 'NOT_MARRIED', 'Single / Widowed / Legally Separated', 2, 2),
  ('GENDER', 'MALE',   'Male', 2, 1),
  ('GENDER', 'FEMALE', 'Female', 4, 2),
  ('RESIDENCE_TYPE', 'WITH_PARENTS', 'Living with Parents / Relatives', 5, 1),
  ('RESIDENCE_TYPE', 'OWNED',        'Owned / Amortized', 4, 2),
  ('RESIDENCE_TYPE', 'RENTED',       'Rented', 3, 3),
  ('RESIDENCE_TYPE', 'OTHERS',       'Others (e.g. company provided)', 1, 4)
on conflict (criterion, code) do update set
  label = excluded.label, points = excluded.points, sort_order = excluded.sort_order;

-- ============================================================
-- 2. The CO's score: one row per criterion scored (unscored = no row)
-- ============================================================
create table if not exists public.credit_score_entries (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  criterion text not null references public.credit_score_criteria(code),
  band text not null,
  suggested_band text,              -- what the page suggested when the CO set the band (null = no suggestion)
  remarks text,
  unique (application_id, criterion),
  foreign key (criterion, band) references public.credit_score_bands(criterion, code),
  foreign key (criterion, suggested_band) references public.credit_score_bands(criterion, code)
);

-- ============================================================
-- 3. RLS: rules readable by staff; entries like the rest of the FP (staff with access read,
--    no client writes, audit trail on every change)
-- ============================================================
alter table public.credit_score_criteria enable row level security;
alter table public.credit_score_bands enable row level security;
alter table public.credit_score_entries enable row level security;
revoke insert, update, delete, truncate on public.credit_score_criteria, public.credit_score_bands,
  public.credit_score_entries from anon, authenticated;

drop policy if exists "staff read credit score rules" on public.credit_score_criteria;
create policy "staff read credit score rules" on public.credit_score_criteria
  for select to authenticated using (public.is_staff());
drop policy if exists "staff read credit score rules" on public.credit_score_bands;
create policy "staff read credit score rules" on public.credit_score_bands
  for select to authenticated using (public.is_staff());
drop policy if exists "staff read fp" on public.credit_score_entries;
create policy "staff read fp" on public.credit_score_entries
  for select to authenticated using (public.staff_can_access(application_id));

drop trigger if exists log_application_change on public.credit_score_entries;
create trigger log_application_change after insert or update or delete on public.credit_score_entries
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 4. Saving: p_rows = [{ criterion, band, suggested_band, remarks }]. Rows without a band are unscored
--    (deleted). Full replace of the application's score; unchanged rows don't touch audit_log.
-- ============================================================

-- Leftover from a first draft of this file (score saved inside the FP save); never run in Supabase
drop function if exists public.fp_save_credit_score(bigint, jsonb);

create or replace function public.save_credit_score(p_application_id bigint, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from loan_applications where id = p_application_id and status <> 'DRAFT' for update;
  if not found then raise exception 'Application not found'; end if;

  if not co_can_edit(p_application_id) then
    raise exception 'Only the assigned Credit Officer can edit the credit score';
  end if;

  p_rows := coalesce(p_rows, '[]'::jsonb);

  delete from credit_score_entries t
  where t.application_id = p_application_id
    and t.criterion not in (select e->>'criterion' from jsonb_array_elements(p_rows) e
                            where nullif(e->>'band', '') is not null);

  insert into credit_score_entries (application_id, criterion, band, suggested_band, remarks)
  select p_application_id, r.criterion, r.band, nullif(r.suggested_band, ''), nullif(trim(r.remarks), '')
  from jsonb_to_recordset(p_rows) as r(criterion text, band text, suggested_band text, remarks text)
  where nullif(r.band, '') is not null
  on conflict (application_id, criterion) do update set
    band = excluded.band, suggested_band = excluded.suggested_band, remarks = excluded.remarks
  where (credit_score_entries.band, credit_score_entries.suggested_band, credit_score_entries.remarks)
        is distinct from (excluded.band, excluded.suggested_band, excluded.remarks);
end $$;

revoke execute on function public.save_credit_score(bigint, jsonb) from anon;
