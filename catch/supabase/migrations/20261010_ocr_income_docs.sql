-- CATCH — raw OCR for income documents too (COE / ITR, payslips / remittances)
-- Run after 20261007_id_ocr.sql. Re-runnable, no drops of data.
--
-- Same pipeline as the IDs: upload → PENDING row in ocr_runs → PaddleOCR worker → ocr_lines.
-- Still raw output only; nothing here touches the application record.
--
-- Note: re-running 20261007_id_ocr.sql resets the list below to IDs only — run this one again after it.

create or replace function public.ocr_document_types()
returns text[] language sql immutable as $$
  select array['VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES'];
$$;

-- Backfill: income documents uploaded before this migration that were never queued
insert into public.ocr_runs (document_id)
select d.id from public.documents d
where d.document_type = any (public.ocr_document_types())
  and not exists (select 1 from public.ocr_runs r where r.document_id = d.id);
