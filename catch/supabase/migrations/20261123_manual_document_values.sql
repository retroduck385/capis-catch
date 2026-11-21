-- CATCH — values typed by hand for the files the AI doesn't read (group notes item 14, Part C2, 2026-11-22)
-- Run after 20261122_mrac_reviews.sql (needs 20261121_replace_documents.sql, 20261112_document_requests.sql,
-- 20261029_applicant_notices.sql, 20261020_financial_package.sql and 20261007_ao_kyc_verification.sql).
-- Re-runnable, no drops of data. No existing function, table, trigger or policy is changed.
--
-- What it does
--   SPA, SEC / DTI / Mayor's permit and "Other" files (documents.document_type SPA, SEC_DTI_MAYORS_PERMIT or OTHER;
--   from the original upload or a document request) are not read by the AI. The assigned Account Officer reads them
--   on the Document check and types what matters as label / value rows (e.g. "Business name: ABC Trading").
--   No AI is involved and nothing is copied into the application record.
--
-- Who can do what
--   save_manual_document_values(document, entries)   the assigned Account Officer only, while the file is in Intake,
--                                                    Credit Investigation, Credit Evaluation or Review (locked from
--                                                    Approval on), with a filled-in staff profile, on the current copy
--                                                    of the file (not one replaced by a newer upload)
--   manual_values_can_save(application)             may I type now? (the same checks, for the page; no document needed)
--   read document_manual_values                      staff who can open the file (staff_can_access); never the applicant
--   update / delete / truncate                       nobody, the table owner and the service role included. A save adds
--                                                    a row: the newest one per file is what shows, the older ones are
--                                                    its history. The one exception: when the document row itself is
--                                                    deleted, its values go with it (foreign key cascade).
--   Every save is in audit_log (log_application_change).

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.audit_log', '20261007_ao_kyc_verification.sql'),
               ('public.document_requests', '20261112_document_requests.sql'),
               ('public.applicant_notices', '20261029_applicant_notices.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is null and not exists (select 1 from information_schema.columns where table_schema = 'public'
                                       and table_name = 'documents' and column_name = 'superseded_at') then
    v_missing := '20261121_replace_documents.sql';
  end if;
  if v_missing is null and (to_regprocedure('public.staff_can_access(bigint)') is null
                            or to_regprocedure('public.notice_is_assigned_ao(bigint)') is null
                            or to_regprocedure('public.document_request_stage_ok(bigint)') is null
                            or to_regprocedure('public.staff_name(uuid)') is null
                            or to_regprocedure('public.log_application_change()') is null) then
    v_missing := '20261020_financial_package.sql / 20261029_applicant_notices.sql / 20261112_document_requests.sql';
  end if;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. Table: one row per save
-- ============================================================
create table if not exists public.document_manual_values (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.documents(id) on delete cascade,
  application_id bigint not null references public.loan_applications(id) on delete cascade,
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  saved_by uuid not null default auth.uid() references public.users(id),
  saved_at timestamptz not null default now()
);
create index if not exists document_manual_values_doc on public.document_manual_values (document_id, id desc);
create index if not exists document_manual_values_app on public.document_manual_values (application_id);

comment on table public.document_manual_values is
  'Values the assigned AO typed by hand from an SPA, SEC / DTI / Mayor''s permit or Other file (no AI). Append-only: the newest row per document is current, older rows are its history. Written only by save_manual_document_values().';

-- The file types that are typed by hand (everything the AI doesn't read on upload)
create or replace function public.manual_value_document_types()
returns text[] language sql immutable as $$
  select array['SPA', 'SEC_DTI_MAYORS_PERMIT', 'OTHER'];
$$;

-- ============================================================
-- 2. Append-only guard (everyone, owner and service role included)
-- ============================================================
create or replace function public.document_manual_values_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  -- the document itself was deleted: its values go with it (the foreign key cascade)
  if tg_op = 'DELETE' and not exists (select 1 from documents d where d.id = old.document_id) then
    return old;
  end if;
  raise exception 'Typed values can''t be edited or deleted: save again to replace them (the earlier save stays in the history)';
end $$;
revoke execute on function public.document_manual_values_append_only() from public, anon, authenticated;

drop trigger if exists document_manual_values_append_only on public.document_manual_values;
create trigger document_manual_values_append_only before update or delete on public.document_manual_values
  for each row execute function public.document_manual_values_append_only();
drop trigger if exists document_manual_values_no_truncate on public.document_manual_values;
create trigger document_manual_values_no_truncate before truncate on public.document_manual_values
  for each statement execute function public.document_manual_values_append_only();

-- ============================================================
-- 3. Audit: every save is in audit_log
-- ============================================================
drop trigger if exists log_application_change on public.document_manual_values;
create trigger log_application_change after insert on public.document_manual_values
  for each row execute function public.log_application_change('application_id');

-- ============================================================
-- 4. RLS: staff who can open the file read; no client writes
-- ============================================================
alter table public.document_manual_values enable row level security;
revoke all on public.document_manual_values from anon, authenticated;
grant select on public.document_manual_values to authenticated;
drop policy if exists "staff read typed document values" on public.document_manual_values;
create policy "staff read typed document values" on public.document_manual_values
  for select to authenticated using (public.staff_can_access(application_id));

-- ============================================================
-- 5. Checking the rows (also used by the page: same limits)
-- ============================================================
-- null when fine, else what is wrong. At most 30 rows; label 1-60 characters, value 1-300 (both trimmed); only the keys
-- label and value; no label twice (ignoring case). An empty list is allowed (clears the typed values).
create or replace function public.manual_values_problem(p_entries jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_row jsonb;
  v_key text;
  v_label text;
  v_value text;
  v_seen text[] := '{}';
  v_n int := 0;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then return 'The rows must be a list'; end if;
  if jsonb_array_length(p_entries) > 30 then return 'At most 30 rows'; end if;
  for v_row in select * from jsonb_array_elements(p_entries) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_row) <> 'object' then return format('Row %s is not a label and a value', v_n); end if;
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key not in ('label', 'value') then return format('Row %s has an unexpected part: %s', v_n, v_key); end if;
    end loop;
    if jsonb_typeof(v_row->'label') is distinct from 'string' or jsonb_typeof(v_row->'value') is distinct from 'string' then
      return format('Row %s needs a label and a value', v_n);
    end if;
    v_label := btrim(v_row->>'label');
    v_value := btrim(v_row->>'value');
    if v_label = '' then return format('Row %s needs a label', v_n); end if;
    if length(v_label) > 60 then return format('Row %s: the label is longer than 60 characters', v_n); end if;
    if v_value = '' then return format('Row %s (%s) needs a value', v_n, v_label); end if;
    if length(v_value) > 300 then return format('Row %s (%s): the value is longer than 300 characters', v_n, v_label); end if;
    if lower(v_label) = any (v_seen) then return format('The label "%s" is there twice', v_label); end if;
    v_seen := v_seen || lower(v_label);
  end loop;
  return null;
end $$;
grant execute on function public.manual_values_problem(jsonb) to authenticated;

-- ============================================================
-- 6. May I type values on this file now? (the assigned AO with a profile name, Intake to Review)
-- ============================================================
create or replace function public.manual_values_can_save(p_application_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(staff_can_access(p_application_id)
    and notice_is_assigned_ao(p_application_id)
    and document_request_stage_ok(p_application_id)
    and staff_name(auth.uid()) is not null, false);
$$;
revoke execute on function public.manual_values_can_save(bigint) from public, anon;
grant execute on function public.manual_values_can_save(bigint) to authenticated;

-- ============================================================
-- 7. save_manual_document_values(): the assigned Account Officer
-- ============================================================
-- Returns the new row's id. Labels and values are stored trimmed.
create or replace function public.save_manual_document_values(p_document_id bigint, p_entries jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_doc documents;
  v_problem text;
  v_clean jsonb;
  v_last jsonb;
  v_id bigint;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or not staff_can_access(v_doc.application_id) then raise exception 'File not found'; end if;
  perform 1 from loan_applications where id = v_doc.application_id for update;
  if not notice_is_assigned_ao(v_doc.application_id) then
    raise exception 'Only the assigned Account Officer can type values for this file';
  end if;
  if staff_name(auth.uid()) is null then
    raise exception 'Fill in your staff profile (first and last name) before saving';
  end if;
  if not (v_doc.document_type = any (manual_value_document_types())) then
    raise exception 'Values are typed by hand only for SPA, SEC / DTI / Mayor''s permit and Other files; the AI reads this one';
  end if;
  if v_doc.superseded_at is not null then
    raise exception 'A newer copy of this file was uploaded: type the values for that one';
  end if;
  if not document_request_stage_ok(v_doc.application_id) then
    raise exception 'Typed values can be changed while the file is in Intake, Credit Investigation, Credit Evaluation or Review';
  end if;
  v_problem := manual_values_problem(p_entries);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select coalesce(jsonb_agg(jsonb_build_object('label', btrim(e->>'label'), 'value', btrim(e->>'value')) order by n), '[]'::jsonb)
  into v_clean
  from jsonb_array_elements(p_entries) with ordinality as t (e, n);

  select entries into v_last from document_manual_values where document_id = p_document_id order by id desc limit 1;
  if v_last is not distinct from v_clean or (v_last is null and v_clean = '[]'::jsonb) then
    raise exception 'Nothing changed since the last save';
  end if;

  insert into document_manual_values (document_id, application_id, entries, saved_by)
  values (p_document_id, v_doc.application_id, v_clean, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_manual_document_values(bigint, jsonb) from public, anon;
grant execute on function public.save_manual_document_values(bigint, jsonb) to authenticated;
