# Glossary

Only terms that appear in the documents. "(not defined)" = used but never expanded in the source. "(inferred)" = my reading of context, not the paper's words.

## Roles and units
| Term | Meaning |
|---|---|
| AO | Account Officer. Primary contact for the borrower; assembles the initial financial package |
| AIF | Attorney-in-Fact (KYC and FP sections) |
| CI | Credit Investigator / Credit Investigation. Desk CI (database and online checks) and Field CI (site visits) |
| CO | Credit Officer |
| CEO | In interviews: Credit Evaluation Officer (the evaluator). Not the company CEO |
| CIAD | Name of a tracker tab holding the appraisal fee schedule (not defined) |
| CCS | Appears as "CCS Officer / Associate / Section Head" in clearance (not defined) |
| CRMD | Appears in the approval tier ("CRMD Division Head") (not defined, Q-24) |
| CrID | Appears in the CI sign-off ("CrID Head") (not defined) |
| Dispatch Admin | Sprint 0 / Sec. 1.3 name. BPMN and App. K call it Credit Officer Admin (Q-01) |
| LOD | Loans Operations Department (post-approval) |
| Marketing / Support | Marketing solicits accounts; Support prepares post-approval steps (App. G, J) |
| RED | Appears as "RED Dept. Head", "RED Account Officer" etc. FP footer reads "Real Estate Department" (inferred) |
| U1-U7 | Figure 2 user IDs |

## Process and documents
| Term | Meaning |
|---|---|
| AAS / COM | Amendment Approval Sheet / Credit Offering Memo (App. G) |
| ADB | On the FP and AMD tab beside AMD (not defined; standard banking meaning is Average Daily Balance, inferred) |
| AFS | Audited Financial Statements |
| AMD | Average Monthly Deposit |
| ATD / ATR | Authority to Debit / Authority to Release (loan proceeds); post-approval |
| CAF | Credit Application Form; "CAF (AO endpoint)" is the intake Google Form. Appendix D calls it "COF" (Q-33) |
| CAR | Certificate Authorizing Registration |
| CENOMAR | Certificate of No Marriage Record |
| COE / COEC | Certificate of Employment / Certificate of Employment with Compensation |
| CTC / TCT / CCT | Community Tax Certificate / Transfer Certificate of Title / Condominium Certificate of Title |
| DOU | "DOU in ___ days": deadline field on the checklist (not defined) |
| DTI | Two meanings in the documents: **Department of Trade and Industry** business registration (documents, CI checks) and **debt-to-income ratio** (Sec. 1.4.1, 1.4.2.3, 1.4.2.5). Q-14 |
| FP | Financial Package (financial information package; the summary profile used by credit, mirroring the KYC sheet) |
| GIS | General Information Sheet |
| ISF | Income, Stability and Financial Capacity network (Sec. 2.1.2.3) |
| ITR | Income Tax Return |
| KYC / CDD | Know Your Customer / Customer Due Diligence |
| KYC-FP tracker | Google Sheet with tabs KYC, CI Request, Appraisal, Document Checklist, FP, Cashflow, Signatures, Credit_Score, CI (Desk), CI (Field), CIAD, Amortization Schedule, AMD |
| Home Loan Tracker | Google Sheet tracking status per application (tabs in `data-fields.md`); "v3.0" is the planned digital version |
| LIDS | Loan Instruction and Disbursement Slip; post-approval |
| LMC | "Loan Management Contract" in App. K (not defined further) |
| NOA | Notice of Approval / Notice of Loan Approval |
| OB | Outstanding balance |
| PN | Promissory Note |
| POEA | Philippine Overseas Employment Administration (contract type on the seafarer checklist) |
| REM | Real Estate Mortgage |
| SPA | Special Power of Attorney |
| TAT / TaT | Turnaround time |

## Credit and data sources
| Term | Meaning |
|---|---|
| BRAS | Bank Reference and Account Status: internal reference database for accounts held at the bank (Sec. 2.1.2.3) |
| NFIS | Negative File Information System: shared database of adverse credit behavior; checks credit-card hits, including maiden names |
| TU | TransUnion Philippines credit bureau |
| BSP | Bangko Sentral ng Pilipinas (source of the daily conversion rate) |
| DBR | Debt Burden Ratio = Amortization-to-Net-Income Ratio (Sec. 2.1.2.6) |
| DPR | "Debt/Payment Ratio" in interviews (Q-14) |
| LTV / LCR / AV | Loan-to-Value / appears as LCR (loan-to-collateral ratio in interviews, inferred) and AV on the Cashflow tab (not defined). Q-14 |
| NDI | Net Disposable Income (Cashflow tab) |
| MRAC / RAC | Minimum Risk Acceptance Criteria / Risk Acceptance Criteria. Interview transcript also writes "RAAC" (transcription unclear, Q-36) |
| KRI | Two expansions: "Key Risk Indicator" (Sec. 2.1.2.1.4) and "Key Result Indicator" (Sprint 5, App. J). Q-31 |
| SLA | Service-level agreement / alarm indicators (Module 4) |
| Class B / Class C | Labels on tabs ("Class B" on CI, checklist, credit score, AMD; "Class C" on Cashflow). Meaning not defined (Q-38) |
| RPS | Policy the approval authority is "tied to" (App. I; transcript unclear, Q-24) |
| SBLAF / GH / EDD / AMLA | Terms on the later-stage checklist (Group Head, Enhanced Due Diligence, anti-money laundering) (not defined) |

## Technology and method
| Term | Meaning |
|---|---|
| Agentic OCR | Vision-model extraction (Claude Vision API) with layout parsing, orientation correction and field extraction |
| DSR / DSRM | Design Science Research / Design Science Research Methodology |
| DTS | Document Tracking System |
| FIFO | First-In, First-Out |
| HITL | Human-in-the-Loop: an agent output is a proposal that a human role must confirm before it is written to the record |
| LangGraph / LangChain | Orchestration workflow engine with stateful graphs and pause-and-resume gates |
| LOS | Loan Origination System |
| MoSCoW | Must / Should / Could / Won't prioritisation |
| NASA-TLX / SUS | Cognitive workload instrument / System Usability Scale |
| RAG | Retrieval-Augmented Generation; each risk flag must cite its source policy passage |
| RBAC / RLS | Role-Based Access Control / Row Level Security (Supabase) |
| RTM | Requirements Traceability Matrix |
| UAT / EUAT | (End-)User Acceptance Testing |
| VPN / LAN | Network the bank's Google Workspace runs through (latency source) |

## Paper terms worth keeping straight
- **Deferral:** an application set aside because the bank could not yet reach a decision (missing or unverifiable information), not declined on merit.
- **Check-and-return loop:** the pattern at AO, CO and Reviewer in which insufficient information sends the file backward (Sec. 1.3).
- **Verification-driven state control:** completeness gating at intake (Figure 2 Module 1).
- **Visa-style checklist:** a conditional checklist that expands by declared profile (Sec. 2.1.2.8).
