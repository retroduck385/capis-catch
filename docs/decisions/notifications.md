# Notifications

Date: 2026-10-24. Status: decided by implementation. Covers F6 (Timely Workspace Notification Alerts) and the applicant status notices from the 2026-10-23 meeting. Updated 2026-10-28 with the bank's Q-42 answers (visit 2026-10-26), which are not built yet; see "Bank answers" below.

## Decided
- **In-app only.** No email or SMS (F5 is inferred in the paper and depends on Q-04).
- **One way in.** Every notification is created by `send_notification()` (security definer). Triggers, other SQL functions and the service role (OCR worker, FastAPI) can call it; the browser cannot. A frontend module needs its own permission-checked RPC.
- **Triggers on existing tables, no changes to existing functions.** `notify_*` triggers on `stage_status_changes`, `application_assignments`, `ci_requests`, `financial_packages`, `audit_log`, `review_assignments`, `loan_applications`. Each catches its own errors, so a failed notification never blocks a stage move.
- **Applicants see four statuses only:** Submitted / Incomplete submission / Under review / Decision (plus Draft). No internal stage, no names, no amounts. An approver's DEFERRED counts as "Incomplete submission" (at the bank a deferral usually means missing information). Applicants only ever receive the five `APPLICANT_*` kinds; the function refuses to send anything else to them.
- **Decision and deferral notices are built but switched off** (`notification_switches`). The built decision text never states the outcome or a reason; this no longer matches Q-42 (below), so keep both switches off until they are rebuilt.
- **Under review is announced once** per change into that status, not on every internal move.
- **Staff text** carries the application number only, never borrower names or amounts: a notification stays readable after its recipient loses access to the file.
- **Approvers** are notified when Approval opens (or when added during Approval), not when the CO sends the file for review.
- **New submissions** notify every active AO (switchable).
- **No notice for your own action** (claiming or releasing a file yourself sends nothing), except the applicant's own submission confirmation.

## Built
- `catch/supabase/migrations/20261024_notifications.sql`: `notifications`, `notification_switches`, `send_notification()`, `mark_notifications_read()`, seven `notify_*` triggers, `supabase_realtime` publication. Run in the shared project 2026-10-24.
- Front end: `src/components/notificationBell.jsx` (mounted once in `privateRoute.jsx`), `src/pages/notifications/{api.js, useNotifications.js, applicantStatus.js}`. Applicant home shows the four statuses.
- Tested: 86 PGlite checks; click test in the shared project 2026-10-24 (routing-change step covered by PGlite only).
- 2026-10-28: `MESSAGE_POSTED` (source `messages`), sent by `post_message()` in `20261028_messages.sql` (not by a `notify_*` trigger). Goes to the assigned AO and CO, routed reviewers and approvers, and earlier posters who can still read the file; one unread per person per file; title "New message on <application no.>", no body, no names. See `messages.md`.
- 2026-10-28: the bell panel heading is forced dark (`text-gray-900!`) because `index.css` colours `h2` with `--text-h`, which is near-white in OS dark mode.

## Why (inferred)
Triggers on the tables keep the groupmate's RPCs untouched and catch every path that changes the data, including future ones. One function with fixed applicant rules means no module (OCR, RAG, fraud detection, summary page) can leak internal detail to an applicant by mistake.

## Bank answers (Q-42, visit 2026-10-26)
- Applicants may be told the outcome: Approved, Rejected or Deferred.
- Rejection: tell the applicant the policy they most likely did not pass.
- The AO sends the final notice to the applicant.
- Deferral notices: yes, with the reason.
- SMS and email are allowed, but with no links (nothing pointing to the portal).
- Messaging: staff only.

## Conflicts with what is built
- `APPLICANT_DECISION` is neutral (no outcome, no reason). The bank allows the outcome, and for a rejection the policy most likely not passed.
- Applicant notices are sent by triggers. The bank wants the AO to send the final notice, so the decision notice needs a manual AO step.
- `APPLICANT_DEFERRED` says only "needs more information". The bank wants the reason included.
- An approver's DEFERRED is shown as "Incomplete submission". With the outcome now disclosable, Deferred may need to be shown as a decision.
- F5 (paper) sends SMS / email links to the missing item. The bank allows SMS / email only with no links.
- "The policy they most likely did not pass" needs policy checks (MRAC / RAG flags), which are not built (Q-19, Q-20).
- Messaging is staff only: the Messages feature gives applicants no access (built 2026-10-28, `messages.md`).

## Still to come
- Rebuild the decision and deferral notices to match Q-42 (outcome, reason, sent by the AO), then switch them on.
- F5 email / SMS without links (depends on Q-04 for the external provider).
- TAT near / beyond alerts (need a scheduler).
- Module events: OCR done / failed, extraction to confirm, policy flags, fraud, summary ready.
