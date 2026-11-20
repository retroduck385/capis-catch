-- CATCH — let staff queue a fresh AI extraction on an existing OCR run (testing / re-read) (2026-11-21)
-- Run after 20261109_ai_extraction.sql (needs extraction_runs and ocr_runs).
-- Re-runnable. Adds one security-definer RPC; no data is dropped.
--
-- Decided 2026-11-21 (Dobbe): staff need a "Run again" button on the Document check page so they can
-- test the Major/Minor severity tags without uploading a new file. The authenticated role cannot INSERT
-- into extraction_runs directly (the worker uses the service role); this function does it safely after
-- confirming the caller can see the application the OCR run belongs to.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.extraction_runs') is null then
    raise exception 'Run 20261109_ai_extraction.sql first, then this file again.';
  end if;
end $$;

-- ============================================================
-- 1. RPC
-- ============================================================
create or replace function public.request_rerun_extraction(p_ocr_run_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_app_id bigint;
  v_new_id bigint;
begin
  -- make sure the caller can see the application this OCR run belongs to
  select d.application_id into v_app_id
  from ocr_runs o
  join documents d on d.id = o.document_id
  where o.id = p_ocr_run_id;

  if v_app_id is null then
    raise exception 'OCR run not found or not linked to a document.';
  end if;

  if not staff_can_access(v_app_id) then
    raise exception 'Access denied.';
  end if;

  insert into extraction_runs (ocr_run_id) values (p_ocr_run_id) returning id into v_new_id;
  return v_new_id;
end $$;

grant execute on function public.request_rerun_extraction(bigint) to authenticated;
