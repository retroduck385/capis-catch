# CATCH OCR worker (PaddleOCR)

Raw OCR of uploaded IDs. No LLM, no field mapping yet — every text line PaddleOCR finds is saved so extraction quality can be checked in Supabase.

Flow: applicant/AO uploads a Valid ID → trigger queues a `PENDING` row in `ocr_runs` → this worker claims it, downloads the file from Storage, runs PaddleOCR, writes the lines to `ocr_lines` and marks the run `DONE` (or `FAILED` with the error).

## Setup (once)

PaddlePaddle has no Python 3.14 wheels yet, so the worker uses its own Python 3.13 venv.

```bash
cd ocr-service
pip3 install uv                       # or: curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env                  # then paste the service role key
```

Run `catch/supabase/migrations/20261007_id_ocr.sql` in the Supabase SQL Editor (after `20261007_ao_kyc_verification.sql`).

## Run

```bash
.venv/bin/python worker.py                 # keep polling every 5 s
.venv/bin/python worker.py --once          # process the current queue, then exit
.venv/bin/python worker.py --file id.jpg   # OCR a local file, print lines, save nothing
```

The first run downloads the models (~100 MB, to `~/.paddlex/`).

## Checking results in Supabase

- `ocr_run_text` (view): one row per run — file name, status, line count, average confidence, full text.
- `ocr_lines`: each line with confidence and bounding box (4 corner points, pixels).
- `ocr_runs`: status / error per attempt.

Re-OCR a document (new run, old one kept): `select requeue_ocr(<document_id>);` in the SQL Editor.

Only `VALID_ID_PASSPORT` is queued for now; add types in `ocr_document_types()` in the migration.

Test with synthetic IDs only — never real borrower documents.
