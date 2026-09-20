# Status flow

Sources: As-Is BPMN (App. A, A.1-A.6), Home Loan Tracker tabs (App. F), interviews (App. G-K), main paper Sec. 1.3, 1.4.2.2, 1.4.2.4.
**The paper has no to-be BPMN yet.** Phase 3 has not started (Sec. 3.2.3.4). The stages below are the as-is stages, restated as the stages CATCH must carry. Stage boundaries and names are NOT decided (Q-10).

## Stages
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
- FIFO by submission timestamp (Sprint 2). The interviews mention a 2 PM daily cutoff for CO endorsements, and the Dispatch Admin assigns accounts today (Q-12).
- Every stage transition writes a system timestamp (1.4.2.4) and an audit entry.
- Notify the next role the moment a milestone changes, including: CI result completed, and a deferred account updated by the AO (the CO has no trigger today, App. H).
- A "Done" status must not silently revert. The reversal must notify (App. K).
- Submission is blocked while a required decision input is absent (Sprint 1).
- Turnaround alarm target: **unresolved** (Q-09: 7 days, 2 hours, 1 or 2 days).
- Nothing an agent produces moves the file forward without a recorded human confirmation.

## Open items
Q-05 (end state), Q-09 (target), Q-10 (stage names), Q-11 (one or two CI requests), Q-12 (assignment), Q-23 (approver actions), Q-25 (physical vs digital sign-off).
