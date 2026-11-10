# Roles and permissions

Sources: main paper Sec. 1.3, 1.4.1, 1.7.2, 3.2.4.3.1; As-Is BPMN (App. A); interviews (App. G-K).
**The role list was decided by implementation on 2026-10-13 (Q-01):** Sprint 0's eight role types, as enum `user_role`. The paper's four lists are kept below as the source.

## Implemented roles and access (main's migrations in `catch/supabase/migrations/`)
| Enum value | Paper role |
|---|---|
| APPLICANT | Loan Applicant (a system user: Q-02, `decisions/applicant-portal.md`) |
| ACCOUNT_OFFICER | Account Officer |
| CREDIT_INVESTIGATOR | Credit Investigator |
| DISPATCH_ADMIN | Dispatch Admin (BPMN: Credit Officer Admin) |
| CREDIT_OFFICER | Credit Officer (Credit Evaluator is not a separate role) |
| REVIEWER | Reviewer |
| APPROVER | Approver |
| DEPT_HEAD | Credit Department Head |

Committee Members are not modeled.

**Approver positions (2026-11-08, `20261108_approver_positions.sql`).** No new roles. Every APPROVER account carries a position (`users.approval_position`): Credit Department Head, Credit Management Division Head, Lending Department Head, Lending Division Head, President, Senior Credit Committee, Executive Committee, Board. The bank's own unit names are written as generic titles. A committee is one account that decides as a body. Only Approver accounts can have a position. The Dept Head sets it when granting the role (`grant_staff_role(email, role, position)`) or changes it later (`set_approval_position()`); every change is logged in `staff_role_grants`.

**How roles are given (Q-41, `decisions/role-storage.md`).** Self sign-up always creates an APPLICANT. The Dept Head creates staff logins on `/staffAccountsPage` and gives the role with `grant_staff_role()`. This only works for accounts that are still plain applicants with no loan application. Every grant is logged in `staff_role_grants`. The role is stored in `public.users.role`; clients can't change it.

**Who sees what (RLS)**
- **Applicant:** reads their own applications and edits them only while DRAFT. After submission, read-only, except (branch `feature/deferral-loop`) uploading the documents named in an open document request into that request's folder, removing their own uploads while it is open, and sending them (`decisions/document-requests.md`).
- **AO, CO, Dispatch Admin, Reviewer, Approver, Dept Head:** read every submitted application in full (AOs and COs since 2026-10-21; they edit only once assigned).
- **CI:** sees and reads only applications an AO has sent a CI request for (`ci_requests`). Opens the NFIS / TU request page. **Since 2026-11-08** (`20261108_ci_results.sql`, Q-11): any active CI, with no claiming, while the file is in CREDIT_INVESTIGATION, records CI results per borrower (principal, spouse, co-borrowers) and per check (NFIS, TU, BRAS): uploaded report files, a result (No adverse findings / With findings) and a summary, plus overall remarks (`save_ci_findings()`, `add_ci_document()`, `remove_ci_document()`). Then marks CI Done (`complete_ci()`). CI files are kept in `ci_documents` under `ci/{application id}/` in Storage, apart from the applicant's documents, so **the applicant can never read them**. Staff who can read the file read them; the AO can't delete them. Every change is in `audit_log`.
- **Assigned AO, while the file is in INTAKE or CREDIT_INVESTIGATION:** edits the submitted record in place, uploads files into the applicant's folder, and records a KYC check per form section (Verified / Needs clarification + remarks, table `kyc_checks`). While in INTAKE, sends the CI request (`request_ci()`). Every edit after submission is logged in `audit_log`. Everyone else with access is read-only.
- **Assigned CO, at any stage before DECIDED:** fills in the Financial Package (`save_financial_package()`), including interest rate, fixing period and Credit Result, and the credit score (`save_credit_score()`). While in CREDIT_INVESTIGATION or CREDIT_EVALUATION, picks the reviewers (in order) and sends the file to REVIEW (`send_for_review()`). Since 2026-11-08 the approval authority and the approvers are set automatically from the matrix (`approval-rules.md`). After a reviewer's return, answers it and resends (`resend_for_review()`).
- **Dept Head, Dispatch Admin, while in REVIEW or APPROVAL:** change the reviewers and override the approval authority; the approvers follow the authority (`update_review_routing()`).
- **Reviewers routed to a file (since 2026-11-08, `20261108_reviewer_signoff.sql`, Q-13):** act in order. The current reviewer (lowest order without a sign-off), while in REVIEW, marks the checklist (OK / Needs revision + remark per item) and Endorses or Doesn't endorse with a justification, or returns the file to the CO (Minor / Major + what to fix) (`submit_review()`). Not an approval or a rejection. Sign-offs and returns can't be edited or deleted (`review_decisions`).
- **Approvers routed to a file:** see it under "Mine" in the work tray and open the review summary. Since 2026-11-10 (`20261110_approver_decision.sql`), while in APPROVAL and once each: Approve, Approve with conditions or Disapprove (`submit_approval()`); decisions can't be edited (`approval_decisions`).
- **AI extraction** (2026-11-09, `decisions/ai-extraction.md`): the assigned AO confirms applicant documents' values on `/documentCheckPage`; any active CI confirms NFIS / TU values while in Credit Investigation. Staff who can open the file read the extractions; the applicant never sees them.
- **MRAC** (`decisions/mrac-rag.md`): the assigned CO runs the check; any staff member can ask a policy question and reads only their own questions; staff read the policy passages and criteria.
- **Document requests** (branch `feature/deferral-loop`): only the assigned AO opens and closes them; staff who can open the file see them read-only; the applicant sees only their own.
- The applicant does not see the Financial Package or the credit score.
- **Staff profile gate:** staff must enter a first and last name before using staff pages, and before they can be assigned (enforced in the database too).
- **OCR output** (`ocr_runs`, `ocr_lines`): readable by staff with access to the application. Only the OCR worker writes it.
- **Notifications** (`notifications`, 2026-10-24): every user, applicants included, reads only their own and marks them read (`mark_notifications_read()`). No one writes them from the browser; only `send_notification()` creates them (triggers, SQL, service role). Applicants only ever receive the `APPLICANT_*` kinds (Submitted, Under review, Incomplete, and since 2026-10-29 Outcome), which carry no internal detail. Staff notices carry the application number only, no borrower names or amounts. Per-kind on / off switches (`notification_switches`) are set in the SQL Editor only.
- **Messages** (`messages`, 2026-10-28, staff only: the bank, Q-42; `decisions/messages.md`). Read: everyone who can read the file (`staff_can_access()`; a CI only once the file has a CI request). Post (`post_message()`), at every stage including Decided: the assigned AO or CO, the CI once a CI request exists, a Reviewer or Approver only while routed on the file, the Dispatch Admin and the Dept Head always. Everyone else with access reads only; applicants never see or post. Staff must have a profile name. Plain text, 2000 characters. Each message records the sender's role and the stage. Messages can't be edited or deleted by anyone and are not copied into `audit_log`. A new message sends `MESSAGE_POSTED` (application number only) to the people on the file.
- **Applicant outcome notices** (`applicant_notices`, 2026-10-29, the bank's Q-42 answers; `decisions/applicant-notices.md`). Only the assigned AO sends them (`send_applicant_notice()`), once the status is APPROVED, REJECTED or DEFERRED: one per outcome plus corrections, with a reason (required for Rejected and Deferred, at most 300 characters, no links). Staff who can read the file see the notices and their delivery status; nobody can edit or delete them. The applicant gets it in-app and by SMS and email (log mode until Q-04) and sees the outcome only after it. SMS / email rows are read and written only by the notice worker (service role). Document request messages are notices too (outcome `DOCUMENTS_NEEDED`).

**Assignment (Q-12).** Only AOs and COs are assigned to files. AOs and COs claim or release files themselves. Dispatch Admin, Reviewer, Approver and Dept Head can assign, reassign or unassign any AO/CO. History is in `application_assignments`.

## The four lists
| Source | Roles |
|---|---|
| Sec. 1.3 and BPMN lanes (6, plus an empty Loaner lane) | Account Officer, Credit Investigator, Dispatch Admin (BPMN: "Credit Officer Admin"), Credit Officer, Reviewer, Approver |
| Sec. 1.4.1 and Figure 2 (7) | Account Officer, Credit Investigator, Credit Officer, Credit Evaluator, Approver, Credit Department Head / Management, Loan Applicant |
| Sprint 0, Sec. 3.2.4.3.1 (8) | Account Officer, Credit Investigator, Dispatch Admin, Credit Officer, Reviewer, Approver, Credit Department Head, Loan Applicant |
| Sec. 1.4.2.3 (extra) | adds "Committee Members" |

Other names in interviews: "Credit Evaluation Officer" (CEO), "Credit Underwriter", Marketing (solicits accounts and is part of the home loan approving authority), Support, Secretary, Section / Division Head, President. No Figure 2 user maps to Reviewer or Dispatch Admin.

## Roles as described in the paper (Sprint 0 set)
| Role | Sees | Does (source) |
|---|---|---|
| **Account Officer (AO)** | Own applications, KYC data, extracted fields | Collates requirements; submits the intake form; encodes the KYC tab; asks the applicant for clarification (phone; email for OFW); confirms OCR values (HITL #1); requests CI by updating the tracker; receives the final endorsement; routes physical documents for approval. (1.4.1, BPMN, App. G) |
| **Credit Investigator (CI)** | CI requests, applicant profile, evidence | Evaluates CI request details; sets Pending; runs NFIS, TU and BRAS; uploads results to the applicant folder; marks NFIS/TU "DONE"; asks the AO for information when details are incomplete; also Desk CI and Field CI. About 2 h per case. Tracker access is unclear (Q-11). |
| **Dispatch Admin** (BPMN: Credit Officer Admin) | Whole tracker | Monitors the NFIS/TU tab; assigns a Credit Officer and messages them; monitors deferred accounts; forwards AO updates; monitors the FP for complete reviewer tick marks; sends the final endorsement to the AO. First entry and last exit of every account in the tracker. (BPMN A.3, App. I, K) |
| **Credit Officer (CO)** | FP, KYC, CI results, documents, policy flags | Verifies IDs and AO inputs; encodes CI results into the FP; applies the daily exchange rate for foreign-currency accounts; computes gross income; runs DBR; scores credit; decides endorse / not endorse / defer; adds terms and a short justification; marks "Credit Evaluator" tab Done. (BPMN A.4) |
| **Credit Evaluator** | Applications and policy guardrails | Audits AI-extracted risk exceptions. Appears only in Sec. 1.4.1 and Figure 2. Not a separate role in the enum; treated as the Credit Officer (Q-01, decided). |
| **Reviewer** | FP and documents | Checks documents and computation; requests revision from the CO through GChat; ticks the FP checkbox; the first reviewer also requests Desk and Field CI; loops if there is another reviewer. (BPMN A.5) |
| **Approver** | FP summary, transcript, exceptions | Reviews and signs; the secretary updates the tracker to "Approved" and ticks the Approver checkbox (BPMN A.6). Tiers in `approval-rules.md`. |
| **Credit Department Head / Management** | Aggregate dashboards | Monitors velocity and stage timelines; addresses bottlenecks; oversees escalations (1.4.1). Also a Stage 2 approver on the tracker Approval tab. |
| **Loan Applicant** | Own dashboard only | Master profile, checklist wizard, uploads, deficiency notices, status view (1.4.1, 1.6.2). **A system user (Q-02, decided by implementation).** |

## Rules stated in the documents
- Role-based access enforced at the database layer (Supabase RLS); credential-based field masking (1.4.2.3, 3.2.4.2).
- Applicants only view and modify their own dashboard; internal tiers get rights matching their silo (1.4.2.3).
- No free editing of accounts. The current shared Google Sheet lets anyone edit with no record of who changed what (App. I). The audit trail must record data changes, agent runs, human confirmations and file views (1.4.3).
- Single shared login is a current pain point (App. H).
- Maker-checker: whoever encodes is checked by someone else (App. I).
- Every agent output needs a human confirmation, and the confirming role is recorded (3.2.4.3, Sprint 4).
- A role sees and does only its part. Marketing was described as having its own limited view: approve, attach documents, endorse (App. I).
- Whether CI should encode its own results was open (App. I, Sec. L). **Decided by implementation 2026-11-08 (Q-11):** the CI encodes them.
- Access rules will be constrained by the pending Data Privacy Officer / Security sessions (Q-04).

## Capability matrix (what the documents state, plus what is built; blank = not stated)
| Capability | AO | CI | Admin | CO | Reviewer | Approver | Dept Head | Applicant |
|---|---|---|---|---|---|---|---|---|
| Start / submit application | Y (AO input page is a placeholder) | | | | | | | Y (built) |
| Edit submitted record (built) | Y (assigned, INTAKE or CI) | | | | | | | |
| Record KYC check per section (built) | Y (assigned, INTAKE or CI) | | | | | | | |
| Assign AO / CO (built) | self only | | Y | self only | Y | Y | Y | |
| Create staff accounts, set approver positions (built) | | | | | | | Y | |
| Confirm extracted fields (HITL #1) | Y | | | | | | | ? (1.4.2.1 says "or Applicant") |
| Request CI | Y (built: assigned, INTAKE, NFIS + TU) | | | | Y (first reviewer, Desk/Field; out of scope for now, Q-13) | | | |
| View CI request (built) | | Y (requested files only) | | | | | | |
| Enter CI results, mark CI Done (built) | | Y (any CI, in CREDIT_INVESTIGATION; Q-11) | | | | | | |
| Compute income / ratios | | | | Y (built: FP, assigned) | | | | |
| Score credit (built) | | | | Y (assigned) | | | | |
| Endorse / not endorse / defer | | | | Y (built: Credit Result on the FP) | | | | |
| Pick reviewers; send to Review (built; authority and approvers from the matrix) | | | | Y (assigned) | | | | |
| Answer a reviewer's return and resend (built) | | | | Y (assigned) | | | | |
| Change reviewers, override the authority after sending (built) | | | Y | | | | Y | |
| Read messages on a file (built) | Y | Y (once CI requested) | Y | Y | Y | Y | Y | |
| Post messages on a file (built) | Y (assigned) | Y (once CI requested) | Y | Y (assigned) | Y (routed) | Y (routed) | Y | |
| Send outcome notice to the applicant (built) | Y (assigned) | | | | | | | |
| Review FP, request revision | | | | | Y (built: checklist, Endorse / Not endorse, return; current reviewer only) | | | |
| Approve / Reject / Defer | | | | | | Y (Q-23; not built) | Y (Stage 2) | |
| Review policy flags (HITL #2) | ? (App. L) | | | ? (3.2.4.2) | | ? (1.4.2.3) | | (Q-20) |
| Aggregate dashboard | | | | | | Y | Y | |
| Own application only | | | | | | | | Y |
