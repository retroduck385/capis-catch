# Status flow

Sources: As-Is BPMN (App. A, A.1-A.6), Home Loan Tracker tabs (App. F), interviews (App. G-K), main paper Sec. 1.3, 1.4.2.2, 1.4.2.4.
**The paper has no to-be BPMN yet.** Phase 3 has not started (Sec. 3.2.3.4). Stage and status names were **decided by implementation on 2026-10-13** (Q-10): see "Implemented model" below. The as-is table that follows is kept as the source the implemented stages map from.

## Implemented model (`catch/supabase/migrations/20261005_work_tray.sql`, moves in `20261020_ci_request.sql`, `20261021_review_routing.sql`, `20261108_approver_positions.sql`, `20261108_ci_results.sql`, `20261108_reviewer_signoff.sql` and `20261110_approver_decision.sql`)
Two layers, plus an applicant-facing status.

| Layer | Enum | Values |
|---|---|---|
| Stage (which lane holds the file) | `workflow_stage` | INTAKE, CREDIT_INVESTIGATION, CREDIT_EVALUATION, REVIEW, APPROVAL, DECIDED |
| Status inside a stage | `stage_status` | PENDING, IN_PROGRESS, REQUESTED, RETURNED, DONE |
| Applicant-facing | `application_status` (on `loan_applications`) | DRAFT, SUBMITTED, FOR_CLARIFICATION, UNDER_CI, UNDER_CREDIT_EVALUATION, DEFERRED, UNDER_REVIEW, FOR_APPROVAL, APPROVED, REJECTED |

- Each stage visit is a row in `application_stages` (an application can come back to a stage). Status history per visit is in `stage_status_changes`; the latest row is the current status.
- Mapping from the as-is stages below: 1 → INTAKE, 2 → CREDIT_INVESTIGATION, 3 (Dispatch) → **no stage**; it is an assignment action (see `roles-and-permissions.md`), 4 → CREDIT_EVALUATION, 5 → REVIEW, 6 → APPROVAL, 7 → DECIDED.
- Approver outcomes (Q-23): APPROVED, REJECTED, DEFERRED in the enum. Built 2026-11-10: approvers set APPROVED or REJECTED only; DEFERRED is never set (deferral happens at the AO, CO and reviewer steps, with a document request). Refer is not modeled.
- **What the applicant sees** (meeting 2026-10-23, built 2026-10-24, outcomes 2026-10-29 after the bank's Q-42 answers): Draft, Submitted (SUBMITTED), Incomplete submission (FOR_CLARIFICATION), Under review (UNDER_CI, UNDER_CREDIT_EVALUATION, UNDER_REVIEW, FOR_APPROVAL), or the outcome: Approved / Rejected / Deferred. An outcome shows only after the assigned AO has sent the notice for that outcome (`send_applicant_notice()`); until then "Under review". Anything else shows "In progress". Same mapping in `applicant_status_bucket()` / `applicant_visible_status()` (`20261029_applicant_notices.sql`) and `catch/src/pages/notifications/applicantStatus.js`. On branch `feature/deferral-loop` (`20261112_document_requests.sql`): while a document request is open the applicant sees **Documents needed**, after they send the files **Documents sent**, then the normal status again; an outcome already sent wins. The request never changes `loan_applications.status` or the stage.

**Turnaround (Q-09, structure decided, values open).** Table `stage_tat`, one target per stage, "near" at 75 % of it. Near / beyond is computed from time in stage, not stored. Values are **placeholders** until the bank's SLA is known:

| Stage | TAT (days) |
|---|---|
| INTAKE | 1 |
| CREDIT_INVESTIGATION | 3 |
| CREDIT_EVALUATION | 3 |
| REVIEW | 2 |
| APPROVAL | 2 |

**Transitions built so far**
- `submit_application()`: DRAFT → SUBMITTED once nothing required is missing; a trigger opens INTAKE with status PENDING.
- `assign_application()`: an AO claiming (or being assigned) in INTAKE, or a CO in CREDIT_EVALUATION, moves PENDING → IN_PROGRESS. `unassign_application()` moves it back.
- `request_ci()` (`20261020_ci_request.sql`, decided by implementation 2026-10-21): the assigned AO, while the file is in INTAKE. INTAKE → DONE and closed; CREDIT_INVESTIGATION opens as REQUESTED; status SUBMITTED → UNDER_CI. KYC sections don't have to be Verified first. The AO can keep editing the record during CREDIT_INVESTIGATION.
- CI results (`20261108_ci_results.sql`, decided by implementation 2026-11-08): any active CI, while the file is in CREDIT_INVESTIGATION and has a CI request. The CI's first save or upload (`save_ci_findings()`, `add_ci_document()`) moves CREDIT_INVESTIGATION from REQUESTED to IN_PROGRESS.
- `complete_ci()` ("Mark CI Done", 2026-11-08): needs an NFIS and a TU result and report for every borrower (principal, spouse, co-borrowers); otherwise it returns what is missing and changes nothing. CREDIT_INVESTIGATION → DONE and closed; CREDIT_EVALUATION opens as IN_PROGRESS if a CO is already assigned, else PENDING; status UNDER_CI → UNDER_CREDIT_EVALUATION.
- `send_for_review()` (`20261021_review_routing.sql`, decided by implementation 2026-10-21; changed by `20261108_approver_positions.sql`): the assigned CO, while the file is in CREDIT_INVESTIGATION or CREDIT_EVALUATION, once the FP has a Credit Result of Endorsed or Not endorsed. Since 2026-11-08 the CO picks the reviewers only (`send_for_review(application, reviewers)`); the approval authority comes from the matrix and the approvers from their positions (`approval-rules.md`). It refuses when the approver accounts can't cover the authority. Closes the current stage as DONE, opens REVIEW as PENDING; status → UNDER_REVIEW. A Deferred result does not go to review.
- `submit_review()` (`20261108_reviewer_signoff.sql`, 2026-11-08): only the current reviewer (lowest order without a sign-off), while in REVIEW.
  - Endorse / Not endorse, with a justification and every checklist item marked: if another reviewer is left, REVIEW stays open (IN_PROGRESS) and that reviewer is told it's their turn. After the last reviewer, REVIEW → DONE, APPROVAL opens as PENDING, status → FOR_APPROVAL.
  - Return to the CO (Minor / Major, at least one item marked Needs revision): REVIEW → DONE, CREDIT_EVALUATION opens again as RETURNED, status → UNDER_CREDIT_EVALUATION.
- `resend_for_review()` (2026-11-08): the assigned CO, in CREDIT_EVALUATION with an unanswered return, says what changed. CREDIT_EVALUATION → DONE, REVIEW opens as PENDING, status → UNDER_REVIEW. Review continues from the reviewer who returned it; earlier sign-offs stand. The approval authority can only go up here.
- Every sign-off and return is a row in `review_decisions` (checklist in `review_decision_items`), logged in `audit_log`.
- `submit_approval()` (`20261110_approver_decision.sql`, by a teammate 2026-11-10): only a routed approver who hasn't decided, while in APPROVAL, once each. Approve (remarks optional), Approve with conditions (conditions required; counts as an approval) or Disapprove (reason required). APPROVED once the approvals meet the authority's groups (`approval_requirements()`); REJECTED once the approvals plus the approvers still to decide can no longer meet it (one disapproval doesn't end it while others can still meet it). Until then APPROVAL shows IN_PROGRESS. When decided: APPROVAL → DONE, DECIDED opens as DONE, status → APPROVED or REJECTED. Only decisions on active assignments count; the position signed as is kept on the decision (`approval_decisions`).
- Document requests (branch `feature/deferral-loop`, `decisions/document-requests.md`): the assigned AO, in INTAKE, CREDIT_INVESTIGATION, CREDIT_EVALUATION or REVIEW. No stage or status change.

**Gaps (not built yet)**
- ~~Nothing moves a file into CREDIT_EVALUATION; nothing moves it out of REVIEW; no RETURNED transitions.~~ **Built 2026-11-08** (above).
- ~~Nothing moves a file out of APPROVAL.~~ **Built 2026-11-10** (`submit_approval()`, above). Nothing sets DEFERRED or FOR_CLARIFICATION; both are dormant by design (deferral is told with a document request).
- The CO's Credit Result (Endorsed / Not endorsed / Deferred) is saved on the FP only; Deferred does not return the file to an earlier stage. The AO is told (CREDIT_RESULT_DEFERRED) and can ask the applicant with a document request.
- Desk / Field CI and the first reviewer's CI request: out of scope for now (Q-13).
- ~~No notifications to the next role.~~ **Built 2026-10-24** (`20261024_notifications.sql`, in-app only, see `decisions/notifications.md`): new submission → every AO; AO / CO assigned or removed by a head; CI request → every CI; Credit Result saved as Deferred → assigned AO; the AO edits a deferred file → assigned CO; routed to / removed from review → that reviewer; applicant notices for the four statuses. **Firing since 2026-11-08:** Credit Evaluation opened (assigned CO, else Dispatch Admins), Approval opened (routed approvers), a stage returned (its owner; today only a reviewer's return). Added by the 2026-11-08 functions: CI_DONE, REVIEW_YOUR_TURN, REVIEW_COMPLETE, REVIEW_RESUBMITTED. Decided (AO, CO, Dispatch Admins) fires since 2026-11-10; on branch `fix/notification-fixes` it also reaches the routed approvers. Still nothing triggers: a Done status reopened (owner + Dispatch Admins).
- No guard against a silent "Done" reversal.
- Stage changes are logged in `stage_status_changes`, not in `audit_log`.

## As-is stages (source)
| # | Stage | Owner | Enters when | Moves forward when | Moves back / loops when |
|---|---|---|---|---|---|
| 1 | Intake and KYC | Account Officer | Application received (walk-in, branch-referred, or from a developer) | Requirements collated, KYC encoded and verified ("Is Verified?"), tracker updated to request CI | Clarification needed: the AO calls the applicant (emails an OFW), then re-encodes |
| 2 | Credit investigation | Credit Investigator | CI request in tracker | Details complete, then NFIS + TU + BRAS run in parallel, clarifications resolved, results uploaded, NFIS/TU tab set "DONE" | Details incomplete: status Pending, information requested from the AO. Clarification loop. "Done" can revert to Pending |
| 3 | Dispatch | Dispatch Admin | NFIS/TU tab shows Done | CO assigned and messaged | Pending or not uploaded: noted, re-checked daily |
| 4 | Credit evaluation | Credit Officer | Assignment received | Documents clear, income and DBR computed, score evaluated, decision Endorsed. T&Cs and justification added, tab set Done | Documents unclear: search online, else ask the AO. Decision Defer: tracker "Deferred" + reason, wait for the AO's update, decide again |
| 5 | Review | Reviewer(s) | CO endorsement | Docs clear and no errors, FP checkbox ticked; if this was the last reviewer, the Dispatch Admin sends the final endorsement to the AO | Docs unclear: Pending in Credit Evaluation tab. Errors: revision requested from the CO, wait for acknowledgement and revision. Another reviewer: loop. First reviewer may request Desk and Field CI (back to stage 2) |
| 6 | Executive approval | Approver (tier per `approval-rules.md`) | AO prints the FP and routes physical documents | Signed, tracker set Approved, Approver checkbox ticked | Decline / Defer / Refer (Q-23) |
| 7 | Outcome | System | Decision recorded | Approved, Deferred or Declined (2026 baseline: 39.7 % / 39.6 % / 20.8 %) | Deferred returns to the earlier stage that owes the missing information |

Post-approval stages (Notice of Approval, Support prep, signing, clearance, booking, release) exist in the interviews and tracker but are outside the stated scope (Q-05).

## Recurring pattern (Sec. 1.3)
A check-and-return loop exists at three roles (AO, CO, Reviewer). One application can bounce more than once, each time waiting on the AO and often the applicant. **Built for the applicant's side** on branch `feature/deferral-loop`: the AO sends a document request, the applicant uploads only those documents, the AO checks and closes it (`decisions/document-requests.md`).

## Status vocabularies seen
- **Tracker cells:** Requested, Pending, Done, Not Applicable (Desk/Field CI); Endorsed / Not Endorsed / Deferred (CO); Approved.
- **Turnaround statuses (App. I):** return-in, within (TAT), beyond (TAT), returned.
- **Revision types (App. I):** minor or major. Either way the account is set Pending in the tracker and returned to the evaluator, which is effectively a deferral.
- **Paper's example states (1.4.2.2):** "Pending Customer Correction", "Pending Committee Review".
- **Paper's micro-status idea (2.1.3.4):** e.g. "Awaiting Original Title Verification", "CI Report Discrepancy Flagged".
- **Tracker tab order (App. F):** Change Logs, Applications, KYC, NFIS/TU, Appraisal, Credit Evaluation, CI, Approval, RED Endorsement, Clearance, Booking, Release, Lock.

## Rules the system must enforce (from the paper)
- FIFO by submission timestamp (Sprint 2). **Built:** the work tray orders by submission time. The interviews mention a 2 PM daily cutoff for CO endorsements (not built). Assignment decided by implementation (Q-12): AO/CO self-claim, heads assign.
- Every stage transition writes a system timestamp (1.4.2.4) and an audit entry.
- Notify the next role the moment a milestone changes, including: CI result completed, and a deferred account updated by the AO (the CO has no trigger today, App. H). **Built** (2026-10-24): the CO gets DEFERRED_ACCOUNT_UPDATED when the assigned AO edits a file whose Credit Result is Deferred. "CI result completed" **built 2026-11-08**: `complete_ci()` opens Credit Evaluation (STAGE_CREDIT_EVALUATION to the assigned CO, else the Dispatch Admins) and sends CI_DONE to the assigned AO, and to every CO when none is assigned.
- A "Done" status must not silently revert. The reversal must notify (App. K). **Notifies** (DONE_REVERTED) since 2026-10-24; the revert itself is not prevented.
- Submission is blocked while a required decision input is absent (Sprint 1).
- Turnaround alarm: per-stage `stage_tat` with a "near" warning (built). The target values are still **unresolved** (Q-09: 7 days, 2 hours, 1 or 2 days); current numbers are placeholders.
- Nothing an agent produces moves the file forward without a recorded human confirmation.

## Open items
Q-05 (end state), Q-09 (TAT values only), Q-11 (only the "verified" threshold; who encodes CI results is decided), Q-25 (physical vs digital sign-off). Q-13's first-reviewer CI request is out of scope for now.
