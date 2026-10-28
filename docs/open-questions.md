# Open questions

Items marked **DECIDED** were settled by implementation (main's code) or by the bank; their old Evidence and Suggested lines are kept for history. **Everything else here is NOT decided.** "Suggested" is a proposal for the team to accept or reject, not a decision.
Sources: main paper (**P** + section), appendices (**App.** + letter or tab). "The bank" = the partner bank.
Found by comparing the diagrams (BPMN, Figure 1-3, Appendix L, tracker screenshots) against the text and the interview transcripts.

| Group | Items |
|---|---|
| 1. Blocks Sprint 0 | Q-04, Q-05 |
| 2. Needed before a later sprint | Q-06, Q-07, Q-11 (rest), Q-13 (rest), Q-14 (caps), Q-15 (seafarer), Q-16, Q-17, Q-18 (effective date), Q-19 to Q-21, Q-25, Q-26, Q-28, Q-38, Q-39 (CI Field), Q-40 |
| Decided by implementation | Q-01, Q-02, Q-03, Q-08, Q-09 (structure only), Q-10, Q-12, Q-22, Q-23, Q-24, Q-27, Q-41; in part: Q-11, Q-13, Q-14, Q-15, Q-18, Q-39 |
| Decided by the bank | Q-42 (visit 2026-10-26) |
| 3. Paper edit only, no code impact | Q-29 to Q-37 |

---

## 1. Blocks Sprint 0
Sprint 0 delivers the schema, role-based access, audit trail, agent runtime and vector store. These decide their shape.

**DECIDED. Q-01. Which roles exist?**
- Evidence: four lists disagree. P1.3 and the BPMN show 6 roles; P1.4.1 and Figure 2 list 7 (adds Credit Evaluator, Dept Head, Applicant; drops Reviewer and Dispatch Admin); Sprint 0 lists 8; P1.4.2.3 adds "Committee Members". The Dispatch Admin is "Credit Officer Admin" in the BPMN and App. K. Interviews add "Credit Evaluation Officer", "Credit Underwriter", Marketing, Secretary, Support.
- Suggested: adopt Sprint 0's eight as the RBAC enum, treat Credit Evaluator = Credit Officer, and make Committee Members an approval-tier attribute rather than a role. Confirm with the bank's contact.
- Files: `roles-and-permissions.md`.
- **Decided by implementation, 2026-10-13:** enum `user_role` with 8 values: APPLICANT, ACCOUNT_OFFICER, CREDIT_INVESTIGATOR, DISPATCH_ADMIN, CREDIT_OFFICER, REVIEWER, APPROVER, DEPT_HEAD. Credit Evaluator is not a separate role; Committee Members are not modeled.

**DECIDED. Q-02. Is the Loan Applicant a system user?**
- Evidence: P1.4.2.1, P1.6.2 and Sprint 1 build a customer-facing portal with status view. App. G, I, J say the client endpoint was discontinued, the QR code went unused, clients chose the two-page paper form over the 36-page online form, and the team prefers internal entry for maker-checker control and to avoid public-facing downtime.
- Suggested: keep the Applicant in the role enum, but build Sprint 1 as AO-entered intake and defer applicant self-service unless the bank confirms demand. Decide before Sprint 0 auth work.
- **Decided by implementation, 2026-10-13:** yes. Applicants sign up and fill in a self-service multi-step form with uploads. An AO-entered intake page exists only as a placeholder. See `decisions/applicant-portal.md`.

**DECIDED. Q-03. Which parties get their own records, and how does the "master profile" relate to a loan application?**
- Evidence: KYC / FP have principal, spouse, co-borrower, attorney-in-fact and mortgagor; the FP also has an "AIF" column; F1 (Applicant Profile Page) implies a profile that outlives one application; Sec. 1.2 says applications may have multiple co-borrowers; developer and referrer records also appear.
- Suggested: one `person` table with per-application roles (principal, spouse, co-borrower, attorney-in-fact, mortgagor, reference), plus `application`, `employment`, `obligation`, `collateral`. Needs the ERD (Phase 3, not started).
- **Decided by implementation, 2026-10-13:** a master profile (`user_profile`) per login, plus one `applicants` row per party per application (PRINCIPAL, SPOUSE, CO_BORROWER numbered 1..n, MORTGAGOR, ATTORNEY_IN_FACT). References live in `character_references`.

**Q-04. Pending data-handling constraints.**
- Evidence: P3.2.2.1 says the Data Privacy Officer, IT Risk and Security Department sessions are still to be held, and that they govern RBAC rules and external model calls. P3.2.2.4: only synthetic documents may be sent to the external vision model.
- Suggested: build RBAC and audit generically now; hold anything that sends data to an external model until the sessions confirm the rules. Enforce a "synthetic data only" flag in Sprint 0 configuration.
- Note 2026-10-29: applicant SMS (Semaphore) and email (Brevo) send the phone number, email, outcome and reason to an external provider. The notice worker stays in log mode, and live mode only reaches an allowlist of the team's own numbers and addresses, until these sessions clear it.

**Q-05. Where does "pre-approval" end?**
- Evidence: P1.7.3 excludes release, servicing and collections and the BPMN ends at approval. The Home Loan Tracker has RED Endorsement, Clearance, Booking, Release and Lock tabs; App. G maps the flow to first release; the checklist has post-approval sections; App. G says its confirmed scope was "up to first release".
- Suggested: end at "Approved / Deferred / Declined" and stop before the Notice of Approval. Leave the post-approval tabs and checklists out of the schema.

**DECIDED. Q-41. How does a user get a role, and where is it stored?**
- Evidence: main's sign-up page (`catch/src/pages/signUpPage.jsx`) creates a Supabase Auth user with email and password only, and assigns no role. Sprint 0 requires RBAC via RLS for the role types (Q-01). Roles-and-permissions notes a single shared login is a current pain point (App. H).
- Options: (a) an admin creates staff accounts and assigns the role; (b) the user picks a role at sign-up; (c) mixed: self sign-up only for `loan_applicant` (depends on Q-02), admin-assigned for staff. Storage: a `profiles`/`user_roles` table keyed to `auth.users`, or Supabase `app_metadata` claims read by RLS, or both.
- Depends on: Q-01, Q-02.
- **Decided by implementation, 2026-10-13:** option (c). Self sign-up creates an APPLICANT via a trigger; the Dept Head creates staff logins and calls `grant_staff_role()`, logged in `staff_role_grants`. The role is stored in `public.users.role`; clients can't change it. See `decisions/role-storage.md`.

---

## 2. Needed before a later sprint

### Sprint 1 (Digital Intake and Agentic Document Processing)
**Q-06. Intake channel and who confirms extracted values.**
- Evidence: P1.4.2.1 says the "Account Officer or Applicant" verifies OCR output; Sprint 1, P3.2.4.2 and App. L say the Account Officer. The current CAF form is AO-only, with 2 x 10 file slots and a 10 MB limit (App. C/D).
- Suggested: AO confirms every extracted field (HITL #1). Reuse the form's limits as validation rules.

**Q-07. Extraction target schema.**
- Evidence: the KYC tab already has Extracted / Corrected / Remarks / Finalized columns and a documented manual LLM extraction routine with a fixed prompt (data-fields.md). App. J says an LLM was tried by one team member and not adopted (see Q-35).
- Suggested: use the KYC tab's row list as the extraction schema and its five columns as the staging-plus-confirmation model. Do not port the manual prompt as-is.

**DECIDED. Q-08. Borrower-type taxonomy and checklist conditions.**
- Evidence: the checklist has ten types (locally employed, seafarer, OFW, self-employed, licensed professional, virtual assistant, commission-based, rental, transport operator, pensioner). Sprint 1 covers salaried single only; Sprint 6 names self-employed, co-borrower and OFW. "ITR if loan amount > 3M" is a value-conditional rule.
- Suggested: model the checklist as data (type x document x condition) so Sprint 6 adds rows, not code. Confirm which types are in Sprint 1 vs later.
- **Decided by implementation, 2026-10-13:** the checklist is the SQL function `required_documents(employment_type, loan_amount)`. Rows are the 6 KYC-tab document categories; the ITR-above-P3M rule is built in (self-employed only). It is a function, not a data table. Differences from the paper: `document-requirements.md`.

**Q-38. What do "Class B" and "Class C" mean?**
- Evidence: printed on the CI Request, Checklist, Credit_Score and AMD tabs ("Class B") and the Cashflow tab ("Class C"). Never explained.
- Suggested: ask the bank. Do not model until answered.

**DECIDED IN PART. Q-39. Illegible or incomplete tracker tabs.**
- Evidence: E.5 (FP) and E.10 (CI Field) are too low-resolution; E.8 (Credit_Score) shows only the header.
- Suggested: request the source spreadsheet, or accept the FP and CI Field field lists as incomplete. Sprint 4 needs the score criteria (see Q-22).
- **Decided by implementation, 2026-10-21 (FP and Credit_Score only):** the team has the KYC-FP sheet. The FP sections are built from it (`20261020_financial_package.sql`) and the Credit_Score criteria and points are seeded from it (`20261021_credit_scoring.sql`). **E.10 CI (Field) stays open.**

**Q-40. Seafarer checklist item.**
- Evidence: prints "Certification from Manning Agency of" and "COEC" on separate lines with 5 checkboxes for 4-5 lines.
- Suggested: treat as "Manning Agency certification" plus "COEC" until confirmed.

### Sprint 2 (Workflow and Queue Management)
**DECIDED (structure only). Q-09. What is the turnaround target?**
- Evidence: 7-day prescribed TAT (P1.2); 2-hour KRI commitment (Ishikawa figure, App. J); 1 day employed / 2 days self-employed (App. H); 2 PM cutoff and statuses return-in / within / beyond / returned (App. I); 3.12-day average.
- Suggested: make it configuration, one target per stage and borrower type, and get the bank's answer. The 2-hour figure looks like a per-application processing commitment, not end-to-end.
- **Decided by implementation, 2026-10-13 (structure only):** one TAT per stage in table `stage_tat`, with a "near" warning at 75 %. **The day values (Intake 1, CI 3, Credit Evaluation 3, Review 2, Approval 2) are placeholders** until the bank gives its SLA; that part stays open.

**DECIDED. Q-10. Stage list and status names.**
- Evidence: the as-is stages come from the BPMN. Tracker statuses (Requested, Pending, Done, Not Applicable, Endorsed, Deferred) and the paper's states ("Pending Customer Correction", "Pending Committee Review") differ. No to-be BPMN exists yet.
- Suggested: use `status-flow.md`'s seven stages as a starting lookup table and name statuses per stage. Confirm in the Phase 3 to-be BPMN.
- **Decided by implementation, 2026-10-13:** two layers. `workflow_stage`: INTAKE, CREDIT_INVESTIGATION, CREDIT_EVALUATION, REVIEW, APPROVAL, DECIDED. `stage_status`: PENDING, IN_PROGRESS, REQUESTED, RETURNED, DONE. `application_status` is the applicant-facing status. No separate Dispatch stage. Details: `status-flow.md`.

**DECIDED IN PART. Q-11. CI: one request or two, who encodes results, and the "verified" threshold.**
- Evidence: App. G has the AO request NFIS / TU / BRAS after collation; the BPMN has a second Desk and Field CI request at the first Reviewer. P1.3.1.4 says CI has no access to the shared sheet, yet the BPMN shows CI updating Home Loan Tracker v3.0 (they may be two different sheets). App. I asks whether CI should encode its own results. The 3-of-5 or 4-of-5 threshold is not tied to specific checks.
- Suggested: model CI requests as separate typed requests (Initial: NFIS / TU / BRAS; Desk; Field), CI writes results itself, and store the "verified" threshold as configuration.
- **Decided by implementation, 2026-10-21 (initial request only):** the assigned AO sends one CI request covering NFIS and TU (no BRAS) with `request_ci()`, while the file is in Intake. KYC sections don't have to be Verified first. The NFIS and TU forms are built live from the record, not stored; only the AO's remarks are kept (`ci_requests`). A file can be requested again. The CI sees only files with a request. **Still open:** who encodes the results, Desk / Field CI requests, and the "verified" threshold.

**DECIDED. Q-12. Assignment: automatic FIFO or Dispatch Admin?**
- Evidence: F8 auto-assigns by FIFO; today the Dispatch Admin assigns Credit Officers and is the single gatekeeper (App. I, K).
- Suggested: FIFO proposes, Dispatch Admin can override, and both are audited.
- **Decided by implementation, 2026-10-13:** AOs and COs claim files themselves from a FIFO work tray; Dispatch Admin, Reviewer, Approver and Dept Head can assign, reassign or unassign any AO/CO. History is in `application_assignments`. No automatic assignment.

**DECIDED IN PART. Q-13. Reviewer rules.**
- Evidence: the BPMN loops "Is there another reviewer?" and has a "first reviewer" branch that requests Desk and Field CI. The number of reviewers and the rule for who counts as first are not stated. App. I: reviewer re-checks the underwriter's computation and supporting documents.
- Suggested: one or more reviewers configurable per application; only the first triggers the Desk / Field CI request. Confirm.
- **Decided by implementation, 2026-10-21:** the assigned CO picks one or more reviewers, in review order (seq 1 = first reviewer), and one or more approvers, per application (`review_assignments`, `send_for_review()`). After sending, only the Dept Head or Dispatch Admin can change them (`update_review_routing()`). **Still open:** the first reviewer's Desk / Field CI request, and the review sign-off (mark reviewed / request revision) is not built.

**DECIDED. Q-42. What applicants are told, and decision disclosure.**
- Evidence: meeting 2026-10-23: applicants see four statuses (submitted, incomplete submission, under review, decision) and no internal detail unless disclosed; whether the bank allows giving denial reasons is unconfirmed (the expected default is to give none); whether the final approver or the AO triggers the applicant's notice is to be confirmed. F5 (Sec. 1.4.2.1) sends SMS / email deficiency links to the specific item. At the bank a deferral usually means missing information.
- Built (2026-10-24, `20261024_notifications.sql`, `decisions/notifications.md`): in-app only. APPLICANT_SUBMITTED, APPLICANT_UNDER_REVIEW and APPLICANT_INCOMPLETE (on FOR_CLARIFICATION, which nothing sets yet) are on. APPLICANT_DECISION (neutral: no outcome, no reason) and APPLICANT_DEFERRED ("needs more information") are **switched off** in `notification_switches`.
- Still open: whether the decision notice may state the outcome or a reason; automatic vs sent by a person; whether deferral notices go out; item-level deficiency notices and email / SMS (F5, depends on Q-04).
- Suggested: ask at the bank visit (2026-10-26). Keep both switches off until then.
- **Decided by the bank, visit 2026-10-26:**
  - Applicants may be told the outcome: Approved, Rejected or Deferred.
  - Rejection: tell the applicant the policy they most likely did not pass.
  - The AO sends the final notice to the applicant.
  - Deferral notices: yes, with the reason.
  - SMS and email are allowed, but with no links (nothing pointing to the portal).
  - Messaging: staff only. Built 2026-10-28: `decisions/messages.md`.
- **Built 2026-10-29** (`20261029_applicant_notices.sql`, `decisions/applicant-notices.md`): the assigned AO sends the outcome notice with a reason, in-app and queued for SMS / email (no links); applicants see the outcome only after it; the automatic decision / deferral notices are removed. Live SMS / email waits for Q-04.

### Sprint 3 (Automated Financial Computation)
**Q-14. Ratio names, definitions and thresholds.**
- Evidence: P1.4.1 / 1.4.2.5 use DTI and DBR; P1.4.3 lists LTV, AMD, DBR; Sprint 3 lists LTV, DBR and Amortization-to-Net-Income as three ratios; P2.1.2.6 says DBR = Amortization-to-Net-Income Ratio; the Cashflow tab shows LCR, AV, DBR; interviews say DPR and "loan-to-collateral ratio". No cap or maximum values appear anywhere. Sprint 3 makes computation a Credit Officer tool; P1.4.3 calls it a silent background overlay.
- Suggested: implement DBR (= amortization / net income) and LTV (loan / appraised value), label LCR as the same as LTV only after the bank confirms, and drop DTI from the UI. Make thresholds configuration.
- **Decided by implementation, 2026-10-21 (names and definitions):** the FP computes **DBR** = (new monthly amortization + existing monthly amortizations with more than 6 months left) / Total Gross Income (D) of all borrowers, and **LCR** = loan amount / appraised value (or the selling price / TCP when no appraisal is entered). DTI and LTV are not used. See `computations.md`. **Still open:** cap values. Thresholds appear only as credit-score bands (Q-22).

**DECIDED IN PART. Q-15. Meaning of 80 % / 90 %, and the seafarer factor.**
- Evidence: interviews and BPMN: COE-based income counts at 80 %, payslip-based at 90 %. P2.1.3.1: a DBR cap of 80-90 % of net disposable income. Seafarer: 80 % (interview, P2.1.3.1) vs "80 or 90%" (BPMN note; blurry).
- Suggested: implement the interview / BPMN reading (haircut on income) and treat seafarer as 80 % until confirmed.
- **Decided by implementation, 2026-10-21:** the interview / BPMN reading. The CO picks an income basis per borrower (`fp_party_details.income_basis`): COE = 80 %, payslip = 90 %, as declared = 100 % of the KYC gross monthly income. **Still open:** the seafarer factor (no seafarer formula is built).

**Q-16. AMD window and the self-employed risk factor.**
- Evidence: AMD over 3 months (App. J), Jan-May on the AMD tab, 6-month statements on the checklist; ADB appears beside AMD. The 10-15 % factor depends on business nature; the mapping from business type to factor is not given, nor whether it reduces the AMD.
- Suggested: make the window and the factor configurable per case, show inputs, and get the factor table from the bank.

**Q-17. Foreign currency rate source.**
- Evidence: BPMN "Check Daily BSP Conversion Rate"; Figure 2 I5 lists "daily reference exchange rates". Whether it is fetched or typed is not stated.
- Suggested: manual entry with date and source recorded; automate later.

**DECIDED IN PART. Q-18. Amortization inputs.**
- Evidence: the schedule needs rate, term, principal; the KYC has an interest rate and a fixing period; rate memos change about every 2 weeks; term and amount amendments recalculate. The source of the rate is not stated.
- Suggested: store the rate with its effective date; recomputation on amendment is audited.
- **Decided by implementation, 2026-10-21:** the assigned CO enters the interest rate (% per annum) and fixing period in the FP; they are stored on `loan_applications` and every change is in `audit_log`. Amortization is recomputed on the page from the current loan amount, term and rate (Excel PMT). **Still open:** no effective date is stored for the rate, and no amortization schedule is built.

### Sprint 4 (Policy Compliance and Evaluation Support)
**Q-19. What happens when an application fails MRAC?**
- Evidence: P2.1.2.4 says automatic decline. P1.4.2.3, Figure 3 and Sprint 4 say flag only. App. J: an approver may recommend adjusted terms instead.
- Suggested: flag only, never auto-decline, matching Sprint 4. Record the outcome as a human decision.

**Q-20. Who reviews policy flags (HITL #2)?**
- Evidence: Appendix L: Account Officer. P3.2.4.2: Credit Officer. P1.4.2.3: senior approvers or committees. P1.4.1: Credit Evaluators.
- Suggested: the Credit Officer reviews flags at evaluation, and unresolved exceptions escalate to the approval tier. Correct Appendix L. Requires Q-01.

**Q-21. MRAC and policy content.**
- Evidence: not yet handed over; P1.7.3 and P3.2.4.3.5 give a fallback (rules-based checker on criteria in interviews). Examples given without values: minimum age, income thresholds, tenure, debt caps. Interviews add: 70 % house completion, alternative proof for residence verification.
- Suggested: hold Sprint 4 retrieval until turnover; the rules checker needs a written rule list from the bank. Track turnover as a dependency.

**DECIDED. Q-22. Credit scoring scope and criteria.**
- Evidence: F10 includes a "Scoring Component"; interviews describe a manual score mapped to a risk classification and recommended loan amount; the older automated tool was abandoned; the Credit_Score tab shows only its header.
- Suggested: score display only after the bank supplies the sheet; any scoring stays advisory.
- **Decided by implementation, 2026-10-21:** the Credit_Score sheet's 17 criteria in four categories (Capacity 30, Character 20, Collateral 20, Condition 30) and their points per band are seeded in `credit_score_criteria` / `credit_score_bands`. The page suggests a band per criterion from the record; nothing counts until the CO picks or accepts a band, and the suggestion is stored beside the pick (`credit_score_entries.suggested_band`). Total, description, risk rating and recommendation follow the sheet's legend and are a guide only; the CO still sets the Credit Result. No recommended loan amount is computed.

### Sprint 5 (Dashboard and Committee Decision Support)
**DECIDED. Q-23. Approver action set.**
- Evidence: Approve / Decline / Defer (P2.1.2.1.4); Approve / Reject / Defer / Refer (P1.4.1, Sprint 5); Approve / Reject / Defer (Figure 2); endorse / not endorse / deferred (evaluator, App. I).
- Suggested: Approve, Reject (with reason code), Defer, Refer, matching Sprint 5, and keep "endorse / not endorse" as the evaluator's recommendation.
- **Decided by implementation, 2026-10-13:** `application_status` has APPROVED, REJECTED, DEFERRED. Refer is not modeled. No approver action or screen is built yet.
- **Decided by implementation, 2026-10-21:** the CO's recommendation is built as `financial_packages.credit_result`: ENDORSED, NOT_ENDORSED, DEFERRED, with a required justification. Approvers have a read-only summary page; their decision is still not built.

**DECIDED. Q-24. Approval tiers beyond Stage 1 and Stage 2.**
- Evidence: only the P3.0M and P5.0M bands are printed. Nothing for above P5.0M or for deviations above P3.0M. "CRMD" and "RPS" are undefined. "Refer / Escalate" names Senior Credit Committee or Board level, which do not match the tracker tiers.
- Suggested: encode the two printed tiers as configuration; anything else is a Refer to a named committee until the bank supplies the rest.
- **Decided by implementation, 2026-10-21:** four approval authorities from the FP sheet's VII. Approval block (enum `approval_tier`): President (or alternate), Senior Credit Committee, Executive Committee, Board. The page suggests one from the loan amount (up to P10M / more than P10M to P30M / more than P30M) and whether there is a deviation (at least one row in the FP's V. Exceptions); the CO picks it. Rules in `approval-rules.md`. The code notes two readings to confirm with the bank: the President's range (not printed) and "Upto 3M to P10M" read as up to P10M.

**Q-25. Physical vs digital sign-off.**
- Evidence: BPMN A.6 shows physical review and signing and a secretary ticking the tracker; App. G plans checkbox-based digital approvals for LIDS; the Signatures tab is checkbox-based.
- Suggested: digital checkbox approvals with an audit trail; keep a printout only as an export.

**Q-26. Marketing and committees in the approval chain.**
- Evidence: Marketing is part of the home-loan approving authority today; the future proposal is Credit alone for cash accounts. P1.4.2.3 names committees.
- Suggested: out of scope until the bank confirms; do not model as a role (see Q-01).

### Sprint 6 (Complex Borrower Profile Extension)
**DECIDED. Q-27. Which borrower profiles are in scope?**
- Evidence: Sprint 6 and P3.3: self-employed, co-borrower, OFW. P3.4.2: spouse and co-borrowers only. The checklist has ten types, including seafarer, virtual assistant, commission-based, rental, transport and pensioner.
- Suggested: Sprint 6 = self-employed, co-borrower, OFW, seafarer (which shares the OFW path and has its own formula); list the others as Won't-have until confirmed.
- **Decided by implementation, 2026-10-13:** all 10 checklist types plus co-borrowers, spouse, mortgagor and attorney-in-fact are in the intake form now, not phased by sprint.

**Q-28. OFW and seafarer specifics.**
- Evidence: SPA required for OFWs and seafarers; clarification by email for OFWs (not phone); employment verification is hard across time zones; the attorney-in-fact fields exist for SPA cases.
- Suggested: model the attorney-in-fact record at Sprint 0 (Q-03) and the OFW communication path at Sprint 6.

---

## 3. Paper edit only, no code impact

**Q-29. What does CATCH stand for?**
- Evidence: the title page (both PDFs) reads "Centralized Application Tracking and Completeness Hub"; the Abstract and P1.5 read "Completeness and Tracking Checkpoint Hub".
- Suggested: pick one and fix the other. (Also affects the app's About text; trivial.)

**Q-30. Ishikawa categories and sub-problem numbering.**
- Evidence: P3.2.1.2 says five categories; P1.3.2, P3.2.1.3.2 and P3.4 say six (the diagram has six). P3.2.3.2 and P3.2.5.3.2 cite sub-problems "1.3.1 to 1.3.5"; the real numbers are 1.3.1.1 to 1.3.1.5. Figure 2 has four problems and four opportunities; the text has five each.
- Suggested: correct to six categories, use 1.3.1.1-1.3.1.5, and add a line that P4 merges the fourth and fifth sub-problems.

**Q-31. KRI expansion.**
- Evidence: "Key Risk Indicator" (P2.1.2.1.4) vs "Key Result Indicator" (Sprint 5, P3.4.2, App. J).
- Suggested: use "Key Result Indicator (KRI)" if that is the bank's term (the interview states it). Keep the UI label neutral ("KRI") until confirmed.

**Q-32. Phase 4A module count.**
- Evidence: P3.2.4.1 and P3.4.1 call the Capstone 1 deliverable "four modules" including an "Automated Financial Computation Module", which is not one of Figure 2's five modules; Figure 2 Module 3 spans Sprint 0 and Sprint 4.
- Suggested: describe Sprint 3 as the Sec. 1.4.3 "Metric Computation Overlay" and state the sprint-to-module mapping (in `sprints.md`).

**Q-33. Appendices C and D.**
- Evidence: one image (the "CAF (AO endpoint)" Google Form) carries both captions. The caption says "Housing Loan Application Form" and "COF AO Forms" but the form is titled "CAF"; the actual 36-page application form is not shown.
- Suggested: relabel as one appendix "CAF (AO endpoint) form" and add the application form if it is needed as an intake reference.

**Q-34. Statistics that do not reconcile.**
- Evidence: 1,619 received vs 1,590 decided (plausible, but the gap is not explained); 9.65 % of "completed" cases (about 933) is a different base than either; App. I: 15 per evaluator per day x 3 evaluators is 45, not 75 (the transcript flags it).
- Suggested: state each base explicitly; re-check the Credit Head figure with the bank.

**Q-35. Existing LLM extraction routine vs "not adopted".**
- Evidence: the KYC tab has step-by-step LLM extraction instructions, but App. J says only one member tried an LLM and the team has not adopted it.
- Suggested: say in the paper that the routine exists as a template and its use is limited.

**Q-36. Unclear transcription in the interviews.**
- Evidence: "RAAC" (probably MRAC), "RPS", "AES", "PE", "DBR" (marked uncertain), "Session Head" (probably Section Head), plus redacted names.
- Suggested: confirm with the interviewees. Glossary entries stay marked "(not defined)".

**Q-37. Increment count.**
- Evidence: full-system integration testing is "across all six increments" (P3.2.4.4.3); Sprints 0-6 are seven increments (five in Phase 4A plus two).
- Suggested: correct to seven, or say six feature increments plus the foundation.
