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

**How roles are given (Q-41, `decisions/role-storage.md`).** Self sign-up always creates an APPLICANT. The Dept Head creates staff logins on `/staffAccountsPage` and gives the role with `grant_staff_role()`. This only works for accounts that are still plain applicants with no loan application. Every grant is logged in `staff_role_grants`. The role is stored in `public.users.role`; clients can't change it.

**Who sees what (RLS)**
- **Applicant:** reads their own applications and edits them only while DRAFT. After submission, read-only.
- **CI, Dispatch Admin, Reviewer, Approver, Dept Head:** read every submitted application in full.
- **AO, CO:** see the work tray summary of every submitted application. They see the full record only when assigned to it.
- **Assigned AO, while the file is in INTAKE:** edits the submitted record in place, uploads files into the applicant's folder, and records a KYC check per form section (Verified / Needs clarification + remarks, table `kyc_checks`). Every edit after submission is logged in `audit_log`. Everyone else with access is read-only.
- **Staff profile gate:** staff must enter a first and last name before using staff pages, and before they can be assigned (enforced in the database too).
- **OCR output** (`ocr_runs`, `ocr_lines`): readable by staff with access to the application. Only the OCR worker writes it.

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
- Whether CI should encode its own results is open (App. I, Sec. L).
- Access rules will be constrained by the pending Data Privacy Officer / Security sessions (Q-04).

## Capability matrix (what the documents state, plus what is built; blank = not stated)
| Capability | AO | CI | Admin | CO | Reviewer | Approver | Dept Head | Applicant |
|---|---|---|---|---|---|---|---|---|
| Start / submit application | Y (AO input page is a placeholder) | | | | | | | Y (built) |
| Edit submitted record (built) | Y (assigned, INTAKE only) | | | | | | | |
| Record KYC check per section (built) | Y (assigned, INTAKE only) | | | | | | | |
| Assign AO / CO (built) | self only | | Y | self only | Y | Y | Y | |
| Create staff accounts (built) | | | | | | | Y | |
| Confirm extracted fields (HITL #1) | Y | | | | | | | ? (1.4.2.1 says "or Applicant") |
| Request CI | Y | | | | Y (first reviewer, Desk/Field) | | | |
| Enter CI results | | ? (Q-11) | | Y (as-is) | | | | |
| Compute income / ratios | | | | Y | | | | |
| Endorse / not endorse / defer | | | | Y | | | | |
| Review FP, request revision | | | | | Y | | | |
| Approve / Reject / Defer | | | | | | Y (Q-23; not built) | Y (Stage 2) | |
| Review policy flags (HITL #2) | ? (App. L) | | | ? (3.2.4.2) | | ? (1.4.2.3) | | (Q-20) |
| Aggregate dashboard | | | | | | Y | Y | |
| Own application only | | | | | | | | Y |
