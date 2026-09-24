# CATCH requirements

Source: main paper Sec. 1.3-1.4 and Figure 2 (p.20), Sec. 3.2.4. "The bank" = the partner bank (identity withheld).
Items marked **Q-nn** are unresolved; see `open-questions.md`. Nothing here is a decision.

## What CATCH is
A decision-support and information-management system for the bank's housing loan **pre-approval** process.
Automation **prepares and flags; people decide** (Sec. 3.1). It never auto-rejects (Sec. 3.2.4.3.6).

## Problems (Figure 2)
| ID | Problem | Paper sub-problem |
|---|---|---|
| P1 | Applications reach evaluation without the inputs needed to decide | 1.3.1.1 |
| P2 | Decisions rest on information that cannot be verified | 1.3.1.2 |
| P3 | Claims cannot enter the decision without sufficient evidence | 1.3.1.3 |
| P4 | Limited pipeline visibility and fragmented communication channels | 1.3.1.4 + 1.3.1.5 (merged) |

## Opportunities (Figure 2)
- **O1** Cut deferrals by moving data validation and conditional checklists to the intake edge.
- **O2** Move from reactive tracing to proactive queue management, tracking and internal messaging.
- **O3** Bidirectional notification loop that tells applicants about blockers immediately.
- **O4** Secure borrower data and manage compliance through tier-based security boundaries.

(The paper text has five opportunities, 1.3.3.1-1.3.3.5; Figure 2 has four.)

## Users (Figure 2). See `roles-and-permissions.md` and Q-01
U1 Account Officer, U2 Credit Investigator, U3 Credit Officer, U4 Credit Evaluator, U5 Approver, U6 Credit Department Head / Management, U7 Loan Applicant.

## Inputs (Figure 2)
- I1 Self-service applicant form inputs
- I2 Applicant-uploaded supporting evidence
- I3 Multi-page tabular bank statements (self-employed)
- I4 External credit data and verification feeds (BRAS, NFIS, TransUnion, field checks)
- I5 Core credit policy, MRAC, daily reference exchange rates
- I6 Live borrower outstanding balance data (from internal teams, before booking)

## Outputs (Figure 2)
Centralized digital credit application file with indexed evidence tags; dynamic missing-document notice; policy compliance exception and flag report; consolidated workload adjudication package (Approve / Decline / Defer); real-time turnaround time (TaT) and bottleneck dashboards.

## Modules
| # | Module | Users | Problems | Opps | Inputs | Features | Sprint |
|---|---|---|---|---|---|---|---|
| 1 | Centralized Document Tracking, Digital Intake, & Agentic OCR | U1 U2 U3 U4 U7 | P1 P2 P3 | O1 O3 | I1 I2 | F1 F2 F3 F4 F5 F14 F15 | 1 (base path), 6 (complex profiles) |
| 2 | Workflow Automation & Queue Management | U1 U2 U3 U4 U5 U6 U7 | P4 | O2 | I4 | F6 F7 F8 | 2 |
| 3 | RBAC & AI Policy Governance | U1-U7 | P1 P2 P3 P4 | O4 | I5 I6 | F9 F10 F11 F16 | 0 (RBAC, audit), 4 (policy) |
| 4 | Operational Intelligence & Performance Analytics Dashboard | U5 U6 | P4 | O2 | I1 I2 I3 I4 | F12 F13 | 5 |
| 5 | Committee Decision Support & Executive Summary | U5 U6 | P1 P2 P3 P4 | O2 | I4 I5 | F10 F11 | 5 |

Not a Figure 2 module: the **Automated Financial Computation** module (Sprint 3), which the paper describes as a background overlay in Sec. 1.4.3 (Q-14, Q-32).

## Features F1-F16 (names verbatim from Figure 2)
"Text basis" is where the paper text describes the feature. "Inferred" means the paper does not tie the F-number to the text.

| ID | Feature | Module | Text basis |
|---|---|---|---|
| F1 | Centralized Applicant Profile Page | 1 | 1.4.2.1: permanent baseline data, auto-populates recurring fields |
| F2 | Dynamic Conditional Checkbox Form | 1 | 1.4.2.1, 2.1.2.8: selecting "Self-Employed" or "Married" expands fields and upload slots |
| F3 | Smart Input Fields | 1 | Inferred: point-of-entry validation (2.1.2.8) |
| F4 | Multi-Format Evidence Uploader | 1 | 1.4.2.1: IDs, payslips, land titles; file-type and legibility checks |
| F5 | Automated Applicant Link Dispatcher | 1 | Inferred: SMS/Email secure links for targeted remediation (1.4.2.1) |
| F6 | Timely Workspace Notification Alerts | 2 | 1.4.2.2: alert the moment a milestone shifts |
| F7 | Streamlined Internal Messaging Panel | 2 | 1.4.2.2: per-loan-folder messaging replaces Viber/Messenger/GChat |
| F8 | Automated First-In, First-Out (FIFO) Queue Assigner | 2 | 1.4.2.2, 3.2.4.3.3: ordered by submission timestamp |
| F9 | Dynamic Privacy Field Masking | 3 | 1.4.2.3: credential-based field masking |
| F10 | Rule-Engine Policy Matcher and Scoring Component | 3, 5 | Figure 3 (matcher). "Scoring" is not described in text (Q-22) |
| F11 | Automated Risk Exception Flagging & Hierarchical Routing System | 3, 5 | 1.4.2.3 (HITL traps), 1.4.2.5 (Exception Highlights Box) |
| F12 | Live Visual Turnaround Tracker | 4 | 1.4.2.4 |
| F13 | SLA Alarm Indicators | 4 | 1.4.2.4: colour-coded alarms for files nearing limits |
| F14 | Agentic Vision OCR Engine (Claude Vision API) | 1 | 1.4.2.1 |
| F15 | Human-in-the-Loop (HITL) Verification Gate | 1 | 1.4.2.1: side-by-side verification; extraction goes to a staging table, never directly to the record |
| F16 | RAG-Powered Policy & Risk Evaluator | 3 | 1.4.2.3: each flag must return its source policy passage |

Gap: Module 5's transcript, routing links and decision controls (1.4.2.5) have no F-number. Figure 2 maps Module 5 only to F10 and F11.

## Behaviors stated in the paper text
**Module 1**
- Applications with blank critical fields or unreadable attachments are locked at entry; submission is blocked while a required decision input is absent.
- Extracted values are cross-checked against what was typed, so mismatches (e.g. date of birth) surface at submission.
- Deficiency notices go by SMS/Email with a link to the specific item.
- Sprint 1 covers salaried single applicants only.

**Module 2**
- FIFO queue by submission timestamp; stage checkpoints push the file to the next role; per-role work trays; notifications on every status change.
- Example states that trigger alerts: "Pending Customer Correction", "Pending Committee Review".

**Module 3**
- Applicants see only their own dashboard.
- Internal roles get exposure and action rights matching their processing silo.
- RAG cross-references applicant metrics against policy and flags deviations (examples: DTI cap breach, tenure deficiency).
- Flagged exceptions are trapped, locked from modification and routed for human adjudication.

**Module 4**
- Reads system-generated timestamps at every state transition.
- Shows time in active evaluation, customer clarification loops and committee review.
- Alerts on files approaching the turnaround commitment (Q-09).

**Module 5**
- Consolidated Evaluation Transcript: verified income, ratios, credit scores, OCR outputs, RAG assessments, history.
- Routing links to the applicant folder; Exception Highlights Box.
- Actions: Approve, Reject (mandatory policy-reason code), Defer / Request Information, Refer / Escalate (Q-23).
- Every action writes an immutable, time-stamped audit entry.

## Other system features (Sec. 1.4.3, no F-number)
- **Metric computation overlay.** LTV, Average Monthly Deposits, DBR. See `computations.md`.
- **Immutable audit trail logger.** Data changes, agent executions, human confirmations, file views.
- **Offline data continuity cache.** Browser local storage for active form inputs.

## Technology (Sec. 1.4.4-1.4.6, 3.2.4.2)
- React front end, with Tailwind CSS v4 and React Router. The applicant portal, if any, is a separate restricted route on the same component library (Q-02).
- Supabase (PostgreSQL) with Row Level Security and auth.
- LangGraph orchestration with pause-and-resume human gates.
- Claude Vision API for extraction.
- RAG on LangChain with a local Chroma store; only policy text is embedded, never applicant data.
- Standalone prototype: no live connection to the bank's production systems. Rules are architected around the bank's legacy credit scoring parameters.

## Constraints
- Synthetic documents only. No real borrower data is used in development or evaluation (3.2.2.4).
- The policy manuals and MRAC are confidential and due during development. If they are not machine-readable by Sprint 4, ship the rules-based checker and defer retrieval (1.7.3; Q-21).
- Data Privacy Officer, IT Risk and Security sessions are still pending (3.2.2.1; Q-04).
- Pre-approval only. Release, servicing, collections and other loan products are out of scope (1.7.3; Q-05).
