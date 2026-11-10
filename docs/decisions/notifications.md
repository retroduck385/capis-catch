# Notifications

Date: 2026-10-24. Status: decided by implementation. Covers F6 (Timely Workspace Notification Alerts) and the applicant status notices from the 2026-10-23 meeting. Updated 2026-10-28 with the bank's Q-42 answers (visit 2026-10-26), which are not built yet; see "Bank answers" below. Updated 2026-10-29: the outcome notices are rebuilt as AO-sent notices (`applicant-notices.md`). Updated 2026-11-09: the CI results and reviewer sign-off migrations (2026-11-08) make three waiting alerts fire and add four kinds; see "Since 2026-11-08". Updated 2026-11-11: the approver decision, the fixes and the document requests; see "Since 2026-11-10".

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
- 2026-11-08 (UI merge): the bell now sits in the top bar of `src/components/appLayout.jsx` (rendered by `privateRoute.jsx` for every signed-in page) instead of fixed top right. The messages button takes an `inline` option for page action rows (loan folder, CI request, Financial Package); the review summary page still uses the old fixed button.

## Since 2026-11-08 (other modules, checked 2026-11-09)
`20261108_ci_results.sql` and `20261108_reviewer_signoff.sql` (run after `20261029_applicant_notices.sql`) don't change any notification function or trigger. Their new moves set off the waiting stage alerts, and they call `send_notification()` for four new kinds.

| Kind | When | Who |
|---|---|---|
| STAGE_CREDIT_EVALUATION (now fires) | `complete_ci()` opens Credit Evaluation | Assigned CO, else the Dispatch Admins |
| STAGE_RETURNED (now fires) | A reviewer returns the file (Credit Evaluation reopens as RETURNED) | Assigned CO |
| APPROVAL_ROUTED (now fires) | The last reviewer signs off and Approval opens | Every routed approver |
| CI_DONE (new) | `complete_ci()` | Assigned AO always; every active CO when no CO is assigned |
| REVIEW_YOUR_TURN (new) | A reviewer signs off and another is left | The next reviewer |
| REVIEW_COMPLETE (new) | The last reviewer signs off | Assigned CO and AO |
| REVIEW_RESUBMITTED (new) | The CO resends after a return | The reviewer who returned it |

- Still dormant: DECIDED (no approver decision) and DONE_REVERTED (a return opens a new stage visit; nothing reopens a Done one).
- No one gets two alerts for the same event (end-to-end PGlite run, with and without a CO assigned before CI Done). Two loose ends: when no CO is assigned, the COs who didn't claim the file keep an unread CI_DONE; REVIEW_ROUTED still tells every reviewer "sent to you for review" at send time, although reviewers now act in turn.
- The applicant sees "Under review" through CI, Credit Evaluation, Review, a return and Approval, with one APPLICANT_UNDER_REVIEW notice.
- Approvers are now routed automatically from the approval matrix at send time; as before, they hear nothing until Approval opens.

## Since 2026-11-10 (checked 2026-11-11)
- **Main, 2026-11-10** (`20261110_approver_decision.sql`): DECIDED now fires when the last needed approver decides (AO, CO, Dispatch Admins, once each). The AI extraction, CI extraction and MRAC migrations add no notification kind and change none of this module's tables, functions or triggers. Nothing alerts the AO when an extraction is ready to check or failed (see `ai-extraction.md`).
- **Branch `fix/notification-fixes`** (`20261111_notification_fixes.sql`, not merged yet):
  - DECIDED also goes to the routed approvers (the approver whose decision closed it is the actor and is skipped).
  - REVIEW_ROUTED says the reviewer's place in the turn order: "HL-... is ready for your review (reviewer 1 of 3)" for whoever's turn it is, "You were added as reviewer 2 of 3 on HL-..." with "You'll be notified when it's your turn." for the others. The trigger is now a deferred constraint trigger, so the total is known when it fires; a failed send sends nothing.
  - The top bar with the bell stays at the top while the page scrolls; the unread count is 11px.
- **Branch `feature/deferral-loop`** (`20261112_document_requests.sql`, `document-requests.md`): REVIEW_RETURNED (assigned AO, when a reviewer returns a file; the CO's STAGE_RETURNED is unchanged), DOCUMENTS_SENT (assigned AO), and two applicant kinds, APPLICANT_DOCUMENTS_NEEDED and APPLICANT_REQUEST_CLOSED. No automatic APPLICANT_UNDER_REVIEW while a document request is open.
- No one gets two alerts for one event (PGlite, all three branches together).

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
- Module events: OCR done / failed, extraction to confirm or failed (AI extraction is built, with no alert), policy flags, fraud, summary ready.
