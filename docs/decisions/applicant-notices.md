# Applicant outcome notices

Date: 2026-10-29. Status: decided (the bank's answers to Q-42, visit 2026-10-26; user answers 2026-10-29) and built. Covers the decision and deferral notices, and F5 in part (SMS / email without links).

## Decided
- **The assigned AO sends the outcome notice**, never the system. Only once the status is APPROVED, REJECTED or DEFERRED. No head override.
- **Outcome and reason.** Rejected: the policy the applicant most likely did not pass. Deferred: what is missing. Approved: optional; empty means "Your Account Officer will contact you about the next steps." Plain text, at most 300 characters, the same on every channel.
- **One notice per outcome, plus corrections.** A correction is a new notice marked "Correction". Every notice is kept: `applicant_notices` is append-only (no edit or delete, owner and service role included). A file deferred again later needs a new notice.
- **What the applicant sees:** the outcome only after its notice; until then "Under review". FOR_CLARIFICATION stays "Incomplete submission". Submitted / Under review / Incomplete notices stay automatic; the automatic decision / deferral notices are removed.
- **Channels:** in-app at once (`APPLICANT_OUTCOME`), SMS and email queued. Principal borrower only: their mobile; their email, else the login email. Staff notifications stay in-app.
- **No links of any kind** in any channel. `send_applicant_notice()` refuses a reason with http(s)://, www., an email address or a name ending in a common top-level domain, and names the part; "St.Francis" / "Brgy.Malate" pass. The worker checks again before sending. Email is plain text. Sender name "CATCH", never the bank's name; no names or amounts in the text.
- **Reason suggestions** (shown to the AO only, never pre-filled): FP V. Exceptions policy, the CO's justification and deferrals, KYC checks marked Needs clarification, required documents not uploaded. Nothing records an approver's reason or a policy flag yet (no approver step, no RAG / MRAC).
- **Providers:** Semaphore for SMS, Brevo for email (free plan, single verified sender, because the group has no domain). Keys only in `notice-service/.env`.
- **Live sending waits for Q-04** (the Data Privacy sessions): the worker runs in log mode (prints, sends nothing). Live mode only reaches `NOTICE_LIVE_ALLOWLIST` (the team's own numbers and addresses) until Q-04 clears.
- **No new staff notification** when the AO sends; the notice and its delivery status show in the loan folder.

## Built
- `catch/supabase/migrations/20261029_applicant_notices.sql` (after `20261028_messages.sql`): `applicant_outcomes` (one row per change into an outcome), `applicant_notices`, `applicant_notice_deliveries`; `send_applicant_notice()`, `preview_applicant_notice()`, `applicant_notice_context()`, `my_application_statuses()`; `claim_notice_deliveries()` / `finish_notice_delivery()` for the worker (retried until the third attempt); `notice_link_in()`. Replaces three of `20261024_notifications.sql`'s own functions (`applicant_status_bucket`, `applicant_notification_kinds`, `notify_on_applicant_status`).
- Front end: `src/pages/applicantNotices/` (the AO's panel), `src/pages/notifications/applicantStatusLabel.jsx`; one import and one line in `loanFolderPage.jsx`; the label lines in `applicantHomePage.jsx`.
- `notice-service/`: Python worker (`worker.py`, `providers.py`), `--preview`, `--once`, log / live modes.
- Tested: 159 PGlite checks, 15 offline worker tests; click test 2026-10-29 in the shared project (worker step skipped: needs the service role key).

## Watch out
- Re-running `20261024_notifications.sql` puts its old status buckets, applicant kinds and switch rows back: run `20261029_applicant_notices.sql` again after it.
- Nothing sets APPROVED / REJECTED / DEFERRED yet. The click test set them by SQL on a synthetic application. When the approver decision is built, no change is needed here: the notice depends only on the status and the AO assignment.

## Still to come
- Live SMS / email (after Q-04), item-level deficiency notices (F5), the approver's policy-reason code as a reason source (1.4.2.5), RAG policy flags as a source (Q-19, Q-20).
