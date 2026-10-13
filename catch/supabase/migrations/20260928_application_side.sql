-- CATCH — application side (docs/schema/applicationSide.md)
-- Run once in the Supabase SQL Editor. Re-running it drops and rebuilds these tables.
--
-- Draft columns are nullable so the wizard can save step by step.
-- Completeness is enforced by submit_application() before status leaves DRAFT,
-- and RLS stops applicants from editing an application once it is submitted.

-- ============================================================
-- 0. Clean slate (the old users / applicants tables from the hand-drawn schema)
-- ============================================================
drop table if exists public.documents, public.application_requirements, public.credit_cards,
  public.existing_loans, public.bank_accounts, public.dependents, public.employment_info,
  public.addresses, public.character_references, public.referral_details,
  public.collateral_details, public.applicants, public.loan_applications,
  public.loan_purposes, public.user_profile, public.users cascade;

drop type if exists user_role, party_role, gender_type, civil_status_type, address_type,
  home_ownership_type, employment_type, referral_channel, requirement_type,
  application_status cascade;

drop sequence if exists public.application_no_seq;

-- ============================================================
-- 1. Enums
-- ============================================================
create type user_role as enum ('APPLICANT', 'ACCOUNT_OFFICER', 'CREDIT_INVESTIGATOR',
  'DISPATCH_ADMIN', 'CREDIT_OFFICER', 'REVIEWER', 'APPROVER', 'DEPT_HEAD');
create type party_role as enum ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER', 'MORTGAGOR', 'ATTORNEY_IN_FACT');
create type gender_type as enum ('MALE', 'FEMALE', 'OTHER');
create type civil_status_type as enum ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED');
create type address_type as enum ('PRESENT', 'PERMANENT', 'EMPLOYER');
create type home_ownership_type as enum ('OWNED', 'RENTED', 'LIVING_WITH_RELATIVES', 'OTHER');
-- Income sources from the Document Checklist tab; UNEMPLOYED is allowed for the spouse only.
create type employment_type as enum ('LOCALLY_EMPLOYED', 'LICENSED_PROFESSIONAL', 'SEAFARER',
  'VIRTUAL_ASSISTANT', 'COMMISSION_BASED', 'OFW', 'SELF_EMPLOYED', 'RENTAL_BUSINESS',
  'PUV_OPERATOR', 'PENSIONER', 'UNEMPLOYED');
create type referral_channel as enum ('BRANCH', 'DEVELOPER', 'AO', 'BROKER');
create type requirement_type as enum ('VALID_ID_PASSPORT', 'SPA', 'FS_BANK_STATEMENTS',
  'COE_ITR', 'PAYSLIPS_REMITTANCES', 'SEC_DTI_MAYORS_PERMIT');
create type application_status as enum ('DRAFT', 'SUBMITTED', 'FOR_CLARIFICATION', 'UNDER_CI',
  'UNDER_CREDIT_EVALUATION', 'DEFERRED', 'UNDER_REVIEW', 'FOR_APPROVAL', 'APPROVED', 'REJECTED');

-- ============================================================
-- 2. Users (row created by trigger on sign-up)
-- ============================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  phone_number text,
  role user_role not null default 'APPLICANT',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that signed up before this trigger existed
insert into public.users (id) select id from auth.users on conflict (id) do nothing;

create table public.user_profile (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_name text,
  middle_name text,
  last_name text,
  name_extension text,
  gender gender_type,
  date_of_birth date,
  birth_place text,
  civil_status civil_status_type,
  citizenship text,
  sss_no text unique,
  tin text unique
);

-- ============================================================
-- 3. Loan application
-- ============================================================
create table public.loan_purposes (
  id smallint generated always as identity primary key,
  label text unique not null,
  is_active boolean not null default true
);

-- Options from the KYC tab's Purpose dropdown
insert into public.loan_purposes (label) values
  ('Acquisition of Another Property Different from Collateral'),
  ('Acquisition of House and Lot'),
  ('Acquisition of House and Lot with Improvement of Residential Unit'),
  ('Acquisition of Residential Condominium'),
  ('Acquisition of Residential Vacant Lot'),
  ('Acquisition of Residential Vacant Lot for Investment'),
  ('Acquisition of Townhouse'),
  ('Acquisition/Construction of Real Estate Property'),
  ('Construction/Improvement/Renovation of Another Property Different from Collateral'),
  ('House Construction'),
  ('House Improvement'),
  ('House Renovation'),
  ('Purchase of House and Lot'),
  ('Purchase of Residential Condominium'),
  ('Purchase of Residential Vacant Lot'),
  ('Purchase of Residential Vacant Lot with Construction of Residential Unit'),
  ('Refinancing of House and Lot'),
  ('Refinancing of House and Lot with Improvement of Residential Unit'),
  ('Refinancing of Residential Condominium'),
  ('Refinancing of Residential Vacant Lot'),
  ('Refinancing of Residential Vacant Lot with Construction of Residential Unit'),
  ('Refinancing of Townhouse'),
  ('Reimbursement of Acquisition Cost of House and Lot, Residential Condominium or Townhouse');

create sequence public.application_no_seq;

create table public.loan_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  application_no text unique,
  submitted_at timestamptz,
  loan_purpose_id smallint references public.loan_purposes(id),
  loan_purpose_other text,
  property_address text,
  loan_amount numeric(14,2) check (loan_amount > 0),
  loan_term_years int check (loan_term_years between 1 and 30),
  interest_rate numeric(6,4),   -- set by the bank, not the applicant
  fixing_period text,           -- set by the bank, not the applicant
  status application_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  check (loan_purpose_id is null or loan_purpose_other is null)
);

-- One open draft per applicant (also stops double-creates from React StrictMode)
create unique index one_draft_per_user on public.loan_applications (user_id) where status = 'DRAFT';

create table public.applicants (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  role party_role not null,
  relationship_to_principal text,
  first_name text,
  middle_name text,
  last_name text,
  maiden_name text,
  name_extension text,
  mobile_number text,
  email_address text,
  gender gender_type,
  date_of_birth date,
  birth_place text,
  civil_status civil_status_type,
  citizenship text,
  sss_no text,
  tin text,
  unique (application_id, role)   -- KYC has one block per party
);

create table public.dependents (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  age int not null check (age between 0 and 120)
);

create table public.addresses (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  address_type address_type not null,
  same_as_principal boolean not null default false,
  unit_house_no text,
  building_street text,
  subdivision_barangay text,
  municipality_city text,
  province text,
  zip_code text,
  living_in_ph boolean,
  home_ownership home_ownership_type,
  monthly_rent numeric(12,2) check (monthly_rent >= 0),
  date_move_in date,
  unique (applicant_id, address_type)
);

create table public.employment_info (
  id bigint generated always as identity primary key,
  applicant_id bigint not null unique references public.applicants(id) on delete cascade,
  employment_type employment_type,
  employer_business_name text,
  occupation text,
  employment_date date,
  contact_number text,
  email_address text,
  employer_tin text,
  ctc_no text,
  ctc_date_issued date,
  ctc_place_issued text,
  gross_monthly_income numeric(14,2) check (gross_monthly_income >= 0)
);

create table public.bank_accounts (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  bank_name text not null,
  account_type text not null,
  account_number text not null
);

create table public.existing_loans (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  loan_type text not null,
  lending_institution text not null,
  monthly_payment numeric(14,2) not null check (monthly_payment >= 0),
  term_over_6_months boolean not null default false
);

create table public.credit_cards (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  issuing_bank text not null,
  credit_limit numeric(14,2) not null check (credit_limit >= 0),
  expiry_date date not null
);

create table public.character_references (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  reference_no smallint not null check (reference_no between 1 and 3),
  name text,
  address text,
  contact_number text,
  relationship_to_principal text,
  unique (application_id, reference_no)
);

create table public.collateral_details (
  id bigint generated always as identity primary key,
  application_id bigint not null unique references public.loan_applications(id) on delete cascade,
  project_name text,
  property_type text,
  selling_price numeric(14,2) check (selling_price > 0),
  registered_owner text,
  tct_cct_no text,
  lot_area numeric(10,2),
  floor_area numeric(10,2),
  contact_person text,
  contact_number text
);

create table public.referral_details (
  id bigint generated always as identity primary key,
  application_id bigint not null unique references public.loan_applications(id) on delete cascade,
  developer_name text,
  branch text,
  channel referral_channel,
  referrer text
);

create table public.application_requirements (
  id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(id) on delete cascade,
  requirement_type requirement_type not null,
  unique (applicant_id, requirement_type)
);

create table public.documents (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  applicant_id bigint references public.applicants(id) on delete cascade,
  requirement_id bigint references public.application_requirements(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  file_path text not null unique,   -- Supabase Storage key
  uploaded_by uuid not null default auth.uid() references public.users(id),
  uploaded_at timestamptz not null default now()
);

-- ============================================================
-- 4. Required documents per income source (Document Checklist tab)
--    Single source of truth: the app reads it through sync_requirements().
-- ============================================================
create or replace function public.required_documents(p_type employment_type, p_loan_amount numeric)
returns requirement_type[] language sql immutable strict as $$
  select (case p_type
    when 'LOCALLY_EMPLOYED'      then array['VALID_ID_PASSPORT','COE_ITR','PAYSLIPS_REMITTANCES']
    when 'LICENSED_PROFESSIONAL' then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS']
    when 'SEAFARER'              then array['VALID_ID_PASSPORT','SPA','COE_ITR','PAYSLIPS_REMITTANCES']
    when 'VIRTUAL_ASSISTANT'     then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS','COE_ITR','PAYSLIPS_REMITTANCES']
    when 'COMMISSION_BASED'      then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS','PAYSLIPS_REMITTANCES']
    when 'OFW'                   then array['VALID_ID_PASSPORT','SPA','COE_ITR','PAYSLIPS_REMITTANCES']
    when 'SELF_EMPLOYED'         then case when p_loan_amount > 3000000
                                      then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS','SEC_DTI_MAYORS_PERMIT','COE_ITR']
                                      else array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS','SEC_DTI_MAYORS_PERMIT'] end
    when 'RENTAL_BUSINESS'       then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS']
    when 'PUV_OPERATOR'          then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS']
    when 'PENSIONER'             then array['VALID_ID_PASSPORT','FS_BANK_STATEMENTS']
    else array['VALID_ID_PASSPORT']
  end)::requirement_type[]
$$;

-- BPMN asks for 2 valid IDs; everything else needs at least one file
create or replace function public.required_document_min(p_type requirement_type)
returns int language sql immutable as $$
  select case p_type when 'VALID_ID_PASSPORT' then 2 else 1 end
$$;

-- ============================================================
-- 5. Ownership helpers for RLS
-- ============================================================
create or replace function public.owns_application(p_application_id bigint, p_draft_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from loan_applications la
    where la.id = p_application_id
      and la.user_id = auth.uid()
      and (not p_draft_only or la.status = 'DRAFT'));
$$;

create or replace function public.owns_applicant(p_applicant_id bigint, p_draft_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from applicants a join loan_applications la on la.id = a.application_id
    where a.id = p_applicant_id
      and la.user_id = auth.uid()
      and (not p_draft_only or la.status = 'DRAFT'));
$$;

-- Adds the requirement rows each borrower now needs and drops ones that no longer apply
-- (e.g. employment type changed). Dropped rows take their documents with them.
create or replace function public.sync_requirements(p_application_id bigint)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_amount numeric;
begin
  if not owns_application(p_application_id, true) then return; end if;
  select coalesce(loan_amount, 0) into v_amount from loan_applications where id = p_application_id;

  delete from application_requirements ar
  using applicants a
  where ar.applicant_id = a.id
    and a.application_id = p_application_id
    and ar.requirement_type <> all (coalesce(
      (select required_documents(e.employment_type, v_amount) from employment_info e where e.applicant_id = a.id),
      '{}'));

  insert into application_requirements (applicant_id, requirement_type)
  select a.id, t
  from applicants a
  join employment_info e on e.applicant_id = a.id
  cross join lateral unnest(required_documents(e.employment_type, v_amount)) as t
  where a.application_id = p_application_id
    and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
  on conflict (applicant_id, requirement_type) do nothing;
end $$;

-- ============================================================
-- 6. Submission gate: returns what's missing; only moves to SUBMITTED when nothing is.
-- ============================================================
create or replace function public.requirement_label(p_type requirement_type)
returns text language sql immutable as $$
  select case p_type
    when 'VALID_ID_PASSPORT'     then 'Valid ID / Passport'
    when 'SPA'                   then 'SPA'
    when 'FS_BANK_STATEMENTS'    then 'FS / Bank Statements'
    when 'COE_ITR'               then 'COE / ITR'
    when 'PAYSLIPS_REMITTANCES'  then 'Payslips / Remittances (3 mos)'
    when 'SEC_DTI_MAYORS_PERMIT' then 'SEC / DTI / Mayor''s Permit'
  end
$$;

create or replace function public.submit_application(p_application_id bigint)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_app loan_applications;
  v_principal applicants;
  v_missing text[] := '{}';
  v_label text;
  p record;
  r record;
begin
  select * into v_app from loan_applications
  where id = p_application_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.status <> 'DRAFT' then raise exception 'Application was already submitted'; end if;

  perform sync_requirements(p_application_id);

  -- Loan details
  if v_app.loan_purpose_id is null and nullif(trim(v_app.loan_purpose_other), '') is null then
    v_missing := array_append(v_missing, 'Loan details: purpose'::text); end if;
  if nullif(trim(v_app.property_address), '') is null then
    v_missing := array_append(v_missing, 'Loan details: property address'::text); end if;
  if v_app.loan_amount is null then v_missing := array_append(v_missing, 'Loan details: loan amount'::text); end if;
  if v_app.loan_term_years is null then v_missing := array_append(v_missing, 'Loan details: loan term'::text); end if;

  -- Principal borrower
  select * into v_principal from applicants where application_id = p_application_id and role = 'PRINCIPAL';
  if not found then
    v_missing := array_append(v_missing, 'Principal borrower information'::text);
  elsif v_principal.first_name is null or v_principal.last_name is null or v_principal.date_of_birth is null
     or v_principal.mobile_number is null or v_principal.civil_status is null or v_principal.tin is null then
    v_missing := array_append(v_missing, 'Principal borrower: required personal details'::text);
  end if;

  if v_principal.civil_status = 'MARRIED'
     and not exists (select 1 from applicants where application_id = p_application_id and role = 'SPOUSE') then
    v_missing := array_append(v_missing, 'Spouse information (principal is married)'::text);
  end if;

  -- Each borrower: address, income, documents
  for p in
    select a.id, a.role, e.employment_type
    from applicants a left join employment_info e on e.applicant_id = a.id
    where a.application_id = p_application_id and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
  loop
    v_label := case p.role when 'PRINCIPAL' then 'Principal borrower'
                           when 'SPOUSE' then 'Spouse' else 'Co-borrower' end;

    if not exists (select 1 from addresses where applicant_id = p.id and address_type = 'PRESENT') then
      v_missing := array_append(v_missing, (v_label || ': present address')::text); end if;
    if p.role = 'PRINCIPAL' and not exists (select 1 from addresses where applicant_id = p.id and address_type = 'PERMANENT') then
      v_missing := array_append(v_missing, (v_label || ': permanent address')::text); end if;

    if p.employment_type is null then
      v_missing := array_append(v_missing, (v_label || ': employment information')::text);
    elsif p.role <> 'SPOUSE' and p.employment_type = 'UNEMPLOYED' then
      v_missing := array_append(v_missing, (v_label || ': a source of income is required')::text);
    end if;

    for r in
      select ar.requirement_type, count(d.id) as n
      from application_requirements ar left join documents d on d.requirement_id = ar.id
      where ar.applicant_id = p.id
      group by ar.requirement_type
    loop
      if r.n < required_document_min(r.requirement_type) then
        v_missing := v_missing || format('%s: upload %s (at least %s file/s)',
          v_label, requirement_label(r.requirement_type), required_document_min(r.requirement_type));
      end if;
    end loop;
  end loop;

  if (select count(*) from character_references
      where application_id = p_application_id and name is not null and contact_number is not null) < 3 then
    v_missing := array_append(v_missing, '3 character references'::text); end if;

  if not exists (select 1 from collateral_details where application_id = p_application_id
                 and property_type is not null and selling_price is not null and registered_owner is not null) then
    v_missing := array_append(v_missing, 'Collateral details'::text); end if;

  if not exists (select 1 from referral_details where application_id = p_application_id and channel is not null) then
    v_missing := array_append(v_missing, 'Referral details'::text); end if;

  if cardinality(v_missing) > 0 then return v_missing; end if;

  update loan_applications
  set status = 'SUBMITTED',
      submitted_at = now(),
      application_no = 'HL-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-'
                       || lpad(nextval('application_no_seq')::text, 6, '0')
  where id = p_application_id;

  return v_missing;
end $$;

-- ============================================================
-- 7. Row Level Security (applicant side only; staff policies come with the workflow side)
-- ============================================================
alter table public.users enable row level security;
alter table public.user_profile enable row level security;
alter table public.loan_purposes enable row level security;
alter table public.loan_applications enable row level security;

create policy "read own user row" on public.users
  for select to authenticated using (id = auth.uid());

create policy "manage own profile" on public.user_profile
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read loan purposes" on public.loan_purposes
  for select to authenticated using (true);

create policy "read own applications" on public.loan_applications
  for select to authenticated using (user_id = auth.uid());
create policy "create own draft" on public.loan_applications
  for insert to authenticated with check (user_id = auth.uid() and status = 'DRAFT');
-- Status can't be changed here; submit_application() is the only way out of DRAFT
create policy "edit own draft" on public.loan_applications
  for update to authenticated
  using (user_id = auth.uid() and status = 'DRAFT')
  with check (user_id = auth.uid() and status = 'DRAFT');
create policy "delete own draft" on public.loan_applications
  for delete to authenticated using (user_id = auth.uid() and status = 'DRAFT');

-- Tables keyed by application_id / applicant_id: read your own, write only while DRAFT
do $$
declare
  t text;
  fn text;
  col text;
begin
  foreach t in array array['applicants', 'character_references', 'collateral_details',
                           'referral_details', 'documents',
                           'dependents', 'addresses', 'employment_info', 'bank_accounts',
                           'existing_loans', 'credit_cards', 'application_requirements']
  loop
    if t in ('applicants', 'character_references', 'collateral_details', 'referral_details', 'documents') then
      fn := 'owns_application'; col := 'application_id';
    else
      fn := 'owns_applicant'; col := 'applicant_id';
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner reads" on public.%I for select to authenticated using (public.%s(%I))', t, fn, col);
    execute format('create policy "owner inserts while draft" on public.%I for insert to authenticated with check (public.%s(%I, true))', t, fn, col);
    execute format('create policy "owner updates while draft" on public.%I for update to authenticated using (public.%s(%I, true)) with check (public.%s(%I, true))', t, fn, col, fn, col);
    execute format('create policy "owner deletes while draft" on public.%I for delete to authenticated using (public.%s(%I, true))', t, fn, col);
  end loop;
end $$;

-- ============================================================
-- 8. Storage bucket for uploads. Path: {user_id}/{application_id}/{file}
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-documents', 'application-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "applicant reads own files" on storage.objects;
drop policy if exists "applicant uploads to own draft" on storage.objects;
drop policy if exists "applicant deletes from own draft" on storage.objects;

create policy "applicant reads own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'application-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "applicant uploads to own draft" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-documents'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.owns_application(((storage.foldername(name))[2])::bigint, true));

create policy "applicant deletes from own draft" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.owns_application(((storage.foldername(name))[2])::bigint, true));
