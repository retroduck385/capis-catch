# Notifications

Date: 2026-10-24. Status: decided by implementation. Covers F6 (Timely Workspace Notification Alerts) and the applicant status notices from the 2026-10-23 meeting. Updated 2026-10-28 with the bank's Q-42 answers (visit 2026-10-26), which are not built yet; see "Bank answers" below. Updated 2026-10-29: the outcome notices are rebuilt as AO-sent notices (`applicant-notices.md`).

## Decided
- **In-app only for staff.** Applicant outcome notices also go by SMS and email since 2026-10-29 (`applicant-notices.md`).
- **One way in.** Every notification is created by `send_notification()` (security definer). Triggers, other SQL functions and the service role (OCR worker, FastAPI) can call it; the browser cannot. A frontend module needs its own permission-checked RPC.
- **Triggers on existing tables, no changes to existing functions.** `notify_*` triggers on `stage_status_changes`, `application_assignments`, `ci_requests`, `financial_packages`, `audit_log`, `review_assignments`, `loan_applications`. Each catches its own errors, so a failed notification never blocks a stage move.
- **What applicants see:** Submitted / Incomplete submission / Under review, and since 2026-10-29 the outcome (Approved / Rejected / Deferred) once the AO has sent its notice (plus Draft). No internal stage, no names, no amounts. Applicants only ever receive the `APPLICANT_*` kinds; the function refuses to send anything else to them.
- **Decision and deferral notices:** the automatic `APPLICANT_DECISION` / `APPLICANT_DEFERRED` (built switched off, never sent) were removed 2026-10-29 with their switch rows. The assigned AO now sends `APPLICANT_OUTCOME` (`applicant-notices.md`).
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
- ~~`APPLICANT_DECISION` is neutral.~~ **Resolved 2026-10-29:** the AO's notice states the outcome and, for a rejection, the policy most likely not passed.
- ~~Applicant notices are sent by triggers.~~ **Resolved 2026-10-29:** outcome notices are sent only by the assigned AO; Submitted / Under review / Incomplete stay automatic.
- ~~`APPLICANT_DEFERRED` says only "needs more information".~~ **Resolved 2026-10-29:** the deferral notice says what is missing.
- ~~DEFERRED shown as "Incomplete submission".~~ **Resolved 2026-10-29:** Deferred is its own status for the applicant, shown after the notice.
- F5 (paper) sends SMS / email links to the missing item. The bank allows SMS / email only with no links. **Built 2026-10-29 without links** (refused by a link check); live sending waits for Q-04.
- "The policy they most likely did not pass" needs policy checks (MRAC / RAG flags), which are not built (Q-19, Q-20). **Until then** the AO writes it, with suggestions from the FP exceptions and the CO's justification.
- Messaging is staff only: the Messages feature gives applicants no access (built 2026-10-28, `messages.md`).

## Still to come
- ~~Rebuild the decision and deferral notices to match Q-42.~~ Done 2026-10-29 (`applicant-notices.md`).
- Live SMS / email (built, log mode until Q-04). Item-level deficiency notices (F5) are not built.
- TAT near / beyond alerts (need a scheduler).
- Module events: OCR done / failed, extraction to confirm, policy flags, fraud, summary ready.
