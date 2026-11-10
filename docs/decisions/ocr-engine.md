# OCR engine

Date: 2026-10-13. Status: decided by implementation. Changes the paper's stack (Sec. 3.2.4.2 names Claude Vision).

## Decided
OCR runs locally with PaddleOCR (3.7.0), not the Claude Vision API. Output is raw text lines only. There is no LLM field mapping yet, and nothing is written to the application record.

## Built (on main)
- `ocr-service/worker.py` and `ocr.py`: a Python worker that waits for new runs, downloads the file from Storage, runs PaddleOCR and saves each text line with confidence and bounding box. Since 2026-11-08 it is woken by Realtime INSERTs on `ocr_runs` (`20261108_ocr_realtime.sql`) and keeps a slow fallback poll.
- Since 2026-11-08 the CI's uploaded reports (`ci_documents`) go through the same queue (`20261108_ci_results.sql`), reported as document type `CI_NFIS` / `CI_TU` / `CI_BRAS`.
- Queue: a trigger on `documents` adds a PENDING row to `ocr_runs` for Valid ID / Passport, COE / ITR and Payslips / Remittances uploads. The worker claims runs with `claim_ocr_runs()` and writes `ocr_lines` (`20261007_id_ocr.sql`, `20261010_ocr_income_docs.sql`).
- The worker uses the service role key from `ocr-service/.env` (gitignored). Clients can only read OCR output, and only for applications they can access.

## Why (inferred)
Running locally means no document leaves the machine. That avoids the external-model restrictions still pending in Q-04, and it costs nothing per call.

## Since 2026-11-09
Field mapping is built: the worker sends the OCR text lines (never the file) to the Claude API, the values go to a staging table, and the AO (or the CI for NFIS / TU) confirms them. See `ai-extraction.md`.

## Still to come
- ~~Mapping OCR lines to form fields.~~ Built 2026-11-09 (`ai-extraction.md`).
- ~~The staging table and human confirmation step.~~ Built 2026-11-09 (`extraction_runs` / `extraction_fields`, `ai-extraction.md`).
- ~~Whether a vision LLM is still used for mapping is not decided.~~ A text model labels the OCR lines; no vision model sees the file.
