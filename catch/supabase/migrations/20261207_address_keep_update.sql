-- Document check: Keep / Update for the ID's Address, the same way as name, birth date, sex ...
-- The AI reads the address as one line; the application keeps it in parts (house no., street, barangay, city,
-- province, ZIP). Josh's choice (2026-11-27): Update copies the WHOLE line into the Street part of the borrower's
-- PRESENT address and empties the other parts (no splitting). Ownership, rent and move-in date are not touched.
-- A spouse / co-borrower marked "Same address as principal" gets their own address: same_as_principal is switched
-- off for that person only; the principal's address is not changed.
-- Because barangay, city, province and ZIP are then empty, the loan folder's Address section reads Incomplete
-- until the AO fills them in there (the page says so before the AO confirms).
-- Run after 20261109_ai_extraction.sql. Safe to run again.

-- 1. Allow addresses.building_street as a target (the whitelist was an unnamed check in 20261109)
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.extraction_field_defs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%employer_tin%'
  loop
    execute format('alter table public.extraction_field_defs drop constraint %I', v_name);
  end loop;
end $$;

alter table public.extraction_field_defs add constraint extraction_field_defs_target_check check (
  target_table is null or (target_table, target_column) in (
    ('applicants', 'last_name'), ('applicants', 'first_name'), ('applicants', 'middle_name'),
    ('applicants', 'name_extension'), ('applicants', 'date_of_birth'), ('applicants', 'gender'),
    ('applicants', 'birth_place'), ('applicants', 'citizenship'), ('applicants', 'tin'), ('applicants', 'sss_no'),
    ('employment_info', 'employer_business_name'), ('employment_info', 'occupation'),
    ('employment_info', 'employment_date'), ('employment_info', 'employer_tin'),
    ('employment_info', 'gross_monthly_income'),
    ('addresses', 'building_street')));

-- 2. The ID's Address now has a target (still compared with the present address as a whole)
update public.extraction_field_defs
set target_table = 'addresses', target_column = 'building_street'
where document_type = 'VALID_ID_PASSPORT' and field_key = 'address';

-- 3. confirm_extraction: same as 20261109, plus the address branch
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
      if v_def.target_table = 'addresses' then
        -- the whole line goes into the Street part of the PRESENT address; the other parts are emptied.
        -- "Same as principal" is switched off for this borrower only (they now have their own address).
        insert into addresses (applicant_id, address_type, same_as_principal, building_street)
        values (v_doc.applicant_id, 'PRESENT', false, v_value)
        on conflict (applicant_id, address_type) do update set
          same_as_principal = false, unit_house_no = null, building_street = excluded.building_street,
          subdivision_barangay = null, municipality_city = null, province = null, zip_code = null;
      else
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
      end if;
    else
      v_apply := false;
    end if;

    update extraction_fields set final_value = v_value, apply_to_record = v_apply where id = v_field.id;
  end loop;

  update extraction_runs set confirmed_by = auth.uid(), confirmed_at = now() where id = p_run_id;
end $$;

revoke execute on function public.confirm_extraction(bigint, jsonb) from public, anon;
grant execute on function public.confirm_extraction(bigint, jsonb) to authenticated;
