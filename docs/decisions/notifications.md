# Notifications

Date: 2026-10-24. Status: decided by implementation. Covers F6 (Timely Workspace Notification Alerts) and the applicant status notices from the 2026-10-23 meeting. Leaves F5 (SMS / email deficiency links) and Q-42 open.

## Decided
- **In-app only.** No email or SMS (F5 is inferred in the paper and depends on Q-04).
- **One way in.** Every notification is created by `send_notification()` (security definer). Triggers, other SQL functions and the service role (OCR worker, FastAPI) can call it; the browser cannot. A frontend module needs its own permission-checked RPC.
- **Triggers on existing tables, no changes to existing functions.** `notify_*` triggers on `stage_status_changes`, `application_assignments`, `ci_requests`, `financial_packages`, `audit_log`, `review_assignments`, `loan_applications`. Each catches its own errors, so a failed notification never blocks a stage move.
- **Applicants see four statuses only:** Submitted / Incomplete submission / Under review / Decision (plus Draft). No internal stage, no names, no amounts. An approver's DEFERRED counts as "Incomplete submission" (at the bank a deferral usually means missing information). Applicants only ever receive the five `APPLICANT_*` kinds; the function refuses to send anything else to them.
- **Decision and deferral notices are built but switched off** (`notification_switches`) until the bank's disclosure rules are known (Q-42). The decision text never states the outcome or a reason.
- **Under review is announced once** per change into that status, not on every internal move.
- **Staff text** carries the application number only, never borrower names or amounts: a notification stays readable after its recipient loses access to the file.
- **Approvers** are notified when Approval opens (or when added during Approval), not when the CO sends the file for review.
- **New submissions** notify every active AO (switchable).
- **No notice for your own action** (claiming or releasing a file yourself sends nothing), except the applicant's own submission confirmation.

## Built
- `catch/supabase/migrations/20261024_notifications.sql`: `notifications`, `notification_switches`, `send_notification()`, `mark_notifications_read()`, seven `notify_*` triggers, `supabase_realtime` publication. Run in the shared project 2026-10-24.
- Front end: `src/components/notificationBell.jsx` (mounted once in `privateRoute.jsx`), `src/pages/notifications/{api.js, useNotifications.js, applicantStatus.js}`. Applicant home shows the four statuses.
- Tested: 86 PGlite checks; click test in the shared project 2026-10-24 (routing-change step covered by PGlite only).

## Why (inferred)
Triggers on the tables keep the groupmate's RPCs untouched and catch every path that changes the data, including future ones. One function with fixed applicant rules means no module (OCR, RAG, fraud detection, summary page) can leak internal detail to an applicant by mistake.

## Still to come
- Q-42: decision / deferral wording and whether they go out at all; manual send by a person.
- F5 email / SMS with links to the specific missing item.
- TAT near / beyond alerts (need a scheduler).
- Module events: OCR done / failed, extraction to confirm, policy flags, fraud, summary ready, folder messages.
