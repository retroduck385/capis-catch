# CATCH notice worker (applicant outcome notices: SMS + email)

Sends the outcome notices the Account Officer queues with "Send notice to applicant" in the loan folder.
SMS through Semaphore, email through Brevo. The in-app notice is created by the database right away; this worker only
handles SMS and email. Staff notifications stay in-app only.

Flow: the AO sends a notice → `send_applicant_notice()` saves it and queues one `applicant_notice_deliveries` row per channel
→ this worker claims them (`claim_notice_deliveries()`), checks the text again for links (`notice_link_in()`), sends or prints it,
and records the result (`finish_notice_delivery()`: LOGGED / SENT, or FAILED, retried until the third attempt).
The AO sees each channel's status in the panel.

## Modes
- `NOTICE_MODE=log` (default): nothing is sent. Each SMS / email is printed and marked LOGGED. No provider keys needed.
- `NOTICE_MODE=live`: sends for real, but only to the numbers / addresses in `NOTICE_LIVE_ALLOWLIST` (the team's own),
  until the Data Privacy sessions clear sending to applicants (Q-04). Anything else is printed and marked LOGGED.
  `NOTICE_LIVE_ALLOWLIST=yes-q04-cleared` sends to everyone: only once Q-04 is cleared.

No message ever contains a link: the database refuses a reason with one, and the worker checks again before sending.

## Setup (once)
```bash
cd notice-service
python -m venv .venv                      # any Python 3.10+
.venv/Scripts/python -m pip install -r requirements.txt     # Windows; on macOS / Linux: .venv/bin/python
cp .env.example .env                      # then fill in SUPABASE_URL and the service role key
```
Keys live only in `notice-service/.env` (gitignored). The frontend never gets them.
Needs `catch/supabase/migrations/20261029_applicant_notices.sql` run in the Supabase SQL Editor.

## Run
```bash
.venv/Scripts/python worker.py --preview   # print what is queued; claim and send nothing
.venv/Scripts/python worker.py --once      # process the current queue, then exit
.venv/Scripts/python worker.py             # keep polling every 10 s
```

## Providers (prices checked 2026-10-29; confirm in each dashboard)
- **Semaphore (SMS)**: 1 credit per 160-character SMS, about PHP 0.56 a credit (its FAQ says VAT included, its homepage says
  ex. VAT). Long messages are billed per part. The sender name ("CATCH") must be approved by Semaphore; until then leave
  `SEMAPHORE_SENDER_NAME` empty.
- **Brevo (email)**: free plan, 300 emails a day, single verified sender (no domain needed). Without an authenticated domain
  Brevo may rewrite the From address and inbox placement is weaker. Plain-text email only.
