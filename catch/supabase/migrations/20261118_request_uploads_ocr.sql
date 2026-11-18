-- CATCH — read (OCR) every file an applicant sends through a document request, and drop BRAS from the reviewer
-- checklist hint (group meeting follow-ups, part A, 2026-11-18)
-- Run after 20261116_findings_and_file_marks.sql (needs 20261112_document_requests.sql, 20261109_ai_extraction.sql and
-- 20261108_reviewer_signoff.sql). Re-runnable, no drops of data.
--
-- What it does
--   1. Files sent through a document request ("What we need") whose type is not read on upload (Other, SPA,
--      SEC / DTI / Mayor's permit) get one OCR run, so the Account Officer sees in the request box whether the file
--      could be read. ID, COE / ITR, payslip and bank statement uploads are already queued by queue_ocr_run() on
--      documents; this trigger leaves them alone. Never more than one run per file from here.
--   2. The AI step is never queued for these types: they have no field list, so no OCR text is sent to the Claude
--      API. A guard on extraction_runs skips any run whose document type is not one that is read on upload
--      (ocr_document_types()). CI reports (NFIS / TU) are not touched by the guard.
--   3. The reviewer checklist hint "CI results reflected in IV. Credit Checking" no longer mentions BRAS.
--      Old BRAS rows in ci_checks / ci_documents stay in the database; the app just never shows or asks for them.
--
-- No existing function of another module is changed. Both new functions are trigger functions only.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
declare
  v_missing text;
begin
  select string_agg(m, ', ') into v_missing
  from (values ('public.document_request_uploads', '20261112_document_requests.sql'),
               ('public.extraction_runs', '20261109_ai_extraction.sql'),
               ('public.review_check_items', '20261108_reviewer_signoff.sql')) d (t, m)
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'Run these migrations first, then this file again: %', v_missing;
  end if;
end $$;

-- ============================================================
-- 1. OCR for requested files of the other types
-- ============================================================
create or replace function public.queue_request_upload_ocr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into ocr_runs (document_id)
  select d.id from documents d
  where d.id = new.document_id
    and not (d.document_type = any (ocr_document_types()))
    and not exists (select 1 from ocr_runs o where o.document_id = d.id);
  return new;
end $$;
revoke execute on function public.queue_request_upload_ocr() from public, anon, authenticated;

drop trigger if exists queue_request_upload_ocr on public.document_request_uploads;
create trigger queue_request_upload_ocr
  after insert on public.document_request_uploads
  for each row execute function public.queue_request_upload_ocr();

-- Backfill: requested files of these types uploaded before this migration
insert into public.ocr_runs (document_id)
select d.id
from public.document_request_uploads u
join public.documents d on d.id = u.document_id
where not (d.document_type = any (public.ocr_document_types()))
  and not exists (select 1 from public.ocr_runs o where o.document_id = d.id);

-- ============================================================
-- 2. Never queue the AI step for a document type that has no reading on upload
-- ============================================================
create or replace function public.skip_ai_for_unread_types() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from ocr_runs o join documents d on d.id = o.document_id
             where o.id = new.ocr_run_id and not (d.document_type = any (ocr_document_types()))) then
    return null;   -- skipped: nothing to fill, nothing sent to the AI
  end if;
  return new;
end $$;
revoke execute on function public.skip_ai_for_unread_types() from public, anon, authenticated;

drop trigger if exists skip_ai_for_unread_types on public.extraction_runs;
create trigger skip_ai_for_unread_types
  before insert on public.extraction_runs
  for each row execute function public.skip_ai_for_unread_types();

-- ============================================================
-- 3. Reviewer checklist hint without BRAS
-- ============================================================
update public.review_check_items
set hint = 'NFIS / TU findings are reflected; loans the CI found are counted in (C) / DBR.'
where code = 'CREDIT_CHECKS' and hint like '%BRAS%';
