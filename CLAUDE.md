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
| [approval-rules.md](docs/approval-rules.md) | Approval tiers, decisions, MRAC |
| [sprints.md](docs/sprints.md) | Sprint scope and definition of done |
| [pain-points.md](docs/pain-points.md) | Interview findings and baselines |
| [glossary.md](docs/glossary.md) | Terms and abbreviations |
| [decisions/](docs/decisions/) | applicant-portal, role-storage, ocr-engine |

## Hard rules (never break these)

1. **NDA.** Never write the partner bank's name anywhere (code, comments, commits, seed data). Say "the bank". Refer to people by role, never by name. See [requirements.md](docs/requirements.md) (header) and [sprints.md](docs/sprints.md) (policy turnover under NDA).
2. **No real data.** Never commit real borrower data or real bank policy files. Synthetic documents only. Real policy text lives only in `data/policies/` (gitignored). See [requirements.md](docs/requirements.md) (Constraints), Q-04.
3. **Secrets** (Supabase service role key, Anthropic API key) live only in `services/api/.env` and `ocr-service/.env` (the OCR worker uses the service role key). The frontend only gets the Supabase anon key. No docs file covers this; related: Q-04.
4. **Staging first.** AI extraction output goes to `extraction_staging`, never straight into the application record. A human confirms first. See F15 in [requirements.md](docs/requirements.md) and Sprint 1 in [sprints.md](docs/sprints.md). Who confirms: AO per Sprint 1; the paper says "AO or Applicant" in one place (Q-06). Today the OCR worker writes only raw lines to `ocr_runs` / `ocr_lines`; field mapping and `extraction_staging` are not built yet.
5. **One status path.** `loan_applications.status` and stage status change only through Postgres functions (`submit_application`, `assign_application`, `unassign_application`) and the `open_intake_on_submit` trigger. Clients have no direct write access to them. No other code may update them. `services/api/app/services/transitions.py` is the planned home once FastAPI exists. **Open gap:** no function yet moves a file between stages after Intake. See [status-flow.md](docs/status-flow.md).
6. **Append-only audit.** `audit_log` allows no UPDATE or DELETE, ever. It must cover data changes, agent executions, human confirmations (with the confirming role) and file views. See [requirements.md](docs/requirements.md) (Sec. 1.4.3) and [roles-and-permissions.md](docs/roles-and-permissions.md). **Open gap:** `audit_log` exists (`20261007_ao_kyc_verification.sql`). Triggers log every change to a submitted application, and clients can't write to it. But no trigger blocks UPDATE or DELETE by the table owner or service role. It does not log agent runs, human confirmations or file views. Stage changes (`stage_status_changes`) and role grants (`staff_role_grants`) are logged in their own tables.
7. **Policy text only in Chroma.** Only institutional policy text is embedded. No applicant data. See [requirements.md](docs/requirements.md) (Technology) and [sprints.md](docs/sprints.md).
8. **Cited flags.** Every RAG risk flag carries the policy passage it came from. A flag without a citation is a bug. See F16 in [requirements.md](docs/requirements.md) and MRAC in [approval-rules.md](docs/approval-rules.md).

Also: the system never auto-rejects, and auto-approval is not in the paper's design ([approval-rules.md](docs/approval-rules.md)). One paper sentence (Sec. 2.1.2.4) says MRAC failure means automatic decline; the rest of the paper says flag only (Q-19). Only synthetic documents may be sent to the external vision model (paper Sec. 3.2.2.4); external-model rules are pending the Data Privacy and Security sessions (Q-04).

## Stack

- Frontend: React + Vite, plain JavaScript (JSX), in `catch/` (paper Sec. 3.2.4.2)
- Styling: Tailwind CSS v4 (via @tailwindcss/vite)
- Routing: React Router (react-router-dom, createBrowserRouter in src/router.jsx)
- Auth (frontend): Supabase Auth email/password via src/context/authContext.jsx, which also loads the user's role
- Backend API and agents (planned): Python, FastAPI, LangGraph, LangChain, in `services/api`
- Database and auth: Supabase (PostgreSQL + Auth + Row Level Security + Storage). Migrations are in `catch/supabase/migrations/` and are run by hand in the Supabase SQL Editor, in the order given in each file's header.
- OCR: PaddleOCR, run locally by `ocr-service/worker.py`. Raw text lines only, no LLM field mapping yet. Replaces Claude Vision from the paper (see [decisions/ocr-engine.md](docs/decisions/ocr-engine.md)).
- Vector store (planned): Chroma, locally hosted
- LangGraph checkpoints (planned): stored in the same Postgres database (standalone prototype, no live link to the bank's systems)

## How the pieces talk

- Frontend READS data directly from Supabase. Row Level Security decides what each role can see (masking and access at the database layer: [roles-and-permissions.md](docs/roles-and-permissions.md)).
- Today, the frontend WRITES directly to Supabase, either to tables RLS allows or through `security definer` Postgres functions (`submit_application`, `assign_application`, `grant_staff_role`, ...). FastAPI does not exist yet. Once it does, important writes (status changes, uploads that trigger AI, computations, decisions) are meant to go through it.
- Simple low-risk writes (posting a folder message, marking a notification read) may go direct to Supabase if RLS covers them.
- The OCR worker talks to Supabase with the service role key: it claims queued runs with `claim_ocr_runs()` and writes `ocr_lines`.
- Planned: FastAPI verifies the user's Supabase JWT on every request and checks the role before acting. LangGraph graphs run inside FastAPI, pause at human gates (interrupts) and resume when a user confirms in the UI.

## Folder map

```
catch/                      Vite + React app, JavaScript, Tailwind CSS v4.
  src/main.jsx              entry point; wraps the app in AuthContextProvider and RouterProvider
  src/router.jsx            route table (below)
  src/roles.js              role lists (STAFF_ROLES, ASSIGNING_HEADS, ASSIGNABLE_ROLES), labels, home path per role
  src/context/authContext.jsx  Supabase session, role (from public.users), signUp / signIn / signOut
  src/supabaseClient.js     Supabase client (anon key only, from catch/.env), plus a detached client for creating staff logins
  src/components/           privateRoute (session + role guard), homeRedirect, staffProfileGate
  src/pages/
    loginPage, signUpPage
    applicantHomePage, profilePage           applicant home and master profile
    applicationFormPage, applicationForm/    multi-step form wizard (steps/, api, validators, options)
    adminHomePage                            staff home: the work tray
    workTray/                                FIFO tray, claim / assign, TAT state
    loanFolder/                              staff view of one application; AO edits, KYC checks, change history
    staffProfilePage                         staff fill in their name (required before use)
    staffAccounts/                           Dept Head creates staff logins
    accountOfficerApplicationInputPage       AO-entered intake (placeholder)
  supabase/migrations/      dated SQL migrations, run by hand in order (see each file's header)
  supabase/seed/            synthetic test accounts, one per role
ocr-service/                PaddleOCR worker (Python 3.13 venv): worker.py, ocr.py, requirements.txt, .env (gitignored)
docs/                       source of truth for requirements; decisions in docs/decisions/

PLANNED (not created yet):
services/api/app/           routers/, services/ (transitions, audit, notifications, computations), graphs/, agents/, schemas/, db/
services/api/tests/
data/synthetic/             fake loan documents for testing
data/ground_truth/          labeled answers for extraction accuracy tests
data/policies/              real policy text, gitignored
```

Routes: `/` → `/loginPage`; `/signUpPage`; `/homePage` (redirects by role); staff only: `/adminHomePage`, `/loanFolderPage?id=`, `/staffProfilePage`, `/staffAccountsPage` (DEPT_HEAD), `/accountOfficerApplicationInputPage` (ACCOUNT_OFFICER); applicant only: `/applicantHomePage`, `/applicationFormPage`, `/profilePage`.

Existing table names: `users`, `user_profile`, `loan_applications`, `applicants`, `documents`, `application_requirements`, `application_stages`, `stage_status_changes`, `stage_tat`, `application_assignments`, `audit_log`, `kyc_checks`, `staff_role_grants`, `ocr_runs`, `ocr_lines`. `extraction_staging` is still planned.

## Roles (enum `user_role`)

APPLICANT, ACCOUNT_OFFICER, CREDIT_INVESTIGATOR, DISPATCH_ADMIN, CREDIT_OFFICER, REVIEWER, APPROVER, DEPT_HEAD

- The role is stored in `public.users.role`. Self sign-up always creates APPLICANT; the Dept Head creates staff accounts and grants roles with `grant_staff_role()` ([decisions/role-storage.md](docs/decisions/role-storage.md)).
- `DISPATCH_ADMIN` is "Credit Officer Admin" in the BPMN. "Credit Evaluator" is the Credit Officer. Committee Members are not modeled.
- The applicant is a system user with a self-service portal ([decisions/applicant-portal.md](docs/decisions/applicant-portal.md)).

## Application status flow

Full detail in [status-flow.md](docs/status-flow.md). Two layers plus an applicant-facing status:

- Stage (`workflow_stage`): INTAKE → CREDIT_INVESTIGATION → CREDIT_EVALUATION → REVIEW → APPROVAL → DECIDED. Dispatch is an assignment action, not a stage.
- Status inside a stage (`stage_status`): PENDING, IN_PROGRESS, REQUESTED, RETURNED, DONE.
- Applicant-facing (`application_status`): DRAFT, SUBMITTED, FOR_CLARIFICATION, UNDER_CI, UNDER_CREDIT_EVALUATION, DEFERRED, UNDER_REVIEW, FOR_APPROVAL, APPROVED, REJECTED. Outcomes are Approved / Rejected / Deferred; Refer is not modeled.
- Assignment: AOs and COs claim files from the FIFO tray; Dispatch Admin, Reviewer, Approver and Dept Head assign, reassign or unassign.
- Turnaround: one target per stage in `stage_tat`, "near" at 75 %. Day values are placeholders until the bank's SLA is known (Q-09).
- Still open: CI request structure (Q-11), reviewer count (Q-13), approval tiers (Q-24), where pre-approval ends (Q-05).

Rules from the docs:
- Check-and-return loops exist at the AO, CO and Reviewer. A deferral returns the file to the earlier stage that owes the information. "Pending Customer Correction" is the paper's example state.
- Every transition writes a system timestamp, one stage-status row and one audit row, then notifies the next role. (Notifications not built yet.)
- A "Done" status must not silently revert; the reversal must notify. (Not enforced yet.)
- Submission is blocked while a required decision input is absent. (Built: `submit_application()`.)
- Nothing an agent produces moves the file forward without a recorded human confirmation.

## Borrower scope

- The intake form already covers all 10 employment types (locally employed, licensed professional, seafarer, virtual assistant, commission-based, OFW, self-employed, rental business, PUV operator, pensioner). It also covers principal, spouse, any number of co-borrowers, mortgagor and attorney-in-fact (Q-08, Q-27 decided by implementation).
- The document checklist is `required_documents()` in SQL; where it differs from the paper is listed in [document-requirements.md](docs/document-requirements.md).
- Downstream modules (computation, policy checks) are not built for any borrower type yet. The paper still plans dashboard and committee support for Sprint 5.

## Undecided (TBD), summary

Full text in [`docs/open-questions.md`](docs/open-questions.md). Do not pick an answer.

| Q | Topic |
|---|---|
| Q-04, Q-05 | Data privacy limits on external model calls; where pre-approval ends |
| Q-06 | Who confirms extraction (HITL #1) |
| Q-09 | TAT day values (structure is decided) |
| Q-11, Q-13 | CI request structure; reviewer rules |
| Q-14 | Ratio names and thresholds (DBR, DTI, LTV, LCR) |
| Q-19, Q-20, Q-24 | MRAC failure outcome; who reviews policy flags (HITL #2); approval tiers |

## Current sprint

Built on main (Sprint 0 foundation plus parts of Sprints 1 and 2):
- Auth and roles with RLS
- Applicant intake form and submission gate
- Staff work tray with claim / assign and TAT state
- Loan folder where the assigned AO edits the record and records per-section KYC checks
- Audit log of changes made after submission
- Raw PaddleOCR for IDs, COE / ITR and payslips

Not built yet:
- FastAPI, LangGraph, Chroma
- `extraction_staging` and the extraction confirmation step
- OCR field mapping
- Stage moves after Intake, notifications
- Computations, policy checks, approver actions

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
