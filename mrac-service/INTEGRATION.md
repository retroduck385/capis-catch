# Merging into CATCH

This folder is built to drop into the `capis-catch` repo **without changing any existing file except one
(two lines plus one JSX block in `financialPackagePage.jsx`)**. Nothing here has been merged yet.

## 1. What goes where

| This folder | CATCH repo | Notes |
|---|---|---|
| `supabase/migrations/20261105_mrac_rag.sql` | `catch/supabase/migrations/` | Run after `20261029_applicant_notices.sql`. Stops early if an earlier migration is missing. |
| `supabase/migrations/20261109_mrac_search_products.sql` | `catch/supabase/migrations/` | Run after the one above. Adds the product filter to `search_policy`. |
| `catch/src/pages/mrac/*` (4 files) | `catch/src/pages/mrac/` | New folder, nothing overwritten. |
| everything else (`worker.py`, `mrac/`, `rules/`, `samples/`, `tests/`, `requirements.txt`, `.env.example`) | `mrac-service/` at the repo root | Sibling of `ocr-service/` and `notice-service/`. |
| `supabase/dev/*` | **do not copy** | Dev stubs for a separate test project, and the rollback script. |

## 2. The one edit in existing code: `catch/src/pages/financialPackage/financialPackagePage.jsx`

Add the import with the others:

```jsx
import MracPanel from '../mrac/mracPanel';
```

Add the panel in the JSX, next to `V. Exception/s` (all of these variables already exist on that page):

```jsx
<MracPanel app={app} computed={computed} score={score} pricing={form.pricing} exceptions={form.exceptions}
    canEdit={canEdit} onAddException={(row) => onList('exceptions')([...form.exceptions, row])} />
```

Adding an exception goes through your normal `change()`, so the page becomes "unsaved" and the CO still saves it.
Optional, anywhere staff can see (for example `adminHomePage.jsx`): `import PolicyAsk from '../mrac/policyAsk';` then `<PolicyAsk />`.

## 3. Facts contract (what the app sends, what rules can test)

`facts.js` builds this from numbers the FP page already has. `mrac_criteria.field` must be one of these keys.
Missing values are `null` and become "needs review", never "pass".

| Key | Source | Unit |
|---|---|---|
| `dbr` | `computeFp().dbr` | ratio (0.40 = 40%) |
| `lcr` | `computeFp().lcr` | ratio |
| `amortization`, `total_gross_income`, `existing_monthly_debt`, `collateral_value` | `computeFp()` | PHP |
| `loan_amount`, `loan_term_years`, `interest_rate` | application / pricing | PHP / years / % |
| `age`, `age_at_maturity` | principal DOB, submission date, term | years |
| `tenure_years` | principal's `employment_date` | whole years |
| `scorecard_total`, `scorecard_complete` | `totalCreditScore()` (only when fully scored) | points |
| `borrower_count`, `existing_exception_count`, `employment_type`, `property_type` | application | |

To add a fact: add one line in `facts.js`. The migration and worker need no change.

### Facts the housing RAAC needs that CATCH does not collect yet
`employment_status`, `business_years`, `net_income_after_tax`, `has_replevin_or_foreclosure`. Until a form field or the CI
report supplies them, those rules report `needs_review` (missing data). `dbr_standalone` (the principal's DBR on his/her own income) is
derived in `facts.js` from `computeFp().incomes`.

## 4. Run order

1. Run the migration (SQL editor or `supabase db push`). Optionally run the seed.
2. `cd mrac-service`, copy `.env.example` to `.env`, fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Use a Python 3.13 venv (same as `ocr-service`): `pip install -r requirements.txt`.
4. Load the RAAC and the three policy PDFs (details in section 4b below). One `--out` folder each:
   `python -m mrac.ingest.parse_raac Housing-Loan_RAAC.ods --effective-from YYYY-MM-DD --out out/raac`,
   `python -m mrac.ingest.parse_policy <file>.pdf --code CPM|CCD|RED --out out/<code>`, then
   `python -m mrac.ingest.load_chunks out/<folder>/draft_chunks.jsonl` for each.
5. Load the draft criteria: `python -m mrac.ingest.load_criteria rules/housing_raac_draft.json` (all disabled). Credit policy enables
   them one by one: `update mrac_criteria set enabled = true where code = 'RAAC-DBR';`
6. Start the worker: `python worker.py`.
7. Open an application's Financial Package as its assigned CO and press **Check against policy**.

## 4b. Loading the three policy PDFs

| File | `--code` | Expected chunks | What it adds |
|---|---|---|---|
| Credit Policy Manual | `CPM` | about 757 | general rules, exceptions, approval limits (mostly business loans; housing appears in places) |
| Consumer Credit Operations Manual | `CCD` | about 93 | housing process, DBR by product, credit risk rating, housing approving authority |
| RED Operations Manual | `RED` | about 102 | newest housing approval table (p. 23), exception approvals; mostly business / developer |

```
python -m mrac.ingest.parse_policy "Credit Policy Manual.pdf" --code CPM --out out/cpm
python -m mrac.ingest.parse_policy "Consumer-Credit-Operations-Manual....pdf" --code CCD --out out/ccd
python -m mrac.ingest.parse_policy "red_operations_manual....pdf" --code RED --out out/red
```
Read each `out/<code>/report.txt`: only cover and contents pages should be listed as having no section header.
Then load them (the first time takes minutes, because every chunk is embedded):
```
python -m mrac.ingest.load_chunks out/cpm/draft_chunks.jsonl
python -m mrac.ingest.load_chunks out/ccd/draft_chunks.jsonl
python -m mrac.ingest.load_chunks out/red/draft_chunks.jsonl
```
Check: `select document, count(*) from policy_chunks group by 1;`

**Switch to real embeddings first** (`pip install sentence-transformers`, `EMBEDDING_PROVIDER=local` in `.env`). The hash stub is not
semantic and a database must not mix providers: re-load the RAAC chunks with the same provider (re-running `load_chunks`
refreshes draft rows). Load everything (about 970 chunks): it is small, and the product filter keeps auto, consumer and
business-only clauses out of housing results. Do not commit `out/`: it holds the bank's policy text.

After credit policy reviews a document: `update policy_chunks set status = 'approved' where document = '<file name>';`

## 4c. The reasoning
Each check returns a `reasoning` block (shown in the panel): a headline, one sentence per criterion with the numbers and the
policy clause, what to do next, and the housing approval-limit clauses of every loaded document, newest first, with a note when
documents differ. It is built from templates, with no LLM, so nothing leaves your environment. It says what the policy requires
and whether the application meets it (`MEETS_AUTOMATED_CRITERIA`, `EXCEPTION_REQUIRED`, `MANDATORY_CRITERION_NOT_MET`,
`CANNOT_CONCLUDE`). It never says approve or decline: exceptions and below-score cases belong to the delegated approving body.

## 5. Decisions to make while merging

- **Read `OPEN_QUESTIONS.md` first.** It lists contradictions between the RAAC and the manuals (DBR gross vs net, which loans count, the
  approval ladder) that decide whether a rule should be enabled as written.
- **Where each threshold lives.** `RAAC-DBR` and `POLICY-SCORE-ACCEPTABLE` repeat numbers that `creditScore.js` hard-codes (DBR 40%, score 55). Once real MRAC criteria exist, decide whether the scorecard or `mrac_criteria` is the source, so they can't drift.
- **Who may run a check.** `request_mrac_check` uses `co_can_edit` (assigned CO). Change that one line to widen it.
- **Draft policy text.** All chunks start as `draft` and are shown as "unreviewed". After a reviewer approves them
  (`update policy_chunks set status = 'approved' where ...`) set `RAG_INCLUDE_DRAFT=false` in the worker's `.env`.
- **Audit.** Each `mrac_runs` row keeps the facts it ran on and its result, and clients cannot edit it. If you also want
  these in the change history, add the `log_application_change` trigger to `mrac_runs` (not done here: it is untested
  against rows with no `application_id`).
- **NDA / data.** The policy text is embedded by a local model and nothing is sent to an external API. There is no LLM
  in this module. Keep it that way unless the bank approves.

## 6. Undo

`supabase/dev/99_rollback.sql` drops what the migration created. Delete the `mrac` folder and the two JSX lines.
