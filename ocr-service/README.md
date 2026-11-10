# CATCH OCR worker (PaddleOCR + Claude field extraction)

Two steps per uploaded ID, COE / ITR, payslips / remittances and bank statement:

1. **OCR** (PaddleOCR, local): every text line + its box + confidence goes to `ocr_lines`, the page sizes to `ocr_pages`.
2. **AI extraction** (Claude API, Anthropic): the OCR **text** already in the database is sent to Claude (never the file), which labels it into the fields in `extraction_field_defs` (name, DOB, employer, gross pay per period, deposits per month, ...). The answer is a **proposal** in `extraction_fields`; nothing touches the application until the assigned AO checks it on **Document check** (`/documentCheckPage?id=<app>`, linked from the loan folder) and clicks *Confirm & lock*.

Flow: upload → trigger queues a `PENDING` row in `ocr_runs` → worker OCRs it and marks it `DONE` → trigger queues a `PENDING` row in `extraction_runs` → worker sends the lines to Claude and saves the fields with `save_extraction()` (or marks the run `FAILED` with the error; the AO can press *Run AI again*).

## Setup (once)

PaddlePaddle has no Python 3.14 wheels yet, so the worker uses its own Python 3.13 venv.

```bash
cd ocr-service
pip3 install uv                       # or: curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env                  # then paste the service role key and the Anthropic API key
```

### Where the API key goes

`ocr-service/.env` (gitignored), **never** `catch/.env`: anything `VITE_*` there is bundled into the browser.

```
ANTHROPIC_API_KEY=...     # from https://platform.claude.com/settings/keys
ANTHROPIC_MODEL=          # optional, default claude-opus-5-5 (claude-sonnet-5-5 / claude-haiku-5-5 are cheaper)
```

Without `ANTHROPIC_API_KEY` the worker still OCRs; extraction runs just wait in the queue until you add the key and restart.

The request uses structured outputs (the answer must match the field schema built from `extraction_field_defs`), effort `low`, and, on the models that support it, server-side refusal fallbacks (`fallbacks: "default"`); `extraction_runs.model` records the model that actually answered. Only **synthetic test documents** go through it (CATCH rule).

Run `catch/supabase/migrations/20261007_id_ocr.sql` in the Supabase SQL Editor (after `20261007_ao_kyc_verification.sql`), then `20261010_ocr_income_docs.sql`, and (after `20261108_ci_results.sql`) `20261108_ocr_realtime.sql`, then `20261109_ai_extraction.sql` and `20261109_ci_extraction.sql` (NFIS / TU extraction).

## Run

```bash
.venv/bin/python worker.py                 # idle until an upload, then OCR it right away
.venv/bin/python worker.py --poll          # old behaviour: check the queue every 5 s, no Realtime
.venv/bin/python worker.py --once          # process the current queue, then exit
.venv/bin/python worker.py --file id.jpg   # OCR a local file, print lines, save nothing
.venv/bin/python worker.py --file coe.pdf --type COE_ITR   # ...and print what Claude extracts (saves nothing)
```

`--type` is one of `VALID_ID_PASSPORT`, `COE_ITR`, `PAYSLIPS_REMITTANCES`, `FS_BANK_STATEMENTS`, `CI_NFIS`, `CI_TU` (CI types also print the proposed CI result and summary). It reads the field list from Supabase, so run the migration first.

By default the worker subscribes to INSERTs on `ocr_runs` and `extraction_runs` via Supabase Realtime (`20261108_ocr_realtime.sql` adds the table to the publication), so it makes no queue calls while nothing is uploaded. It still checks the queue every 5 min (`--interval` to change) as a safety net for events missed while disconnected and for runs stuck in `RUNNING` (requeued after 15 min). If Realtime can't connect it says so and just runs on that slow check.

The first run downloads the models (~100 MB, to `~/.paddlex/`).

## Checking results in Supabase

- `ocr_run_text` (view): one row per run — file name, status, line count, average confidence, full text.
- `ocr_lines`: each line with confidence and bounding box (4 corner points, pixels).
- `ocr_runs`: status / error per attempt.

- `extraction_runs`: one row per AI attempt (status, model, tokens, raw answer in `output`, who confirmed).
- `extraction_fields`: the proposed value per field (`item_no` 0 = header, 1..n = row within its row list: pay period / month, or for TU the IDs, addresses, employers, accounts, inquiries — `extraction_field_defs.row_group`), then the AO's `final_value` and whether it was copied to the application (`apply_to_record`). `extraction_field_lines` links each value to the OCR lines it came from.

Re-OCR a document (new run, old one kept): `select requeue_ocr(<document_id>);` in the SQL Editor. A new OCR run is extracted again automatically unless the document's extraction was already confirmed (locked).

Queued types: `VALID_ID_PASSPORT`, `COE_ITR`, `PAYSLIPS_REMITTANCES`, `FS_BANK_STATEMENTS`; add more in `ocr_document_types()` (latest definition is in `20261109_ai_extraction.sql`). Fields per type: rows in `extraction_field_defs` (same migration) — add a row and the worker, prompt and page pick it up. `target_table` / `target_column` (whitelisted in the table's check constraint) is the application column the AO may update from it.

If the Claude API rate-limits (429), is overloaded (529) or is down, the run goes back to the queue and the AI step pauses for 60 s; OCR keeps going.

**CI reports** (NFIS / TU / BRAS uploaded by the Credit Investigator, `20261108_ci_results.sql`) are queued too: every row in `ci_documents` gets a run with `ci_document_id` set instead of `document_id`. Same bucket (files at `ci/{application_id}/...`), so the worker needs no change. In `ocr_run_text` they show as `document_type` `CI_NFIS` / `CI_TU` / `CI_BRAS` with `ci_document_id` filled. Re-OCR one: `select requeue_ci_ocr(<ci_document_id>);`.

**CI report extraction** (`20261109_ci_extraction.sql`): NFIS and TU reports go through the same AI queue (BRAS doesn't yet: no field list). Claude also drafts the CI result (`output.proposed_result`: `NO_ADVERSE_FINDINGS` / `WITH_FINDINGS`) and a short `output.findings_summary`, facts only. A Credit Investigator checks it on the CI report check page (`/documentCheckPage?id=<app>&ci=1`, "AI check" next to each file on the CI request page), edits it and confirms with `confirm_ci_extraction()`, which writes `ci_checks.result` / `summary` for that borrower × check. CI extractions never write to the application record; identity, IDs and accounts are only compared with it on the page.

`line_no` is PaddleOCR's reading order. On tables (payslips) a slightly tilted photo can interleave the columns, so pair labels with amounts using `bbox`, not `line_no`.

Test with synthetic documents only — never real borrower documents.
