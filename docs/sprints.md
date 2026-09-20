# Sprints

Source: main paper Sec. 3.2.4, 3.3, 3.4. Methodology: Agile Scrumban inside Design Science Research. Timeline start: end of September 2026.
Sprint lengths are set by the nature of the work: infrastructure 1 week, agent-dependent work 2 weeks, deterministic logic 1 week.

## Cross-cutting definition of done (every sprint)
1. Listed features work on **realistic simulated** loan application data. No real borrower data, ever.
2. Code peer-reviewed and merged to main (feature branches, at least one other reviewer).
3. Increment demonstrated for feedback (adviser, and the bank's contact where scheduling allows).
4. **Agent sprints (1 and 4) additionally:** every agent output passes its specified human confirmation step, and that confirmation is recorded in the audit trail.

Process: Kanban columns Backlog / To Do / In Progress / Review / Done; WIP limit 2 per member; MoSCoW backlog; sprint review plus retrospective at the end of each sprint. Testing: manual unit testing plus manual UI testing against acceptance criteria; defects go to the backlog.

## Phase 4A (Capstone 1, end of September to mid-November 2026)
| Sprint | Length | Scope | Addresses | Definition of done, specific |
|---|---|---|---|---|
| **0 Foundation and Agent Scaffold** | 1 wk | Normalized PostgreSQL schema from the ERD; auth and RBAC for the role types (Sprint 0 names eight: AO, CI, Dispatch Admin, CO, Reviewer, Approver, Credit Dept Head, Loan Applicant) via Supabase RLS; immutable audit trail logger (data changes, agent executions, human confirmations); LangGraph runtime; vector store | none directly | No user-facing feature. Access rules and audit trail exist so later modules do not retrofit them |
| **1 Digital Intake and Agentic Document Processing** | 2 wk | Applicant-facing portal (master profile, checklist); Claude Vision extraction into a **staging table**; legibility and orientation checks; cross-check extracted vs typed values; **AO confirms extracted fields** before commit; automated deficiency notice to the specific item; submission blocked while a required input is absent. **Salaried single applicants only** | 1.3.1.1, 1.3.1.2, 1.3.1.3 | Extraction never writes to the record directly; portal scope Q-02 / Q-06 |
| **2 Workflow and Queue Management** | 1 wk | FIFO ordering by submission timestamp; stage checkpoints pushing to the next role; per-role work trays; notification on every status change; messaging panel in each loan folder; routing graph in LangGraph | 1.3.1.4, part of 1.3.1.5 | |
| **3 Automated Financial Computation** | 1 wk | Credit Officer tools computing LTV, DBR and Amortization-to-Net-Income from confirmed applicant data; each figure shows its inputs. AMD from bank statements is deferred to Sprint 6 | 1.3.1.2, 1.3.1.3 | Ratio names Q-14; rules Q-15, Q-16 |
| **Policy turnover and vectorization** | across October | Receive the bank's policy manuals and MRAC under the NDA and load them into the local vector store. Embed **policy text only** | prerequisite to Sprint 4 | Must complete before Sprint 4 starts. Fallback in 1.7.3 |
| **4 Policy Compliance and Evaluation Support** | 2 wk | Rules-based checker for basic eligibility and MRAC on receipt of data; RAG pipeline with a policy passage citation per flag; **structured exception summaries, never automated rejections**; confirmation gates so no agent output is written without a human decision; audit entries for who confirmed or overrode each flag | 1.3.1.1, 1.3.1.3 | Groundedness of flags (proportion supported by the cited passage) |
| **Integration testing and defense prep** | 1 wk | Application runs end to end on simulated data: submission to policy-checked evaluation | | |

## Phase 4B (Capstone 2, January 2027)
| Sprint | Length | Scope | Addresses |
|---|---|---|---|
| **5 Turnaround Dashboard and Committee Decision Support** | 2 wk | Management dashboard: all pending applications by urgency; time per stage; alerts for accounts approaching the Key Result Indicator (KRI) commitment; per-stage performance summaries. Committee view: single evaluation transcript for the Approver with confirmed data, computed metrics, flagged exceptions with citations, and actions Approve / Reject / Defer / Refer | 1.3.1.5 |
| **6 Complex Borrower Profile Extension** | 2 wk | Self-employed: bank statements and ITR in place of a COE; AMD from tabular statement data. Co-borrower: both income streams captured and assessed jointly. OFW: remittance records and employment contracts instead of local payslips | Extends Modules 1 and 3 |
| **Full-system integration testing** | 1 wk | Any supported borrower profile moves from submission to committee decision with no manual intervention between stages | Entry condition for Phase 5 |

Why this order: intake is first because every module consumes its data; the dashboard is last because it observes the state all modules produce; complex profiles are variations on a proven base path.

## Targets
- **Capstone 1:** complete system analysis package (requirements with MoSCoW, RTM, to-be BPMN, agent specs, ERD and data dictionary, wireframes); foundation; four modules (intake, workflow, financial computation, policy compliance); end-to-end pipeline on simulated data; **manually labeled extraction ground truth set** (two labelers, Cohen's kappa) built alongside development; the defense demo includes at least one agent output corrected at its human gate.
- **Capstone 2:** dashboard and committee support; complex borrower extension; integrated prototype; comparative task scripts; SUS and NASA-TLX instruments; groundedness review protocol; seeded test scenarios; verification results.
- **Phase 5 (evaluation):** functional simulation, agent evaluation (extraction accuracy including a degraded-document subset, retrieval groundedness, human override rate, processing latency), comparative user study (system vs current workflow: task time, seeded-deficiency detection, SUS, NASA-TLX).

## Timeline
Capstone 1 requirements due Week 12, final requirements Week 14. Capstone 2 January sprints, then evaluation through February, final documents Week 14.

## Not yet started (per the paper)
Phase 3 system analysis: RTM, to-be BPMN, agent specifications, ERD, wireframes. Sec. 3.2.3.4 says "Phase/Activities not yet started." Sprint 0 depends on the ERD.

## Open items
Blocks Sprint 0: Q-01 to Q-05. Sprint-specific items are grouped in `open-questions.md`. Paper inconsistencies: "four modules" vs five (Q-32), "six increments" vs seven (Q-37), Capstone 2 profile list (Q-27).
