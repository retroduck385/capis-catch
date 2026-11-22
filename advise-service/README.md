# CATCH advise worker (AI suggestion for the Credit Officer's credit result)

Answers **Ask AI for a suggestion** under the Credit Result of the Financial Package
(`catch/src/pages/aiSuggestion/`, `catch/supabase/migrations/20261120_credit_ai_suggestions.sql`). It used to live in
`ocr-service/`; it has its own worker now because it builds on the policy check (mrac-service), not on OCR.

## What it does
1. The assigned CO runs the **policy check** (mrac-service: rules + the policy recommender's cited findings) and reviews
   its findings (Accept / Edit, then add / Dismiss, `20261122_mrac_reviews.sql`).
2. The CO presses **Ask AI for a suggestion**. The page sends the saved figures by borrower role (no names, birth dates,
   addresses, contact details, employer / bank names, ID / account / title numbers or CI summaries; the Condition score
   only as a sub-total) plus the CI file checks as counts. The database refuses personal fields and only accepts a
   request with a finished policy check run on the same figures as now.
3. This worker claims it, reads the CO's reviews of that check (`mrac_finding_reviews`) and sends Claude:
   - `input`: the figures (money with cents: ₱2,500,000.00),
   - `rules`: the rule results,
   - `findings`: the recommender's **verified** findings (exception / obtain / condition, and up to 12 met), each with
     the CO's review: `ACCEPTED`, `EDITED` (the CO's text replaces the recommender's) or `NOT_REVIEWED`; plus the
     clauses of rule checks that aren't findings. Clause excerpts are cut to about 700 characters.
   - `dismissed`: headings of findings the CO dismissed (not the reason text), so they aren't raised again,
   - `approval`: whether approval with an exception is needed.
   Held-back (unverified) and not-applicable findings are never sent.
4. Claude (`ANTHROPIC_MODEL`, effort `medium`, structured output) returns a suggested result (Endorsed / Not endorsed /
   Deferred), 2 to 5 reasons that each cite a finding by `chunk_key`, a draft justification and missing data.
5. Code checks the answer (`advise.check_output`): reasons citing a finding that wasn't sent are dropped and noted;
   peso amounts get cents; money and percentages that appear nowhere in what was sent are **flagged** on the reason and
   on the draft (kept, but the panel tells the CO to check them); the number of findings not reviewed yet is noted.
6. The row keeps what was sent, the model and the tokens; the CO who asked gets `AI_SUGGESTION_READY`.

The suggestion never sets the credit result. A failure is retried once, a rate limit goes back to the queue.
If the policy check ran without the recommender (no API key in mrac-service, or an older check), the request fails
with "Run the policy check again".

The bank cleared sending de-identified application data to Claude (Q-04) on 2026-11-20. The filters stay as they are.

## Setup (once)
```bash
cd advise-service
python -m venv .venv                      # any Python 3.10+
.venv/bin/python -m pip install -r requirements.txt    # Windows: .venv/Scripts/python
cp .env.example .env                      # SUPABASE_URL, the service role key, ANTHROPIC_API_KEY (same key as ocr-service)
```
Needs these migrations run: `20261120_credit_ai_suggestions.sql`, and for the reviews `20261122_mrac_reviews.sql`
(without it every finding counts as not reviewed).

## Run
```bash
.venv/bin/python worker.py              # wait for requests (Realtime), fallback check every 5 min
.venv/bin/python worker.py --once       # process the queue, then exit
.venv/bin/python worker.py --show 12    # print what suggestion 12 would send (no Claude call, nothing saved)
```
Run it next to `ocr-service` and `mrac-service`. Without this worker running, requests stay "Waiting for the AI worker".

## Cost
Measured once (2026-11-22, fictional sample, 35 findings, `claude-opus-5-5`): 19,580 input / 1,531 output tokens,
15 s, about $0.11 per suggestion. The findings are most of the input; much less on `claude-haiku-5-5`.

## Tests (no API calls)
```bash
python -m unittest discover -s tests
```
