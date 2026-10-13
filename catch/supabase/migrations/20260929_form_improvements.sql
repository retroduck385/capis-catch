-- CATCH — application form improvements (run after 20260928_application_side.sql)
-- Safe to re-run.
--
-- 1. Several co-borrowers per application (applicants.party_no)
-- 2. Applicants can set their own mobile number (users.phone_number) for the master profile
-- 3. Uploaded files get a standard name from the server (documents.file_name); the
--    applicant's original name is kept in documents.original_file_name
-- 4. submit_application() labels co-borrowers by number and checks every borrower's name

-- ============================================================
-- 1. Co-borrowers: numbered 1..n; every other role stays one per application
-- ============================================================
alter table public.applicants add column if not exists party_no smallint not null default 1;

alter table public.applicants drop constraint if exists applicants_application_id_role_key;
alter table public.applicants drop constraint if exists applicants_application_role_party_no_key;
alter table public.applicants add constraint applicants_application_role_party_no_key
  unique (application_id, role, party_no);

alter table public.applicants drop constraint if exists applicants_party_no_check;
alter table public.applicants add constraint applicants_party_no_check
  check (party_no >= 1 and (party_no = 1 or role = 'CO_BORROWER'));

-- ============================================================
-- 2. Master profile: mobile number lives on users.phone_number.
--    Applicants may update that one column only (role / is_active stay locked).
-- ============================================================
revoke update on public.users from authenticated;
grant update (phone_number) on public.users to authenticated;

drop policy if exists "update own phone number" on public.users;
create policy "update own phone number" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================
-- 3. Standard file names, e.g. JUAN-SANTOS-DELA-CRUZ-JR_COBORROWER2_VALID_ID_PASSPORT_1.pdf
-- ============================================================
alter table public.documents add column if not exists original_file_name text;

create or replace function public.name_document() returns trigger
language plpgsql set search_path = public as $$
declare
  v_party applicants;
  v_ext text;
  v_n int;
begin
  select * into v_party from applicants where id = new.applicant_id;
  v_ext := lower(substring(new.file_name from '\.([A-Za-z0-9]+)$'));

  -- Next number for this requirement (max + 1, so a deleted file doesn't cause a duplicate name)
  select coalesce(max(substring(file_name from '_(\d+)(\.[A-Za-z0-9]+)?$')::int), 0) + 1 into v_n
  from documents where requirement_id = new.requirement_id;

  new.original_file_name := new.file_name;
  -- Complete name, words joined by hyphens: JUAN-SANTOS-DELA-CRUZ-JR
  new.file_name := concat_ws('_',
      nullif(trim(both '-' from upper(regexp_replace(
          concat_ws(' ', v_party.first_name, v_party.middle_name, v_party.last_name, v_party.name_extension),
          '[^A-Za-z0-9]+', '-', 'g'))), ''),
      case when v_party.role = 'CO_BORROWER' then 'COBORROWER' || v_party.party_no
           else v_party.role::text end,
      new.document_type,
      v_n) || coalesce('.' || v_ext, '');
  return new;
end $$;

drop trigger if exists name_document on public.documents;
create trigger name_document
  before insert on public.documents
  for each row execute function public.name_document();

-- ============================================================
-- 4. Submission gate (same checks as before + numbered co-borrowers + borrower names)
-- ============================================================
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

  -- Each borrower: name, address, income, documents
  for p in
    select a.id, a.role, a.party_no, a.first_name, a.last_name, e.employment_type
    from applicants a left join employment_info e on e.applicant_id = a.id
    where a.application_id = p_application_id and a.role in ('PRINCIPAL', 'SPOUSE', 'CO_BORROWER')
    order by a.role, a.party_no
  loop
    v_label := case p.role when 'PRINCIPAL' then 'Principal borrower'
                           when 'SPOUSE' then 'Spouse'
                           else 'Co-borrower ' || p.party_no end;

    if p.role <> 'PRINCIPAL' and (p.first_name is null or p.last_name is null) then
      v_missing := array_append(v_missing, (v_label || ': name')::text); end if;

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
