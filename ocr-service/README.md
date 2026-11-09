# CATCH OCR worker (PaddleOCR + Gemini field extraction)

Two steps per uploaded ID, COE / ITR, payslips / remittances and bank statement:

1. **OCR** (PaddleOCR, local): every text line + its box + confidence goes to `ocr_lines`, the page sizes to `ocr_pages`.
2. **AI extraction** (Gemini API): the OCR **text** already in the database is sent to Gemini (never the file), which labels it into the fields in `extraction_field_defs` (name, DOB, employer, gross pay per period, deposits per month, ...). The answer is a **proposal** in `extraction_fields`; nothing touches the application until the assigned AO checks it on **Document check** (`/documentCheckPage?id=<app>`, linked from the loan folder) and clicks *Confirm & lock*.

Flow: upload → trigger queues a `PENDING` row in `ocr_runs` → worker OCRs it and marks it `DONE` → trigger queues a `PENDING` row in `extraction_runs` → worker sends the lines to Gemini and saves the fields with `save_extraction()` (or marks the run `FAILED` with the error; the AO can press *Run AI again*).

## Setup (once)

PaddlePaddle has no Python 3.14 wheels yet, so the worker uses its own Python 3.13 venv.

```bash
cd ocr-service
pip3 install uv                       # or: curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env                  # then paste the service role key and the Gemini API key
```

### Where the API key goes

`ocr-service/.env` (gitignored), **never** `catch/.env`: anything `VITE_*` there is bundled into the browser.

```
GEMINI_API_KEY=...        # from https://aistudio.google.com/apikey
GEMINI_MODEL=             # optional, default gemini-3.8-flash
```

Without `GEMINI_API_KEY` the worker still OCRs; extraction runs just wait in the queue until you add the key and restart.

Free tier: Google may use what is sent to improve its products, so only **synthetic test documents** go through it (CATCH rule anyway). Use a paid key before any real data.

Run `catch/supabase/migrations/20261007_id_ocr.sql` in the Supabase SQL Editor (after `20261007_ao_kyc_verification.sql`), then `20261010_ocr_income_docs.sql`, and (after `20261108_ci_results.sql`) `20261108_ocr_realtime.sql`, then `20261109_ai_extraction.sql`.

## Run

```bash
.venv/bin/python worker.py                 # idle until an upload, then OCR it right away
.venv/bin/python worker.py --poll          # old behaviour: check the queue every 5 s, no Realtime
.venv/bin/python worker.py --once          # process the current queue, then exit
.venv/bin/python worker.py --file id.jpg   # OCR a local file, print lines, save nothing
.venv/bin/python worker.py --file coe.pdf --type COE_ITR   # ...and print what Gemini extracts (saves nothing)
```

`--type` is one of `VALID_ID_PASSPORT`, `COE_ITR`, `PAYSLIPS_REMITTANCES`, `FS_BANK_STATEMENTS`. It reads the field list from Supabase, so run the migration first.

By default the worker subscribes to INSERTs on `ocr_runs` and `extraction_runs` via Supabase Realtime (`20261108_ocr_realtime.sql` adds the table to the publication), so it makes no queue calls while nothing is uploaded. It still checks the queue every 5 min (`--interval` to change) as a safety net for events missed while disconnected and for runs stuck in `RUNNING` (requeued after 15 min). If Realtime can't connect it says so and just runs on that slow check.

The first run downloads the models (~100 MB, to `~/.paddlex/`).

## Checking results in Supabase

- `ocr_run_text` (view): one row per run — file name, status, line count, average confidence, full text.
- `ocr_lines`: each line with confidence and bounding box (4 corner points, pixels).
- `ocr_runs`: status / error per attempt.

- `extraction_runs`: one row per AI attempt (status, model, tokens, raw answer in `output`, who confirmed).
- `extraction_fields`: the proposed value per field (`item_no` 0 = header, 1..n = pay period / month), then the AO's `final_value` and whether it was copied to the application (`apply_to_record`). `extraction_field_lines` links each value to the OCR lines it came from.

Re-OCR a document (new run, old one kept): `select requeue_ocr(<document_id>);` in the SQL Editor. A new OCR run is extracted again automatically unless the document's extraction was already confirmed (locked).

Queued types: `VALID_ID_PASSPORT`, `COE_ITR`, `PAYSLIPS_REMITTANCES`, `FS_BANK_STATEMENTS`; add more in `ocr_document_types()` (latest definition is in `20261109_ai_extraction.sql`). Fields per type: rows in `extraction_field_defs` (same migration) — add a row and the worker, prompt and page pick it up. `target_table` / `target_column` (whitelisted in the table's check constraint) is the application column the AO may update from it.

If Gemini rate-limits (429) or is down, the run goes back to the queue and the AI step pauses for 60 s; OCR keeps going.

**CI reports** (NFIS / TU / BRAS uploaded by the Credit Investigator, `20261108_ci_results.sql`) are queued too: every row in `ci_documents` gets a run with `ci_document_id` set instead of `document_id`. Same bucket (files at `ci/{application_id}/...`), so the worker needs no change. In `ocr_run_text` they show as `document_type` `CI_NFIS` / `CI_TU` / `CI_BRAS` with `ci_document_id` filled. Re-OCR one: `select requeue_ci_ocr(<ci_document_id>);`.

`line_no` is PaddleOCR's reading order. On tables (payslips) a slightly tilted photo can interleave the columns, so pair labels with amounts using `bbox`, not `line_no`.

Test with synthetic documents only — never real borrower documents.
