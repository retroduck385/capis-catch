# Approval rules

Sources: Home Loan Tracker Approval tab (App. F.8) and RED Endorsement tab (F.9), Signatures tab (E.7), interviews (App. I, J), main paper Sec. 1.4.2.3, 1.4.2.5, 2.1.2.1.4, 2.1.2.4, 2.1.3.3, Figure 3, Sprint 4-5.
Anything not listed is **not stated**. Nothing here is decided.

## Approval tiers on the tracker (Approval tab)
| Tier | Applies to | Approvers shown |
|---|---|---|
| **Stage 1** | Up to P3.0M **without deviation** | RED Dept. Head, then Decision |
| **Stage 2** | Up to P3.0M **with deviation**, OR more than P3.0M up to P5.0M **without deviation** | CRMD Division Head / Credit Dept. Head, Credit Dept. Head, RED Dept. Head |
| Above P5.0M, or above P3.0M with deviation | **Not shown.** No tier is printed (Q-24) | |

- The tab also has a "Credit Dept. Head" column on the CI tab and Remarks.
- "RED" appears to be the Real Estate Department (the FP footer reads "Real Estate Department" and "Consumer Credit Department, Housing Loan Unit"); "CRMD" is not defined (Q-24).

## Endorsement chain on the tracker (RED Endorsement tab)
RED Account Officer, Decision, RED Section Head, Decision, RED Department Head, Decision, RED Division Head, Decision, Remarks.

## FP signature blocks (Signatures tab)
- KYC: Account Officer.
- Credit Evaluation: Credit Officer, Section Head, Department Head.
- Approval: Account Officer, Section Head, Department Head, Division Head, plus further (redacted) approver boxes.
- CI: CI Officer, Desk CI Supervisor, Section Head.
- Clearance: CCS Officer.
- Sign-off is meant to become digital, checkbox-based (App. G; Q-25).

## Who approves today (interviews, App. I)
- Approval authority is central and tied to a policy the transcript calls "RPS" (unclear, Q-24). In practice almost everything reaches the President.
- For home loans Marketing is still part of the approving authority alongside Credit. The future proposal is that Credit alone approves cash accounts (Q-26).
- The approver checks the account and may adjust it before approving, if within their authority ceiling; otherwise it goes up. For-hire accounts are handled separately.
- The evaluator's list to the approver is sent as a batch, or individually when rushed.
- What an approver sees: FP summary, loan amount, term, DPR computation, loan-to-collateral ratio, income computation, amortization over income, collateral details (base value, grant percentage), adverse-record results from CI. Higher approvers rely on the FP summary and double-check sensitive, high-value or special accounts.
- **Proposal on the table:** tiered authority (Section Head, Checker / Reviewer, Department Head, Division Head) so not everything reaches the President. **Limited, case-by-case delegated approval, with strictly no deviation from policy.** Anything involving a deviation still goes to full committee review.
- Approval outcome in the tracker: "Approved / With NOA" (Notice of Approval).

## Decisions available (vocabulary is inconsistent, Q-23)
| Source | Actions |
|---|---|
| Lit. review 2.1.2.1.4 | Approve, Decline, Defer |
| Sec. 1.4.1, 1.4.2.5, Sprint 5 | Approve, Reject, Defer / Request Information, Refer / Escalate |
| Figure 2 | Approve, Reject, Defer |
| Credit Head interview (evaluator stage) | endorse, not endorse, deferred |
- **Reject** needs mandatory policy-reason coding (1.4.2.5). Reason for decline is a recurring pushback pain point (App. I).
- **Refer / Escalate** packages the summary and time-stamped notes and routes to a higher committee (e.g. Senior Credit Committee, Board level) in one click.
- **Defer** returns the file to the earlier stage that owes information, and triggers a deficiency notice to the applicant or AO.
- Every action writes an immutable audit entry: reviewer notes, votes, historical context, referral reason.

## MRAC (Minimum Risk Acceptance Criteria)
- **Definition:** the absolute baseline eligibility thresholds an applicant must satisfy to qualify for further evaluation (2.1.2.4). The bank's RAC / MRAC content has not been handed over yet (Q-21).
- **Figure 3 flow:** applicant metrics ingested, then the Automated Policy Matcher Engine. Passes all MRAC: proceed to full evaluation. Fails any MRAC: the system generates an exception flag.
- **Sprint 4:** rule-based checker plus RAG. Each flag returns the policy passage it came from. The module produces **structured exception summaries, never automated rejections**.
- **Routing (1.4.2.3):** flagged exceptions are trapped, locked from modification and auto-routed to senior approvers or credit committees. Clearing a breach must go through the proper process, not a direct edit (App. I).
- **Examples named in the paper:** minimum age, basic income thresholds (2.1.2.4); DTI cap breaches, tenure deficiencies (1.4.2.3); employment tenure gaps, debt threshold breaches (1.4.2.5). Actual values: not stated.
- **Conflicting statements (Q-19):**
  - 2.1.2.4 says failing any mandatory MRAC parameter is automatically declined.
  - Sprint 4 and Figure 3 say flag only.
  - App. J says the approver can recommend adjusted terms, such as a higher rate, instead of declining.
- **Who reviews the flags:** unresolved (Q-20). Appendix L says the AO, 3.2.4.2 says the Credit Officer, 1.4.2.3 says senior approvers or committees.
- **Auto-approval:** floated in App. J (auto-approve for documentation only when every check passes with no discrepancy). It is described as more applicable to consumer loans than housing. It is **not** in the paper's design.
- **Older automated scoring tool:** built earlier and set aside because it needed manual client-profiling inputs and was designed for consumer loans (App. J; Sec. 3.1). A design lesson: automation must not replace judgment.

## Delegation concept (Sec. 2.1.3.3)
Automated policy engines let junior credit evaluators clear standardized low-risk packages by binary checkbox validation. Deviations are isolated and escalated to specialized credit committees.
