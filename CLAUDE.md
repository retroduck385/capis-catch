# CATCH: Centralized Application Tracking and Completeness Hub

Capstone prototype (DLSU BSIS, Group 2524) for the housing loan pre-approval process of a Philippine bank.
CATCH is a decision SUPPORT system. It prepares and flags; people decide. Every AI output passes a human confirmation gate.

## Read first

- `docs/` is the source of truth. Read the relevant file before building a feature.
- Items tagged **Q-nn** are NOT decided unless marked **DECIDED**. They live in [`docs/open-questions.md`](docs/open-questions.md). Do not build an undecided one as if decided. If docs are unclear or conflict, stop and ask.
- Decisions taken so far are in [`docs/decisions/`](docs/decisions/).
- The source PDFs (`capstone-main.pdf`, `capstone-appendices.pdf`) are in `docs/` and are gitignored. The `.md` files are distilled from them and cite paper sections.

| File | Holds |
|---|---|
| [requirements.md](docs/requirements.md) | Problems, modules, features F1-F16, technology, constraints |
| [roles-and-permissions.md](docs/roles-and-permissions.md) | Role lists, who sees and does what (paper and as built) |
| [status-flow.md](docs/status-flow.md) | As-is stages, implemented stage/status model, rules a transition must enforce |
| [data-fields.md](docs/data-fields.md) | Intake, KYC, CI, tracker fields |
| [document-requirements.md](docs/document-requirements.md) | Checklist per borrower type, and how the code differs |
| [computations.md](docs/computations.md) | Income, AMD, amortization, DBR, LTV |
| [approval-rules.md](docs/approval-rules.md) | Approval tiers, approver decision, MRAC |
| [sprints.md](docs/sprints.md) | Sprint scope, definition of done, what is built |
| [pain-points.md](docs/pain-points.md) | Interview findings and baselines |
| [glossary.md](docs/glossary.md) | Terms and abbreviations |
| [decisions/](docs/decisions/) | applicant-portal, role-storage, ocr-engine, ai-extraction, mrac-rag, notifications, messages, applicant-notices, document-requests |

## Hard rules (never break these)

1. **NDA.** Never write the partner bank's name anywhere (code, comments, commits, seed data). Say "the bank". Refer to people by role, never by name. See [requirements.md](docs/requirements.md) (header) and [sprints.md](docs/sprints.md) (policy turnover under NDA). Public repo NDA review pending.
2. **No real data.** Never commit real borrower data or real bank policy files. Synthetic documents only. Real policy source files stay out of git (`data/policies/`, `mrac-service/.gitignore`). See [requirements.md](docs/requirements.md) (Constraints), Q-04.
3. **Secrets** (Supabase service role key, Anthropic API key, Semaphore and Brevo API keys) live only in `services/api/.env`, `ocr-service/.env`, `mrac-service/.env` and `notice-service/.env`. The OCR, MRAC and notice workers use the service role key; the OCR worker also holds `ANTHROPIC_API_KEY`; the notice worker holds the Semaphore and Brevo keys. The frontend only gets the Supabase anon key. Related: Q-04.
4. **Staging first.** AI extraction output goes to a staging table (`extraction_runs` / `extraction_fields`), never straight into the application record. A human confirms first: the assigned AO for applicant documents (`confirm_extraction()`), any active CI for NFIS / TU reports (`confirm_ci_extraction()`) (Q-06, decided by implementation). See F15 in [requirements.md](docs/requirements.md) and [decisions/ai-extraction.md](docs/decisions/ai-extraction.md).
5. **One status path.** `loan_applications.status` and stage status change only through Postgres functions (`submit_application`, `assign_application`, `unassign_application`, `request_ci`, `complete_ci`, `send_for_review`, `submit_review`, `resend_for_review`, `submit_approval`; `save_ci_findings` / `add_ci_document` only move Credit Investigation from Requested to In Progress) and the `open_intake_on_submit` trigger. Clients have no direct write access to them. No other code may update them. `services/api/app/services/transitions.py` is the planned home once FastAPI exists. Built moves: Intake → Credit Investigation (`request_ci`), Credit Investigation → Credit Evaluation (`complete_ci`), Credit Investigation or Credit Evaluation → Review (`send_for_review`), Review → Credit Evaluation as RETURNED and back (`submit_review` with a return, `resend_for_review`), Review → Approval after the last reviewer signs off (`submit_review`), Approval → Decided with APPROVED or REJECTED (`submit_approval`). Nothing sets DEFERRED or FOR_CLARIFICATION, by design: approvers only approve or disapprove, and deferral is told to the applicant with a document request, which never changes the status. See [status-flow.md](docs/status-flow.md).
6. **Append-only audit.** `audit_log` allows no UPDATE or DELETE, ever. It must cover data changes, agent executions, human confirmations (with the confirming role) and file views. See [requirements.md](docs/requirements.md) (Sec. 1.4.3) and [roles-and-permissions.md](docs/roles-and-permissions.md). **Open gap:** `audit_log` exists (`20261007_ao_kyc_verification.sql`). Triggers log every change to a submitted application (including the Financial Package, credit score, review-routing, CI, reviewer and approver decision tables, and document requests), AI extraction runs finishing or failing, and extraction confirmations; clients can't write to it. But no trigger blocks UPDATE or DELETE by the table owner or service role, MRAC runs are not logged there, and file views are not logged. Stage changes (`stage_status_changes`) and role grants (`staff_role_grants`) are logged in their own tables. Folder messages are their own append-only trail (`messages`, guarded against UPDATE / DELETE / TRUNCATE for everyone, owner and service role included) and are not copied into `audit_log`.
7. **Policy text only in the vector store.** Only institutional policy text is embedded (`policy_chunks`, Supabase pgvector; replaces the paper's Chroma). No applicant data. See [requirements.md](docs/requirements.md) (Technology) and [decisions/mrac-rag.md](docs/decisions/mrac-rag.md).
8. **Cited flags.** Every RAG risk flag carries the policy passage it came from. A flag without a citation is a bug. See F16 in [requirements.md](docs/requirements.md) and MRAC in [approval-rules.md](docs/approval-rules.md).

Also: the system never auto-rejects, and auto-approval is not in the paper's design ([approval-rules.md](docs/approval-rules.md)). One paper sentence (Sec. 2.1.2.4) says MRAC failure means automatic decline; the rest of the paper says flag only (Q-19). The MRAC check as built only suggests. Only synthetic documents may be sent to an external model (paper Sec. 3.2.2.4; the AI extraction sends OCR text to the Claude API); external-model rules are pending the Data Privacy and Security sessions (Q-04).

## Stack

- Frontend: React + Vite, plain JavaScript (JSX), in `catch/` (paper Sec. 3.2.4.2)
- Styling: Tailwind CSS v4 (via @tailwindcss/vite)
- Routing: React Router (react-router-dom, createBrowserRouter in src/router.jsx)
- Auth (frontend): Supabase Auth email/password via src/context/authContext.jsx, which also loads the user's role
- Backend API and agents (planned): Python, FastAPI, LangGraph, LangChain, in `services/api`
- Database and auth: Supabase (PostgreSQL + Auth + Row Level Security + Storage + pgvector). Migrations are in `catch/supabase/migrations/` and are run by hand in the Supabase SQL Editor, in the order given in each file's header. Order after `20261029_applicant_notices.sql`: `20261105_mrac_rag` (needs the vector extension), `20261108_approval_matrix` (on its own, it adds enum values), `20261108_approver_positions`, `20261108_ci_results`, `20261108_ocr_realtime`, `20261108_reviewer_signoff`, `20261109_ai_extraction`, `20261109_ci_extraction`, `20261109_mrac_search_products`, `20261109_trim_loan_purposes`, `20261110_approver_decision`. Not merged yet (branches): `20261111_notification_fixes`, `20261111_money_cents_labels`, `20261112_document_requests`, in that order, each after `20261110_approver_decision`. After the 20261108 files, `20261007_id_ocr.sql`, `20261010_staff_accounts.sql` and `20261021_review_routing.sql` can no longer be re-run (they stop with an error); a fresh run of the whole chain in header order works. Re-running `20261007_id_ocr` or `20261010_ocr_income_docs` needs `20261109_ai_extraction` and then `20261109_ci_extraction` again; re-running `20261024_notifications` or `20261029_applicant_notices` needs the 20261111 / 20261112 files again.
- Frontend layout: every signed-in page is wrapped in `src/components/appLayout.jsx` (sidebar plus a top bar holding the notification bell; the top bar stays at the top while scrolling on branch `fix/notification-fixes`), styled by `src/theme.css` and `src/applicantTheme.css` (light only). Staff pages have breadcrumbs (`breadcrumbs.jsx`) and skeleton loading screens (`skeleton.jsx`).
- Money: show every amount with the peso sign and cents, `formatPeso()` / `formatMoney()` in `src/pages/applicationForm/options.js` (₱1,500,000.00); money inputs show cents once you leave the box (branch `fix/money-cents`). Display only: stored values and calculations don't change.
- OCR: PaddleOCR, run locally by `ocr-service/worker.py`. The worker is woken by Realtime INSERTs on `ocr_runs` (`20261108_ocr_realtime.sql`) with a slow fallback poll, and also reads the CI's uploaded reports (`ci_documents`). Replaces Claude Vision from the paper (see [decisions/ocr-engine.md](docs/decisions/ocr-engine.md)).
- AI extraction: the OCR worker sends the OCR text lines (never the file) to the Claude API (`ocr-service/extract.py`, default model `claude-opus-5-5`, `ANTHROPIC_MODEL` to change it); with no key, runs stay queued. Values go to staging and are confirmed on `/documentCheckPage` ([decisions/ai-extraction.md](docs/decisions/ai-extraction.md)). The two migrations' comments still say Gemini; the code uses Claude.
- MRAC / policy RAG: `mrac-service/` (Python worker): rules engine, hybrid retrieval over `policy_chunks` (pgvector + full-text), template explanations, no LLM. Criteria are loaded disabled; the default embedding provider is an offline stub, not semantic ([decisions/mrac-rag.md](docs/decisions/mrac-rag.md)).
- Applicant SMS / email: `notice-service/worker.py` (Python), Semaphore for SMS and Brevo for email. Log mode by default (prints, sends nothing); live sending only to an allowlist until Q-04 clears. In live mode SMS is optional (empty `SEMAPHORE_API_KEY` = email only, SMS LOGGED), and each claimed batch is sent oldest first. Live test 2026-11-09: email SENT through Brevo to a team address, SMS LOGGED; emails land in spam until a team-owned domain is authenticated in Brevo. See [decisions/applicant-notices.md](docs/decisions/applicant-notices.md).
- LangGraph checkpoints (planned): stored in the same Postgres database (standalone prototype, no live link to the bank's systems)

## How the pieces talk

- Frontend READS data directly from Supabase. Row Level Security decides what each role can see (masking and access at the database layer: [roles-and-permissions.md](docs/roles-and-permissions.md)).
- Today, the frontend WRITES directly to Supabase, either to tables RLS allows or through `security definer` Postgres functions (`submit_application`, `assign_application`, `grant_staff_role`, ...). FastAPI does not exist yet. Once it does, important writes (status changes, uploads that trigger AI, computations, decisions) are meant to go through it.
- Simple low-risk writes (marking a notification read) may go direct to Supabase if RLS covers them.
- Folder messages are written only by `post_message()` (security definer; the browser cannot insert into `messages`). They are staff only and can never be edited or deleted. See [decisions/messages.md](docs/decisions/messages.md).
- The OCR worker talks to Supabase with the service role key: it listens for new `ocr_runs` through Realtime, claims queued runs with `claim_ocr_runs()` (applicant documents and CI reports) and writes `ocr_lines`; then claims `extraction_runs` (`claim_extraction_runs()`), calls the Claude API on the text and saves the proposed values with `save_extraction()`.
- The MRAC worker talks to Supabase with the service role key: it claims `mrac_runs` (`claim_mrac_runs()`, queued by `request_mrac_check()` / `ask_policy()`), searches `search_policy()` and saves the cited result on the run.
- The notice worker talks to Supabase with the service role key: it claims queued SMS / email rows with `claim_notice_deliveries()`, checks the text again with `notice_link_in()`, and records the result with `finish_notice_delivery()`.
- Applicant outcome notices (Approved / Rejected / Deferred) are sent only by the assigned AO through `send_applicant_notice()` (security definer): in-app at once, SMS and email queued for the notice worker. Never automatically. `applicant_notices` is append-only.
- Document requests (branch `feature/deferral-loop`): the assigned AO sends "What we need" through `open_document_request()`; the message is an `applicant_notices` row (outcome `DOCUMENTS_NEEDED`) using the same queue; the applicant uploads through `add_requested_document()` into the request's folder and sends with `send_requested_documents()`; the AO closes with `close_document_request()`. See [decisions/document-requests.md](docs/decisions/document-requests.md).
- Notifications are created only by `send_notification()` (security definer): from triggers, other SQL functions, or the service role (OCR worker, FastAPI). Never from the browser. Users read their own (RLS), get new ones live through Supabase Realtime, and mark them read with `mark_notifications_read()`. See [decisions/notifications.md](docs/decisions/notifications.md).
- Planned: FastAPI verifies the user's Supabase JWT on every request and checks the role before acting. LangGraph graphs run inside FastAPI, pause at human gates (interrupts) and resume when a user confirms in the UI.

## Folder map

```
catch/                      Vite + React app, JavaScript, Tailwind CSS v4.
  src/main.jsx              entry point; wraps the app in AuthContextProvider and RouterProvider
  src/router.jsx            route table (below)
  src/roles.js              role lists (STAFF_ROLES, ASSIGNING_HEADS, ASSIGNABLE_ROLES, REVIEW_ROLES, ROUTING_HEADS), labels, home path per role
  src/context/authContext.jsx  Supabase session, role (from public.users), signUp / signIn / signOut
  src/supabaseClient.js     Supabase client (anon key only, from catch/.env), plus a detached client for creating staff logins
  src/components/           privateRoute (session + role guard; wraps the page in appLayout), appLayout (sidebar + top bar with the notification bell), authLayout, breadcrumbs, skeleton, applicantShell, homeRedirect, staffProfileGate, notificationBell
  src/theme.css, src/applicantTheme.css  app theme (scoped to .ct, light only)
  src/pages/
    loginPage, signUpPage
    applicantHomePage, profilePage           applicant home and master profile
    applicationFormPage, applicationForm/    multi-step form wizard (steps/, api, validators, options incl. formatMoney / formatPeso)
    adminHomePage                            staff home: the work tray
    workTray/                                FIFO tray, claim / assign, TAT state, dashboard overview
    loanFolder/                              staff view of one application; AO edits, KYC checks, CI request panel, change history
    ciRequest/                               AO's "Request CI" panel; CI's view of the NFIS / TU request forms; CI results entry and Mark CI Done (ciResults.jsx)
    documentCheck/                           AI extraction check: document viewer beside the values, compare with the application, confirm & lock (AO; CI for NFIS / TU)
    financialPackage/                        CO's Financial Package, computations (compute.js), credit scoring
    mrac/                                    MRAC policy check panel and "Ask policy" on the Financial Package
    review/                                  CO's review routing; reviewer / approver summary; reviewer checklist, sign-off and return; approver decision (approvalParts.jsx)
    notifications/                           notification data for the bell (api, useNotifications with Realtime), applicant status labels (applicantStatus.js, applicantStatusLabel.jsx)
    messages/                                staff-only message panel for one loan file (api, useMessages with Realtime, messagesPanel)
    applicantNotices/                        the AO's "Send notice to applicant" panel in the loan folder (api, sendNoticePanel, sms)
    documentRequests/                        (branch feature/deferral-loop) the AO's "Ask the applicant for documents" panel and the applicant's "Documents needed" card
    staffProfilePage                         staff fill in their name (required before use)
    staffAccounts/                           Dept Head creates staff logins and sets approver positions
    accountOfficerApplicationInputPage       AO-entered intake (placeholder)
  supabase/migrations/      dated SQL migrations, run by hand in order (see each file's header)
  supabase/seed/            synthetic test accounts, one per role
ocr-service/                PaddleOCR worker plus Claude text extraction (Python 3.13 venv): worker.py, ocr.py, extract.py, requirements.txt, .env (gitignored)
mrac-service/               MRAC / policy RAG worker (Python): mrac/ (rules engine, retrieval, ingestion, reasoning), rules/, tests/, worker.py, .env (gitignored)
notice-service/             applicant SMS / email worker (Python 3.10+): worker.py, providers.py (log, Semaphore, Brevo), requirements.txt, .env (gitignored)
supplementary_files/        synthetic test data sets (Test Datas # 1, # 2) are tracked; everything else there (local PGlite suites, notes) is gitignored
docs/                       source of truth for requirements; decisions in docs/decisions/

PLANNED (not created yet):
services/api/app/           routers/, services/ (transitions, audit, notifications, computations), graphs/, agents/, schemas/, db/
services/api/tests/
data/synthetic/             fake loan documents for testing
data/ground_truth/          labeled answers for extraction accuracy tests
data/policies/              real policy text, gitignored
```

Routes: `/` → `/loginPage`; `/signUpPage`; `/homePage` (redirects by role); staff only: `/adminHomePage`, `/loanFolderPage?id=`, `/documentCheckPage`, `/staffProfilePage`, `/staffAccountsPage` (DEPT_HEAD), `/accountOfficerApplicationInputPage` (ACCOUNT_OFFICER), `/ciRequestPage?id=` (CREDIT_INVESTIGATOR), `/financialPackagePage?id=`, `/creditScorePage?id=`, `/approvalRoutingPage?id=`, `/reviewSummaryPage?id=`; applicant only: `/applicantHomePage`, `/applicationFormPage`, `/profilePage`.

Existing table names: `users`, `user_profile`, `loan_applications`, `applicants`, `documents`, `application_requirements`, `application_stages`, `stage_status_changes`, `stage_tat`, `application_assignments`, `audit_log`, `kyc_checks`, `staff_role_grants`, `ocr_runs`, `ocr_lines`, `ocr_pages`, `extraction_field_defs`, `extraction_runs`, `extraction_fields`, `extraction_field_lines`, `ci_requests`, `financial_packages`, `fp_party_details`, `fp_exceptions`, `fp_deposit_checks`, `fp_loan_checks`, `fp_trade_checks`, `fp_title_verifications`, `credit_score_criteria`, `credit_score_bands`, `credit_score_entries`, `review_assignments`, `approval_decisions`, `policy_chunks`, `mrac_criteria`, `mrac_runs`, `notifications`, `notification_switches`, `messages`, `message_reads`, `applicant_outcomes`, `applicant_notices`, `applicant_notice_deliveries`, `ci_checks`, `ci_documents`, `review_check_items`, `review_decisions`, `review_decision_items`. On branch `feature/deferral-loop`: `document_requests`, `document_request_items`, `document_request_uploads`. Also `users.approval_position` (Approver accounts only).

## Roles (enum `user_role`)

APPLICANT, ACCOUNT_OFFICER, CREDIT_INVESTIGATOR, DISPATCH_ADMIN, CREDIT_OFFICER, REVIEWER, APPROVER, DEPT_HEAD

- The role is stored in `public.users.role`. Self sign-up always creates APPLICANT; the Dept Head creates staff accounts and grants roles with `grant_staff_role()` ([decisions/role-storage.md](docs/decisions/role-storage.md)).
- `DISPATCH_ADMIN` is "Credit Officer Admin" in the BPMN. "Credit Evaluator" is the Credit Officer. Committee Members are not modeled.
- Approver accounts carry a position (`approval_position`: Credit Dept Head, Credit Division Head, Lending Dept Head, Lending Division Head, President, Senior Credit Committee, Executive Committee, Board), set by the Dept Head. Positions only, no new roles. A committee is one account that decides as a body.
- The applicant is a system user with a self-service portal ([decisions/applicant-portal.md](docs/decisions/applicant-portal.md)).

## Application status flow

Full detail in [status-flow.md](docs/status-flow.md). Two layers plus an applicant-facing status:

- Stage (`workflow_stage`): INTAKE → CREDIT_INVESTIGATION → CREDIT_EVALUATION → REVIEW → APPROVAL → DECIDED. Dispatch is an assignment action, not a stage.
- Status inside a stage (`stage_status`): PENDING, IN_PROGRESS, REQUESTED, RETURNED, DONE.
- Applicant-facing (`application_status`): DRAFT, SUBMITTED, FOR_CLARIFICATION, UNDER_CI, UNDER_CREDIT_EVALUATION, DEFERRED, UNDER_REVIEW, FOR_APPROVAL, APPROVED, REJECTED. Outcomes set today are Approved / Rejected; DEFERRED and FOR_CLARIFICATION are dormant by design; Refer is not modeled.
- What the applicant actually sees: Draft, Submitted, Incomplete submission, Under review, or the outcome (Approved / Rejected / Deferred), never the internal value. An outcome shows only after the assigned AO has sent the notice for it; until then "Under review". On branch `feature/deferral-loop`, "Documents needed" / "Documents sent" while a document request is open. Mapping in `applicant_status_bucket()` / `applicant_visible_status()` (SQL) and `src/pages/notifications/applicantStatus.js`.
- Assignment: AOs and COs claim files from the FIFO tray; Dispatch Admin, Reviewer, Approver and Dept Head assign, reassign or unassign.
- CI results: any active CI works any file with a CI request while it is in Credit Investigation (no claiming). Per borrower and per check (NFIS, TU, BRAS): report files, a result and a summary. "Mark CI Done" (`complete_ci()`) needs an NFIS and a TU result and report for every borrower, then opens Credit Evaluation (status UNDER_CREDIT_EVALUATION). NFIS / TU reports are also AI-read; the CI confirms the values and the proposed result.
- Review routing: the assigned CO picks the reviewers (in order) and sends the file to Review (`review_assignments`). The approval authority comes from the bank's matrix (loan amount, one step up with a row in V. Exception/s), and every active Approver whose position that authority needs is routed automatically. After sending, only the Dept Head or Dispatch Admin can change the reviewers or override the authority (`update_review_routing()`).
- Reviewer sign-off: reviewers act in order. The current reviewer marks a checklist (OK / Needs revision), then Endorses or Doesn't endorse with a justification, or returns the file to the CO (Minor / Major). A return reopens Credit Evaluation as RETURNED; the CO answers and resends (`resend_for_review()`), and review continues from the reviewer who returned it. After the last sign-off the file moves to Approval (status FOR_APPROVAL). Neither endorsement is an approval or a rejection.
- Approver decision (`submit_approval()`, 2026-11-10): each routed approver Approves, Approves with conditions or Disapproves (with a reason), once. APPROVED when the approvals meet the authority; REJECTED when they no longer can. Approval → Decided. No Defer.
- Deferral loop (branch `feature/deferral-loop`): at the AO, CO or reviewer step the assigned AO sends the applicant a document request; the applicant uploads only those documents and sends them; the AO checks and closes it. No status change.
- Turnaround: one target per stage in `stage_tat`, "near" at 75 %. Day values are placeholders until the bank's SLA is known (Q-09).
- Still open: the "verified" threshold for CI (Q-11 rest; the bank hasn't given it), where pre-approval ends (Q-05). Desk / Field CI and the first reviewer's CI request are out of scope for now (Q-13).

Rules from the docs:
- Check-and-return loops exist at the AO, CO and Reviewer. A deferral returns the file to the earlier stage that owes the information. "Pending Customer Correction" is the paper's example state.
- Every transition writes a system timestamp, one stage-status row and one audit row, then notifies the next role. (Notifications built in `20261024_notifications.sql`, in-app only, by triggers on the workflow tables.)
- A "Done" status must not silently revert; the reversal must notify. (Not prevented. A reopened Done now notifies (DONE_REVERTED), but nothing reopens one today.)
- Submission is blocked while a required decision input is absent. (Built: `submit_application()`.)
- Nothing an agent produces moves the file forward without a recorded human confirmation.

## Borrower scope

- The intake form already covers all 10 employment types (locally employed, licensed professional, seafarer, virtual assistant, commission-based, OFW, self-employed, rental business, PUV operator, pensioner). It also covers principal, spouse, any number of co-borrowers, mortgagor and attorney-in-fact (Q-08, Q-27 decided by implementation).
- The document checklist is `required_documents()` in SQL; where it differs from the paper is listed in [document-requirements.md](docs/document-requirements.md).
- The Financial Package computes income per borrower (COE 80 %, payslip 90 %, declared 100 %), amortization, DBR and LCR for every borrower type; the seafarer and self-employed (AMD) rules are not built. The MRAC check is built as cited suggestions (criteria disabled until credit policy enables them).

## Undecided (TBD), summary

Full text in [`docs/open-questions.md`](docs/open-questions.md). Do not pick an answer.

| Q | Topic |
|---|---|
| Q-04, Q-05 | Data privacy limits on external model calls (AI extraction, SMS / email providers); where pre-approval ends |
| Q-09 | TAT day values (structure is decided) |
| Q-11 | Partly decided: the CI encodes CI results. Still open: the "verified" threshold (the bank hasn't given it) |
| Q-13 | Decided by implementation (reviewers in order, sign-off, return). The first reviewer's Desk / Field CI request is out of scope for now |
| Q-14 | Partly decided (DBR and LCR definitions). Still open: cap values, DBR basis |
| Q-19, Q-20, Q-21 | MRAC failure outcome; who reviews policy flags (HITL #2); MRAC content (built as suggestion only, CO adopts; criteria disabled) |

Decided by implementation 2026-11-09 (recorded 2026-11-11): **Q-06.** The assigned AO confirms AI-extracted values of applicant documents; any active CI confirms NFIS / TU values ([decisions/ai-extraction.md](docs/decisions/ai-extraction.md)).

Decided by the bank (visit 2026-10-26) and built 2026-10-29: **Q-42.** Applicants are told the outcome (Approved / Rejected / Deferred) with a reason (Rejected: the policy they most likely did not pass; Deferred: what is missing), sent by the assigned AO, in-app and by SMS and email with no links; messaging is staff only. Live SMS / email sending waits for Q-04 (the worker runs in log mode). Deferral is now told with a document request (user, 2026-11-11). See [decisions/applicant-notices.md](docs/decisions/applicant-notices.md) and [decisions/document-requests.md](docs/decisions/document-requests.md).

## Current sprint

Built on main (Sprint 0 foundation plus parts of Sprints 1 to 5):
- Auth and roles with RLS
- Applicant intake form and submission gate
- Staff work tray with claim / assign, TAT state and a dashboard overview (on track / near / beyond); AOs and COs can open every submitted file read-only
- Loan folder where the assigned AO edits the record (Intake and Credit Investigation) and records per-section KYC checks
- CI request, CI results (NFIS / TU / BRAS per borrower) and Mark CI Done, which opens Credit Evaluation; CI reports are OCR'd and AI-read (NFIS, TU) and never visible to the applicant
- AI extraction: PaddleOCR text → Claude labels the fields → staging → the AO (applicant documents) or CI (NFIS / TU) confirms on `/documentCheckPage`
- Financial Package filled in by the assigned CO, with income, amortization, DBR and LCR computed in the front end, and a Credit Result (Endorsed / Not endorsed / Deferred)
- Credit scoring: the page suggests a band per criterion, the CO picks; the result is a guide only
- MRAC policy check and "Ask policy" (pgvector RAG, cited, suggestion only; criteria disabled until credit policy enables them)
- Review routing, reviewer sign-off (checklist, endorse / not endorse, return and resend) and the approver decision (Approve / Approve with conditions / Disapprove → Decided)
- Sidebar layout for every signed-in page (appLayout), breadcrumbs and skeleton loading screens
- Audit log of changes made after submission, AI extraction runs and confirmations
- Messages: a staff-only thread per loan file, live through Realtime, append-only
- In-app notifications for workflow events (including DECIDED since 2026-11-10)
- Applicant outcome notices: the assigned AO sends Approved / Rejected / Deferred with a reason from the loan folder; in-app at once, SMS / email queued for `notice-service/` (log mode until Q-04; live email tested 2026-11-09)

On branches, not merged yet (2026-11-11; `test/all-three` merges them locally for the click test, never pushed):
- `fix/notification-fixes`: approver reason / conditions in the AO's notice suggestions, DECIDED to approvers, reviewer turn wording, sticky top bar and readable bell count
- `fix/money-cents`: every money amount shows ₱ and cents
- `feature/deferral-loop`: document requests ("What we need"), Documents needed / sent for the applicant, REVIEW_RETURNED to the AO

Not built yet:
- FastAPI, LangGraph
- The AO's create-application page (placeholder only); applicants fixing their form after submission (only requested uploads, on the branch above)
- Desk / Field CI and the first reviewer's CI request (out of scope for now, Q-13)
- Live SMS / email for applicants beyond the allowlist (Q-04); a team-owned email domain in Brevo; TAT near / beyond alerts and real TAT values (Q-09); extraction ready / failed alerts
- AMD and seafarer income rules; BRAS extraction; Refer / Escalate; a policy-reason code on rejections
- GitHub checks or CI (no `.github`); `npm audit` reports 7 issues (3 high, incl. vite dev server and zod; a non-breaking `npm audit fix` is available)

Update this section when the sprint changes.

## Working style for Claude Code

- Read the relevant file in `docs/` before starting a feature.
- Plan first, then build. Show the plan and list the files you will touch.
- Build one vertical slice at a time: migration, RLS, backend endpoint, frontend screen, test.
- Never edit an old migration. Add a new one.
- The frontend is plain JavaScript. There are no generated database types; do not add TypeScript.
- Keep routers thin. Put logic in `services/`.
- If a requirement in `docs/` is unclear or conflicts with another, stop and ask instead of guessing.
- Update `docs/` when a decision changes. Record big decisions in `docs/decisions/`.
- Never add Co-Authored-By or Generated-with-Claude-Code lines to commits or PRs.
- Keep each file's line endings: the repository stores LF; this machine checks out CRLF (`core.autocrlf=true`). Check a commit with a tree-to-tree diff (`git -c core.autocrlf=false diff --stat <base> <commit>`), not `diff --cached`, which can read the CRLF working copy.
