# AI field extraction and its confirmation

Date: 2026-11-11 (built by a teammate 2026-11-09 / 2026-11-10, on main). Status: decided by implementation. Covers F14 / F15, hard rule 4 and Q-06.

## Decided (by implementation)
- **The model never sees the file.** PaddleOCR reads the document locally (`decisions/ocr-engine.md`); the OCR worker then sends only the saved text lines to the Claude API, which labels them into fields. Provider: Anthropic. Default model `claude-opus-5-5`, overridable with `ANTHROPIC_MODEL`; the key is `ANTHROPIC_API_KEY` in `ocr-service/.env`. With no key, extraction runs stay queued. The two migrations' comments still say Gemini; the code uses Claude.
- **Documents:** application uploads Valid ID / Passport, COE / ITR, Payslips / remittances, Bank statements; CI reports NFIS and TU. BRAS is not extracted.
- **Staging first (hard rule 4).** Every AI value is a proposal in `extraction_runs` / `extraction_fields` (with the OCR lines it came from), not in the application record. This replaces the planned `extraction_staging` table.
- **Who confirms (Q-06, decided by implementation):** the assigned AO confirms applicant documents on `/documentCheckPage`, side by side with the document; for each value that differs from what the applicant typed, the AO keeps the application value or takes the document's. "Confirm & lock" (`confirm_extraction()`) writes the picked values to the record. Any active CI confirms NFIS / TU reports while the file is in Credit Investigation (`confirm_ci_extraction()`); the AI also proposes the CI result and summary, which the CI edits; only the confirmation writes `ci_checks`. CI extractions never write to the application record.
- **Audit:** a run finishing or failing and every confirmation are written to `audit_log` (agent executions and human confirmations, hard rule 6).

## Built (main)
- `catch/supabase/migrations/20261109_ai_extraction.sql`, `20261109_ci_extraction.sql`; `ocr-service/extract.py`, `worker.py`; front end `src/pages/documentCheck/`.
- Flow: upload → `ocr_runs` → OCR lines → a trigger queues `extraction_runs` → the worker labels the lines → `save_extraction()` → the AO (or CI) confirms.

## Watch out
- Only synthetic documents may go to the external model (P3.2.2.4); the OCR text of real documents would leave the machine. Pending Q-04.
- No notification exists for "ready to check" or "AI failed"; the AO sees the state on the document check page only.
- Re-running `20261007_id_ocr.sql` or `20261010_ocr_income_docs.sql` needs `20261109_ai_extraction.sql` and then `20261109_ci_extraction.sql` again.
