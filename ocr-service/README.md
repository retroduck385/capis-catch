# CATCH OCR worker (PaddleOCR + Claude field extraction)

Two steps per uploaded ID, COE / ITR, payslips / remittances and bank statement:

1. **OCR** (PaddleOCR, local): every text line + its box + confidence goes to `ocr_lines`, the page sizes to `ocr_pages`.
2. **AI extraction** (Claude API, Anthropic): the OCR **text** already in the database is sent to Claude (never the file), which labels it into the fields in `extraction_field_defs` (name, DOB, employer, gross pay per period, deposits per month, ...). The answer is a **proposal** in `extraction_fields`; nothing touches the application until the assigned AO checks it on **Document check** (`/documentCheckPage?id=<app>`, linked from the loan folder) and clicks *Confirm & lock*.

Flow: upload → trigger queues a `PENDING` row in `ocr_runs` → worker OCRs it and marks it `DONE` → trigger queues a `PENDING` row in `extraction_runs` → worker sends the lines to Claude and saves the fields with `save_extraction()` (or marks the run `FAILED` with the error). A failed OCR or AI step is tried once more after 10 s; only a second failure is saved as `FAILED`, and the page then tells staff to ask the applicant for a clearer copy (AO) or upload the report again (CI). There is no "Run AI again" button.

Files an applicant sends through a document request whose type isn't read on upload (Other, SPA, SEC / DTI / Mayor's permit) get an OCR run only (`20261118_request_uploads_ocr.sql`), so the AO sees in the request box whether they could be read. The AI step is never queued for them: no text of theirs goes to Claude.

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

### If every file fails with a oneDNN error

On some CPUs PaddlePaddle's oneDNN (MKLDNN) path fails on every file with
`(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]`.
Add `OCR_DISABLE_MKLDNN=1` to `ocr-service/.env` and restart the worker: PaddleOCR then runs without oneDNN
(slower, same results) and the worker prints "OCR: oneDNN (MKLDNN) off" on the first file. Leave it unset everywhere
else; the default is unchanged.

The request uses structured outputs (the answer must match the field schema built from `extraction_field_defs`), effort `low`, and, on the models that support it, server-side refusal fallbacks (`fallbacks: "default"`); `extraction_runs.model` records the model that actually answered. Only **synthetic test documents** go through it (CATCH rule).

Run `catch/supabase/migrations/20261007_id_ocr.sql` in the Supabase SQL Editor (after `20261007_ao_kyc_verification.sql`), then `20261010_ocr_income_docs.sql`, and (after `20261108_ci_results.sql`) `20261108_ocr_realtime.sql`, then `20261109_ai_extraction.sql` and `20261109_ci_extraction.sql` (NFIS / TU extraction).

## AI suggestion for the Credit Officer (`advise.py`)

> **Synthetic test files only.** The figures of a file and short excerpts of the bank's policy passages go to the
> Claude API, an external model. Don't use "Ask AI for a suggestion" on real applicant files until the data privacy
> question (Q-04) is cleared. Same rule as the AI extraction.

The assigned Credit Officer presses **Ask AI for a suggestion** under the Credit Result of the Financial Package
(`20261120_credit_ai_suggestions.sql`). The page sends the saved figures by borrower role (no names, birth dates,
addresses, contact details, employer / bank names, ID / account / title numbers or CI summaries; the Condition score
criteria only as a sub-total, never gender, civil status, dependents, residence type or length of stay). The database
refuses an input with personal fields and only accepts a request with a finished policy check run on the same figures.

This worker picks it up when the OCR and extraction queues are empty (Realtime wakes it), adds the policy check result
and up to 10 cited passages cut to about 700 characters, and asks Claude (`ANTHROPIC_MODEL`, effort `medium`,
structured output) for a suggested result (Endorsed / Not endorsed / Deferred), 2 to 5 reasons that each cite a
passage by `chunk_key`, a draft justification and missing data. Reasons that cite a passage it wasn't given are
dropped and noted. Peso amounts are sent with cents (₱2,500,000.00; the stored input keeps plain numbers), the
model is told to write them the same way, and any amount it still writes without cents is corrected. The row keeps what was sent, the model and the tokens; the Credit Officer who asked gets
`AI_SUGGESTION_READY`. A failure is retried once, a rate limit goes back to the queue. Without `ANTHROPIC_API_KEY`
requests stay `QUEUED` and the panel says so. The suggestion never sets the credit result.

Cost: about 4,000 to 8,000 input and 1,500 to 4,000 output tokens (thinking included), about $0.07 to $0.10 per
suggestion on `claude-opus-5-5` ($4 / $20 per million tokens); about half on `claude-sonnet-5-5`.

Policy passage fields used (only `policy_passages()` reads them): `chunk_key` and `excerpt` (required), `document`,
`heading_path`, `manual_pages`, `revision_date`, from `criteria[].source`, `manual_checks[].source`,
`suggested_exceptions[].citations`, `reasoning.approval_path.passages` and `policy_context` of the latest policy check.

Tests (no API calls): `python -m unittest discover -s tests`.

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

**CI reports** (NFIS / TU uploaded by the Credit Investigator, `20261108_ci_results.sql`) are queued only when the CI presses **Run AI** (`request_ci_ocr(<ci_document_id>)`, `20261125_ci_ocr_opt_in.sql`; uploading no longer queues them). That run has `ci_document_id` set instead of `document_id`. Same bucket (files at `ci/{application_id}/...`), so the worker needs no change. In `ocr_run_text` they show as `document_type` `CI_NFIS` / `CI_TU` with `ci_document_id` filled. Re-OCR one: `select requeue_ci_ocr(<ci_document_id>);`.

**CI report extraction** (`20261109_ci_extraction.sql`): NFIS and TU reports go through the same AI queue. Claude also drafts the CI result (`output.proposed_result`: `NO_ADVERSE_FINDINGS` / `WITH_FINDINGS`) and a short `output.findings_summary`, facts only. A Credit Investigator checks it on the CI report check page (`/documentCheckPage?id=<app>&ci=1`, "AI check" next to each file on the CI request page), edits it and confirms with `confirm_ci_extraction()`, which writes `ci_checks.result` / `summary` for that borrower × check. CI extractions never write to the application record; identity, IDs and accounts are only compared with it on the page.

`line_no` is PaddleOCR's reading order. On tables (payslips) a slightly tilted photo can interleave the columns, so pair labels with amounts using `bbox`, not `line_no`.

Test with synthetic documents only — never real borrower documents.
