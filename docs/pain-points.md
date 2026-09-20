# Pain points

Sources: interviews App. G (Loan Head, 06/23/2026), H (Credit Officer, 07/12), I (Credit Head, 07/13), J (Account Officers and Support, 07/12-13), K (Credit Officer Admin, 07/13), plus the baseline in main paper Sec. 1.2. Names are omitted; roles only.
**Tag legend:** M1 to M5 = Figure 2 modules (M1 Intake/OCR, M2 Workflow/Queue, M3 RBAC/AI Policy, M4 Dashboard, M5 Committee Support). **C** = computation overlay (Sprint 3 / Sec. 1.4.3). **X** = cross-cutting feature (audit trail, offline cache). **GAP** = the paper's modules do not clearly cover it. **OOS** = post-approval, outside the stated scope. **CON** = constraint to design around, not a fix.

## Baseline (Sec. 1.2, tracker records as of July 10, 2026)
- 1,619 applications received; about 57.82 per week, 231.29 per month; 16 AOs, average 35 each.
- Average end-to-end 3.12 days; 90 applications (9.65 % of completed) exceeded the 7-day TAT.
- Of 1,590 decided in 2026: **631 approved (39.69 %), 629 deferred (39.56 %), 330 declined (20.75 %)**.
- Deferred is for incomplete documents or needed compliance: a near 1:1 approved-to-deferred ratio.

## App. H: Credit Officer (shadowing plus interview)
| # | Pain point | Tag |
|---|---|---|
| H1 | Re-typing CI report data into the FP; searching approval templates on local drives | M1 (pre-populate), M2 (role encodes own results, Q-11) |
| H2 | Self-employed and multi-borrower income takes up to 1.5 h per file | C (Sprint 3 / 6) |
| H3 | Constant cross-referencing of discrepancies (misaligned birth date, missing employer contact) | M1 (F3, F14, F15) |
| H4 | Guidelines scattered across desktop folders and manuals | M3 (F16 RAG, one searchable policy base) |
| H5 | Updates by Messenger, Viber, GChat: no auditability | M2 (F7), X (audit trail) |
| H6 | No trigger when the AO updates a deferred account; the CO must poll | M2 (F6) |
| H7 | VPN/LAN Google Workspace latency; slow retrieval of templates and files | CON, X (offline cache) |
| H8 | One shared login: version-control risk and no accountability | M3 (RBAC), X |
| H9 | Manually drafting notes explaining non-endorsements | GAP (only F11 exceptions; a structured justification input is not specified) |
| H10 | Daily BSP foreign-currency rate lookup | C (FX input, Q-17) |
| H11 | Wants field pre-population from documents and built-in scoring comparison | M1 (F14), F10 scoring (Q-22) |
| H12 | Wants an alert the moment a deferred account is updated | M2 (F6) |
| H13 | Stated target TAT: 1 day (employed), 2 days (self-employed); 5-8 accounts per CO daily | Q-09 |

## App. I: Credit Head
| # | Pain point | Tag |
|---|---|---|
| I1 | Returns come as minor or major revisions; the file is set Pending and returned to the evaluator by chat | M2 (F6, F7, state machine) |
| I2 | Too many channels: Google Chat, Messenger, Viber, WeChat, tracker | M2 (F7) |
| I3 | Anyone can edit any account in the sheet: no record of who changed what | M3 (F9), X (audit) |
| I4 | Flagged exceptions and threshold breaches should auto-route to the right approval level; clearing a breach must not be a direct edit | M3 (F11) |
| I5 | Pushback on declines, demand for a specific reason | M5 (Reject requires reason code) |
| I6 | Sales and marketing complain about long holds without updates (domino effect through branch, marketing, credit) | M4 (F12, F13), M2 |
| I7 | Repeated document and term requests; many favorable verifications required (residence, business, employment) | M1 (completeness at intake), M3 |
| I8 | Amendments: loan amount cuts, term changes (15 to 20 years), rate memos now every 2 weeks | C (recompute; Q-18) |
| I9 | CI is first in sequence and slows everything; uncertainty whether CI results are "fully verified" (3 of 5 / 4 of 5 policy) | M2, Q-11 |
| I10 | Errors found after evaluation led to added reports (TU, ISF, trust report) | M1 / M3 |
| I11 | Batching of endorsements to approvers is inconsistent | M2 (queue), M5 |
| I12 | Approval authority centralized; almost everything reaches the President | Approval rules (Q-24) |
| I13 | Admin is the single gatekeeper of the tracker (assign, monitor, endorse) | M2 (F8 auto-assign, Q-12) |
| I14 | Workload: about 15 endorsed accounts per evaluator per day; 2 PM cutoff; 1-2 h (employed) vs 7-15 h (other) | M4, Q-09 |
| I15 | Wants remote / hybrid work and integrated role-based views | CON, M3 |
| I16 | Transcript arithmetic (15 per day x 3 evaluators is not 75) | paper edit (Q-34) |

## App. J: Account Officers and Support
| # | Pain point | Tag |
|---|---|---|
| J1 | Main bottleneck: deferral due to missing information; no third-party verification means the claim is not counted | M1 (P1, P3) |
| J2 | Longest step is collecting complete documents from the borrower, not internal processing | M1 (F2, F5) |
| J3 | Manual KYC encoding produces typos; maker-checker needed | M1 (F15) |
| J4 | Income sustainability over a 5-25 year term is judgment-heavy | GAP (judgment; policy flags only) |
| J5 | Discrepancies (e.g. OFW years of service vs contract) | M1 (F15) |
| J6 | Self-employed AMD from bank statements is derived line by line, about 2 h; an LLM was tried but not adopted | C (Sprint 6) |
| J7 | Credit scoring is manual; the older automated tool was abandoned | M3 (F10, Q-22), design lesson (HITL) |
| J8 | KRI commitment of about 2 hours; risk of losing the client to another bank | M4 (F13) |
| J9 | Stagnant applications handled case by case | M4 |
| J10 | Online form discontinued; QR / client endpoint unused; paper preferred; double-encoded applications | Q-02, Q-06; M1 dedupe |
| J11 | Google system downtime | CON, X |
| J12 | OFW employment verification is hard across time zones | GAP (CI process) |
| J13 | Wishes for a dashboard of what is pending and at which stage, for preparers and approvers | M4 (F12) |
| J14 | Post-approval: printed FPs and credit folders because Support lacks drive access; LIDS filled manually; clearance by email trail | OOS (Q-05) |

## App. K: Credit Officer Admin
| # | Pain point | Tag |
|---|---|---|
| K1 | The tracker does not update in real time when CI completes or changes | M2 (F6) |
| K2 | "Done" reverts to "Pending" after CI re-verification, and this is not communicated | M2 (state machine) |
| K3 | Accounts stay Pending for extended periods (e.g. since June) with no alert | M4 (F13) |
| K4 | Documentation scattered: shared drive vs printed hard copies | M1 (F1, F4) |
| K5 | Informal channels: no audit trail to hold units accountable | M2 (F7), X |
| K6 | Operations staff act as the manual checker for every tick mark | M1 (completeness), M4 |
| K7 | No dashboard flagging when an application is complete or a bottleneck sits at CI or Approver | M4 |
| K8 | Sales and Operations communication is fragmented | M2 (F7) |

## Coverage summary
- **M1** covers missing inputs (H3, J1-J3, J5, K4, K6). **M2** covers status and communication (H5, H6, I1, I2, K1, K2, K5, K8). **M3** covers access and policy (H4, H8, I3, I4). **M4** covers visibility (I6, J8, J13, K3, K7). **M5** covers decision packaging (I5).
- **GAP** items: H9, J4, J12, plus the Reviewer and Dispatch Admin roles in Figure 2 (Q-01).
