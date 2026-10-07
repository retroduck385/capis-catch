-- CATCH — assigned Account Officer edits and verifies the applicant's submitted record (KYC)
-- Run after 20261007_staff_profile_required.sql. Re-runnable, no drops of data.
--
-- Who can edit: the AO currently assigned to the application, only while it is in the
-- INTAKE stage. Everyone else with access (CI, heads, assigned CO) stays read-only.
--
-- The AO edits the record in place (same tables the applicant filled in). What the
-- applicant originally entered is kept in audit_log, which records every change made
-- after submission (old -> new values, who, when). Clients can't write or delete it.
--
-- kyc_checks: the AO's verification per section of the form (Verified / Needs
-- clarification + remarks), like the KYC tab's "KYC Verification Remarks" column.
-- History rows; the latest row per (application, section) is the current result.

-- ============================================================
-- 1. Edit rights
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
      and s.stage = 'INTAKE'
      and aa.user_id = auth.uid());
$$;

create or replace function public.ao_can_edit_applicant(p_applicant_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ao_can_edit(application_id) from applicants where id = p_applicant_id), false);
$$;

revoke execute on function public.ao_can_edit(bigint) from anon;

-- loan_applications: only the loan detail columns are editable from the client.
-- status / application_no / submitted_at / user_id change only through the RPCs.
revoke update on public.loan_applications from authenticated;
grant update (loan_purpose_id, loan_purpose_other, property_address, loan_amount, loan_term_years)
  on public.loan_applications to authenticated;

drop policy if exists "assigned AO updates" on public.loan_applications;
create policy "assigned AO updates" on public.loan_applications
  for update to authenticated
  using (public.ao_can_edit(id)) with check (public.ao_can_edit(id));

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
      fn := 'ao_can_edit'; col := 'application_id';
    else
      fn := 'ao_can_edit_applicant'; col := 'applicant_id';
    end if;

    execute format('drop policy if exists "assigned AO inserts" on public.%I', t);
    execute format('drop policy if exists "assigned AO updates" on public.%I', t);
    execute format('drop policy if exists "assigned AO deletes" on public.%I', t);
    execute format('create policy "assigned AO inserts" on public.%I for insert to authenticated with check (public.%s(%I))', t, fn, col);
    execute format('create policy "assigned AO updates" on public.%I for update to authenticated using (public.%s(%I)) with check (public.%s(%I))', t, fn, col, fn, col);
    execute format('create policy "assigned AO deletes" on public.%I for delete to authenticated using (public.%s(%I))', t, fn, col);
  end loop;
end $$;

-- Files: the AO uploads into the applicant's folder ({owner user_id}/{application_id}/...)
-- so the applicant can still open them.
drop policy if exists "assigned AO uploads files" on storage.objects;
create policy "assigned AO uploads files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'application-documents'
              and public.ao_can_edit(((storage.foldername(name))[2])::bigint)
              and (storage.foldername(name))[1] = (select user_id::text from public.loan_applications
                                                   where id = ((storage.foldername(name))[2])::bigint));

drop policy if exists "assigned AO deletes files" on storage.objects;
create policy "assigned AO deletes files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'application-documents'
         and public.ao_can_edit(((storage.foldername(name))[2])::bigint));

-- Same as before, but the assigned AO may also re-derive the checklist
-- (e.g. after correcting an employment type or the loan amount)
create or replace function public.sync_requirements(p_application_id bigint)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_amount numeric;
begin
  if not (owns_application(p_application_id, true) or ao_can_edit(p_application_id)) then return; end if;
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
-- 2. Audit trail of changes to submitted applications
-- ============================================================
-- No FK on application_id: audit rows must outlive the record they describe.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  application_id bigint not null,
  table_name text not null,
  row_id bigint not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,   -- UPDATE: only the columns that changed
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists audit_log_application on public.audit_log (application_id, changed_at);

-- TG_ARGV[0]: how to find the application ('self' = loan_applications, 'application_id', 'applicant_id')
create or replace function public.log_application_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_app bigint;
  v_status application_status;
begin
  v_app := case tg_argv[0]
    when 'self' then (v_row->>'id')::bigint
    when 'application_id' then (v_row->>'application_id')::bigint
    else (select application_id from applicants where id = (v_row->>'applicant_id')::bigint) end;

  -- Unknown application = cascaded from a deleted borrower, whose own row is already logged
  if v_app is null then return null; end if;

  if tg_argv[0] = 'self' then
    v_status := (v_old->>'status')::application_status;
  else
    select status into v_status from loan_applications where id = v_app;
  end if;
  -- Drafts are the applicant's own work in progress; the trail starts at submission
  if v_status is null or v_status = 'DRAFT' then return null; end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
    into v_old, v_new
    from jsonb_each(v_new) n join jsonb_each(v_old) o using (key)
    where n.value is distinct from o.value;
    if v_new is null then return null; end if;  -- nothing actually changed
  end if;

  insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (v_app, tg_table_name, (v_row->>'id')::bigint, tg_op, v_old, v_new, auth.uid());
  return null;
end $$;

do $$
declare
  t text;
  k text;
begin
  foreach t in array array['loan_applications', 'applicants', 'character_references', 'collateral_details',
                           'referral_details', 'documents',
                           'dependents', 'addresses', 'employment_info', 'bank_accounts',
                           'existing_loans', 'credit_cards', 'application_requirements']
  loop
    k := case when t = 'loan_applications' then 'self'
              when t in ('applicants', 'character_references', 'collateral_details', 'referral_details', 'documents')
                then 'application_id'
              else 'applicant_id' end;
    execute format('drop trigger if exists log_application_change on public.%I', t);
    execute format('create trigger log_application_change after insert or update or delete on public.%I '
                   'for each row execute function public.log_application_change(%L)', t, k);
  end loop;
end $$;

alter table public.audit_log enable row level security;
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

drop policy if exists "staff read audit" on public.audit_log;
create policy "staff read audit" on public.audit_log
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 3. KYC verification per form section
-- ============================================================
do $$ begin
  create type public.kyc_check_result as enum ('VERIFIED', 'NEEDS_CLARIFICATION');
exception when duplicate_object then null; end $$;

-- section = the form step key used by the app (loan, principalInfo, spouse, coBorrower-2, documents, ...)
create table if not exists public.kyc_checks (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  section text not null check (section ~ '^[A-Za-z][A-Za-z0-9-]*$'),
  result kyc_check_result not null,
  remarks text,
  checked_by uuid not null default auth.uid() references public.users(id),
  checked_at timestamptz not null default now(),
  check (result = 'VERIFIED' or nullif(trim(remarks), '') is not null)
);
create index if not exists kyc_checks_application on public.kyc_checks (application_id, section, checked_at);

alter table public.kyc_checks enable row level security;
revoke update, delete, truncate on public.kyc_checks from anon, authenticated;

drop policy if exists "staff read kyc checks" on public.kyc_checks;
create policy "staff read kyc checks" on public.kyc_checks
  for select to authenticated using (public.staff_can_access(application_id));

drop policy if exists "assigned AO records kyc checks" on public.kyc_checks;
create policy "assigned AO records kyc checks" on public.kyc_checks
  for insert to authenticated
  with check (public.ao_can_edit(application_id) and checked_by = auth.uid());
