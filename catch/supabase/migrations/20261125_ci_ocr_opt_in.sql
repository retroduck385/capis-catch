-- CATCH — CI reports are read by the AI only when the Credit Investigator asks ("Run AI") (2026-11-22)
-- Run after 20261124_review_endorse_guard.sql (needs 20261108_ci_results.sql and 20261109_ci_extraction.sql).
-- Re-runnable, no drops of data.
--
-- Decided with Josh (2026-11-22):
--   * Uploading an NFIS / TU report no longer queues OCR. The CI presses "Run AI" on the file when they want
--     the AI to draft the values; otherwise they choose the result and type the findings themselves.
--   * The rest of the chain is unchanged: OCR finishes -> queue_extraction_run() queues the AI -> the CI checks and
--     confirms on the CI report check page. Nothing reaches ci_checks without that confirmation.
--   * Every request is in audit_log (table ocr_runs, who asked); the AI run and the confirmation are logged as before.
--   * Files already uploaded keep their OCR / AI runs. A file the AI has never read can be read once from here; a
--     failed read can be tried again (a new OCR run). A confirmed report stays locked, as before.
--
-- Re-runs of earlier files:
--   * 20261108_ci_results.sql re-run -> the upload trigger comes back: run this file again afterwards.

-- ============================================================
-- 0. Dependencies
-- ============================================================
do $$
begin
  if to_regclass('public.ci_documents') is null or to_regprocedure('public.request_ci_extraction(bigint)') is null then
    raise exception 'Run 20261108_ci_results.sql and 20261109_ci_extraction.sql first, then this file again';
  end if;
end $$;

-- ============================================================
-- 1. No OCR on upload
-- ============================================================
drop trigger if exists queue_ci_ocr_run on public.ci_documents;

-- ============================================================
-- 2. "Run AI": the Credit Investigator queues OCR for one report (the AI extraction follows by itself)
-- ============================================================
-- Refuses when the report is confirmed (locked), already being read, or already read (open it on the check page;
-- its own "Run again" covers a re-read of the same scan). A file whose last OCR or AI step FAILED can be read again.
create or replace function public.request_ci_ocr(p_ci_document_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_doc ci_documents;
  v_app bigint;
  v_ocr ocr_runs;
  v_ai extraction_runs;
  v_id bigint;
begin
  select * into v_doc from ci_documents where id = p_ci_document_id;
  if not found then raise exception 'File not found.'; end if;
  v_app := ci_borrower_application(v_doc.applicant_id);
  if v_app is null or not ci_can_edit(v_app) then perform ci_extraction_refuse(); end if;
  perform 1 from loan_applications where id = v_app for update;  -- same lock as the other CI writes
  if not ('CI_' || v_doc.check_type::text) = any (extraction_document_types()) then
    raise exception 'The AI does not read % reports.', v_doc.check_type;
  end if;
  if extraction_locked(null, p_ci_document_id) then
    raise exception 'This report was already confirmed and is locked. Upload it again to read it again.';
  end if;

  select * into v_ocr from ocr_runs where ci_document_id = p_ci_document_id order by id desc limit 1;
  if v_ocr.id is not null then
    if v_ocr.status in ('PENDING', 'RUNNING') then raise exception 'The AI is already reading this report.'; end if;
    if v_ocr.status = 'DONE' then
      select * into v_ai from extraction_runs where ocr_run_id = v_ocr.id order by id desc limit 1;
      if v_ai.id is null or v_ai.status <> 'FAILED' then
        raise exception 'This report was already read. Open it on the CI report check page.';
      end if;
    end if;
  end if;

  insert into ocr_runs (ci_document_id) values (p_ci_document_id) returning id into v_id;
  -- Audit trail: who asked the AI to read which report (the run's results are logged by log_extraction_run)
  insert into audit_log (application_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (v_app, 'ocr_runs', v_id, 'INSERT', null,
          jsonb_build_object('document', v_doc.file_name, 'requested', 'Run AI'), auth.uid());
  return v_id;
end $$;

revoke execute on function public.request_ci_ocr(bigint) from public, anon;
grant execute on function public.request_ci_ocr(bigint) to authenticated;
