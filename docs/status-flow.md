# Status flow

Sources: As-Is BPMN (App. A, A.1-A.6), Home Loan Tracker tabs (App. F), interviews (App. G-K), main paper Sec. 1.3, 1.4.2.2, 1.4.2.4.
**The paper has no to-be BPMN yet.** Phase 3 has not started (Sec. 3.2.3.4). Stage and status names were **decided by implementation on 2026-10-13** (Q-10): see "Implemented model" below. The as-is table that follows is kept as the source the implemented stages map from.

## Implemented model (`catch/supabase/migrations/20261005_work_tray.sql`, moves in `20261020_ci_request.sql` and `20261021_review_routing.sql`)
Two layers, plus an applicant-facing status.

| Layer | Enum | Values |
|---|---|---|
| Stage (which lane holds the file) | `workflow_stage` | INTAKE, CREDIT_INVESTIGATION, CREDIT_EVALUATION, REVIEW, APPROVAL, DECIDED |
| Status inside a stage | `stage_status` | PENDING, IN_PROGRESS, REQUESTED, RETURNED, DONE |
| Applicant-facing | `application_status` (on `loan_applications`) | DRAFT, SUBMITTED, FOR_CLARIFICATION, UNDER_CI, UNDER_CREDIT_EVALUATION, DEFERRED, UNDER_REVIEW, FOR_APPROVAL, APPROVED, REJECTED |

- Each stage visit is a row in `application_stages` (an application can come back to a stage). Status history per visit is in `stage_status_changes`; the latest row is the current status.
- Mapping from the as-is stages below: 1 → INTAKE, 2 → CREDIT_INVESTIGATION, 3 (Dispatch) → **no stage**; it is an assignment action (see `roles-and-permissions.md`), 4 → CREDIT_EVALUATION, 5 → REVIEW, 6 → APPROVAL, 7 → DECIDED.
- Approver outcomes (Q-23): APPROVED, REJECTED, DEFERRED. Refer is not modeled.

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
- `send_for_review()` (`20261021_review_routing.sql`, decided by implementation 2026-10-21): the assigned CO, while the file is in CREDIT_INVESTIGATION or CREDIT_EVALUATION, once the FP has a Credit Result of Endorsed or Not endorsed. Records the approval tier, reviewers and approvers, closes the current stage as DONE, opens REVIEW as PENDING; status → UNDER_REVIEW. A Deferred result does not go to review.

**Gaps (not built yet)**
- Nothing moves a file into CREDIT_EVALUATION (the CI results step isn't built), so today a file goes from CREDIT_INVESTIGATION straight to REVIEW. Nothing moves a file out of REVIEW (no reviewer sign-off or approver decision). No RETURNED transitions.
- The CO's Credit Result (Endorsed / Not endorsed / Deferred) is saved on the FP only; Deferred does not return the file to an earlier stage.
- No notifications to the next role.
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
A check-and-return loop exists at three roles (AO, CO, Reviewer). One application can bounce more than once, each time waiting on the AO and often the applicant.

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
- Notify the next role the moment a milestone changes, including: CI result completed, and a deferred account updated by the AO (the CO has no trigger today, App. H).
- A "Done" status must not silently revert. The reversal must notify (App. K).
- Submission is blocked while a required decision input is absent (Sprint 1).
- Turnaround alarm: per-stage `stage_tat` with a "near" warning (built). The target values are still **unresolved** (Q-09: 7 days, 2 hours, 1 or 2 days); current numbers are placeholders.
- Nothing an agent produces moves the file forward without a recorded human confirmation.

## Open items
Q-05 (end state), Q-09 (TAT values only), Q-11 (CI results, Desk / Field CI; the initial request is decided), Q-13 (first reviewer's CI request; reviewer list and order are decided), Q-25 (physical vs digital sign-off).
