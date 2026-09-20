# CATCH: Centralized Application Tracking and Completeness Hub

Capstone prototype (DLSU BSIS, Group 2524) for the housing loan pre-approval process of a Philippine bank.
CATCH is a decision SUPPORT system. It prepares and flags; people decide. Every AI output passes a human confirmation gate.

## Read first

- `docs/` is the source of truth. Read the relevant file before building a feature.
- Items tagged **Q-nn** are NOT decided. They live in [`docs/open-questions.md`](docs/open-questions.md). Do not build one as if decided. If docs are unclear or conflict, stop and ask.
- The source PDFs (`capstone-main.pdf`, `capstone-appendices.pdf`) are in `docs/` and are gitignored. The `.md` files are distilled from them and cite paper sections.

| File | Holds |
|---|---|
| [requirements.md](docs/requirements.md) | Problems, modules, features F1-F16, technology, constraints |
| [roles-and-permissions.md](docs/roles-and-permissions.md) | Role lists, who sees and does what |
| [status-flow.md](docs/status-flow.md) | As-is stages, loops, rules a transition must enforce |
| [data-fields.md](docs/data-fields.md) | Intake, KYC, CI, tracker fields |
| [document-requirements.md](docs/document-requirements.md) | Checklist per borrower type |
| [computations.md](docs/computations.md) | Income, AMD, amortization, DBR, LTV |
| [approval-rules.md](docs/approval-rules.md) | Approval tiers, decisions, MRAC |
| [sprints.md](docs/sprints.md) | Sprint scope and definition of done |
| [pain-points.md](docs/pain-points.md) | Interview findings and baselines |
| [glossary.md](docs/glossary.md) | Terms and abbreviations |

## Hard rules (never break these)

1. **NDA.** Never write the partner bank's name anywhere (code, comments, commits, seed data). Say "the bank". Refer to people by role, never by name. See [requirements.md](docs/requirements.md) (header) and [sprints.md](docs/sprints.md) (policy turnover under NDA).
2. **No real data.** Never commit real borrower data or real bank policy files. Synthetic documents only. Real policy text lives only in `data/policies/` (gitignored). See [requirements.md](docs/requirements.md) (Constraints), Q-04.
3. **Secrets** (Supabase service role key, Anthropic API key) live only in `services/api/.env`. The frontend only gets the Supabase anon key. No docs file covers this; related: Q-04.
4. **Staging first.** AI extraction output goes to `extraction_staging`, never straight into the application record. A human confirms first. See F15 in [requirements.md](docs/requirements.md) and Sprint 1 in [sprints.md](docs/sprints.md). Who confirms: AO per Sprint 1; the paper says "AO or Applicant" in one place (Q-06).
5. **One status path.** Application status changes ONLY through `services/api/app/services/transitions.py`. No other file may update `applications.status`. See [status-flow.md](docs/status-flow.md) (rules the system must enforce).
6. **Append-only audit.** `audit_log` allows no UPDATE or DELETE, ever. It must cover data changes, agent executions, human confirmations (with the confirming role) and file views. See [requirements.md](docs/requirements.md) (Sec. 1.4.3) and [roles-and-permissions.md](docs/roles-and-permissions.md). Database triggers plus the transition service are our implementation choice, not from the docs.
7. **Policy text only in Chroma.** Only institutional policy text is embedded. No applicant data. See [requirements.md](docs/requirements.md) (Technology) and [sprints.md](docs/sprints.md).
8. **Cited flags.** Every RAG risk flag carries the policy passage it came from. A flag without a citation is a bug. See F16 in [requirements.md](docs/requirements.md) and MRAC in [approval-rules.md](docs/approval-rules.md).

Also: the system never auto-rejects, and auto-approval is not in the paper's design ([approval-rules.md](docs/approval-rules.md)). One paper sentence (Sec. 2.1.2.4) says MRAC failure means automatic decline; the rest of the paper says flag only (Q-19). Only synthetic documents may be sent to the external vision model (paper Sec. 3.2.2.4); external-model rules are pending the Data Privacy and Security sessions (Q-04).

## Stack

- Frontend: React + Vite, plain JavaScript (JSX), in `catch/` (paper Sec. 3.2.4.2)
- Backend API and agents: Python, FastAPI, LangGraph, LangChain, in `services/api`
- Database and auth: Supabase (PostgreSQL + Auth + Row Level Security), in `supabase/`
- OCR: Claude Vision API
- Vector store: Chroma, locally hosted
- LangGraph checkpoints: stored in the same Postgres database (standalone prototype, no live link to the bank's systems)

## How the pieces talk

- Frontend READS data directly from Supabase. Row Level Security decides what each role can see (masking and access at the database layer: [roles-and-permissions.md](docs/roles-and-permissions.md)).
- Frontend WRITES anything important through FastAPI: status changes, uploads that trigger AI, computations, decisions.
- Simple low-risk writes (posting a folder message, marking a notification read) may go direct to Supabase if RLS covers them.
- FastAPI verifies the user's Supabase JWT on every request and checks the role before acting.
- LangGraph graphs run inside FastAPI. They pause at human gates (interrupts) and resume when a user confirms in the UI.

## Folder map

```
catch/                      Vite + React app, JavaScript. Currently the scaffold plus empty stubs.
  src/main.jsx              entry point (exists)
  src/App.jsx               root component (exists, empty stub)
  src/login-page.jsx        (exists, empty)
  src/supabaseClient.js     (exists, empty; anon key only)
  src/app/                  PLANNED: routes and role-based route guards
  src/features/             PLANNED: one folder per module: intake, workflow, computation, policy, dashboard, committee
  src/components/ui/        PLANNED: shared UI (tray, status badge, document panel)
  src/lib/api.js            PLANNED: FastAPI client
services/api/app/
  routers/                  HTTP endpoints, thin, no business logic
  services/                 business logic: transitions, audit, notifications, computations
  graphs/                   LangGraph graphs: extraction, policy, workflow
  agents/                   single-purpose agent nodes. Names are provisional (agent specs not written yet):
                            vision_extractor, rag_retriever, eligibility_checker, policy_checker, decision_support
  schemas/                  Pydantic models
  db/                       database client
services/api/tests/
supabase/migrations/        numbered SQL migrations, one change per file
supabase/seed.sql           synthetic users (one per role) and synthetic applications
docs/                       source of truth for requirements; decisions go in docs/decisions/ (create on first use)
data/synthetic/             fake loan documents for testing
data/ground_truth/          labeled answers for extraction accuracy tests
data/policies/              real policy text, gitignored
```

Only `catch/` and `docs/` exist today. Everything else is planned. Table and enum names below and in the rules (`extraction_staging`, `stage_transitions`, `audit_log`, `application_status`) are provisional until the ERD exists (Phase 3 not started; Q-03).

## Roles (enum `app_role`)

Working set, following the eight role types in Sprint 0. **TBD: Q-01** (the paper gives four different lists).

account_officer, credit_investigator, dispatch_admin, credit_officer, reviewer, approver, credit_dept_head, loan_applicant

- `dispatch_admin` is "Credit Officer Admin" in the BPMN.
- "Credit Evaluator" (Sec. 1.4.1, Figure 2) is likely the credit officer: Q-01. "Committee Members" is not settled as a role: Q-01.
- `loan_applicant`: whether the applicant is a system user at all is **TBD: Q-02**. The applicant portal, if built, is a separate restricted route.

## Application status flow

Stage and status names are **TBD: Q-10** (no to-be BPMN yet). Provisional starting point, the 7 as-is stages from [status-flow.md](docs/status-flow.md):

1. Intake and KYC (Account Officer)
2. Credit investigation (Credit Investigator). CI request structure: Q-11
3. Dispatch (Dispatch Admin). Auto FIFO vs manual assignment: Q-12
4. Credit evaluation (Credit Officer)
5. Review (Reviewer, one or more: Q-13)
6. Executive approval (Approver). Tiers: Q-24
7. Outcome. The docs name Approved, Deferred, Declined. Decision action names are **TBD: Q-23** (Reject vs Decline, Refer). Where pre-approval ends: **TBD: Q-05**

Rules from the docs:
- Check-and-return loops exist at the AO, CO and Reviewer. A deferral returns the file to the earlier stage that owes the information. "Pending Customer Correction" is the paper's example state.
- Every transition writes a system timestamp, one `stage_transitions` row and one `audit_log` row, then notifies the next role.
- A "Done" status must not silently revert; the reversal must notify.
- Submission is blocked while a required decision input is absent.
- Nothing an agent produces moves the file forward without a recorded human confirmation.
- Turnaround alarm target is **TBD: Q-09**.

## Borrower scope

- Sprint 1 (and so Capstone 1): salaried single applicant only (per the paper). Which other types come when: **TBD: Q-08, Q-27**.
- Capstone 2 (Sprints 5 and 6): dashboard and committee support (5); self-employed, co-borrower, OFW (6).
- Design tables so more borrower types can be added without breaking existing ones: the checklist as data (Q-08), parties as records (Q-03). See [document-requirements.md](docs/document-requirements.md).

## Undecided (TBD), summary

Full text in [`docs/open-questions.md`](docs/open-questions.md). Do not pick an answer.

| Q | Topic |
|---|---|
| Q-01 to Q-03 | Role list; applicant as system user; party and master-profile data model |
| Q-04, Q-05 | Data privacy limits on external model calls; where pre-approval ends |
| Q-06, Q-08, Q-27 | Who confirms extraction (HITL #1); borrower types per sprint |
| Q-09, Q-10 | Turnaround target; stage and status names |
| Q-14 | Ratio names and thresholds (DBR, DTI, LTV, LCR) |
| Q-19, Q-20, Q-23, Q-24 | MRAC failure outcome; who reviews policy flags (HITL #2); approver actions; approval tiers |

## Current sprint

Sprint 0: foundation (schema, auth and RBAC via RLS, audit trail, LangGraph runtime, vector store). No user-facing feature. Blocked by Q-01 to Q-05 and depends on the ERD, which is not written yet. Update this line when the sprint changes.

## Working style for Claude Code

- Read the relevant file in `docs/` before starting a feature.
- Plan first, then build. Show the plan and list the files you will touch.
- Build one vertical slice at a time: migration, RLS, backend endpoint, frontend screen, test.
- Never edit an old migration. Add a new one.
- The frontend is plain JavaScript. There are no generated database types; do not add TypeScript.
- Keep routers thin. Put logic in `services/`.
- If a requirement in `docs/` is unclear or conflicts with another, stop and ask instead of guessing.
- Update `docs/` when a decision changes. Record big decisions in `docs/decisions/`.
