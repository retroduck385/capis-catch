# Computations

Sources: interviews App. I (Sec. J, K, M) and App. J; BPMN credit-officer lane (App. A.4); KYC-FP tracker tabs E.6, E.12, E.13; main paper Sec. 1.4.3, 2.1.2.6, 2.1.3.1, 3.2.4.3.4, 3.2.4.4.2.
Rule for the build: computed values must **display the inputs they came from** so a Credit Officer can trace any figure (Sprint 3).
Where the sources disagree or omit a value, it is marked **TBD** and linked to `open-questions.md`. Nothing here is decided.

## 1. Gross income by borrower type (credit officer, today done by hand)
| Type | Rule as stated | Inputs | Source | Status |
|---|---|---|---|---|
| **COE-based employee** | Computed income counts at **80 %** | Monthly income per COE / COEC | App. I Sec. J; BPMN "Rule: COE = 80%" | Q-15 |
| **Payslip-based ("pay-case")** | Computed income counts at **90 %** | Monthly income per payslips (3 months) | App. I Sec. J; BPMN "Payslip = 90%" | Q-15 |
| **Seafarer** | (allotment x number of months, i.e. "times of contract") / 12, then x **80 %** factor | Allotment per contract, contract count | App. I Sec. J; Sec. 2.1.3.1 (80 %). BPMN note reads "80 or 90%" | **TBD**: 80 % vs 80-or-90 % (Q-15) |
| **Self-employed / business** | Use bank statements and ITR. Compute the Average Monthly Deposit (AMD), then apply a **10-15 % risk factor** depending on the nature and risk of the business | Bank statement transactions, ITR / AFS | App. I Sec. J; Sec. 2.1.3.1; BPMN "Use Bank Statements/ITR" | **TBD**: factor per sector, direction, months (Q-16) |
| **Spouse / co-borrower** | Combined with the principal; both streams assessed jointly | Each party's income | Cashflow tab ("Combined Income"); Sprint 6 | Formula not shown |
| **Foreign currency** | Convert with the day's BSP rate | Statement currency, daily rate (Figure 2 I5) | BPMN "Check Daily BSP Conversion Rate"; App. I step 6 | Rate source TBD (Q-17) |

The paper's literature review describes 80-90 % differently: as a **DBR cap** on obligations vs net disposable income (Sec. 2.1.3.1). This contradicts the interview reading above (Q-15).

## 2. Average Monthly Deposit (AMD)
- Aggregate ledger transactions from the bank statement to a monthly deposit figure, then average over the statement period.
- The AMD tab has monthly columns (Date / Withdrawal / Deposit / running balance), monthly totals, then Summary rows (Withdrawal, Deposit, ADB) with **Total, Average, Annualized**.
- Today it is derived manually line by line (about 2 h per self-employed file; up to 1.5 h for self-employed or multi-borrower income, App. H).
- Sprint 6 ingests tabular transaction data to derive it.
- **TBD:** period. App. J says 3 months, the AMD tab shows Jan-May (5), the checklist requires 6 months (Q-16).
- ADB appears beside AMD on the FP (deposit checking). It is not defined in the paper (see `glossary.md`).

## 3. Amortization (E.12 Amortization Schedule tab)
- Monthly amortization formula as printed: `=PMT(rate/12; 12*term; -principal balance)` (the tab shows the term in years and a rate; its year multiplier is in the printed formula).
- Inputs: Loan Amt, Term (in years), Interest, Facility, Account Name.
- Schedule columns: Date, Month, Monthly Amortization, Interest Payment, Principal Repayment, Outstanding Balance (per-row formulas are not shown).
- Loan term range: 5-25 years, typically 10-15 (App. J).
- Amendments recompute the schedule: term changes such as 15 to 20 years, rate changes (rate memos now about every 2 weeks), loan amount cuts (App. I).
- Interest rate, fixing period: entered on the KYC Loan Details (source of the rate TBD, Q-18).

## 4. Ratios (paper Sec. 1.4.3, 2.1.2.6, 3.2.4.3.4)
| Ratio | Definition in the paper | Inputs | Notes |
|---|---|---|---|
| **Debt Burden Ratio (DBR)** = "Amortization-to-Net-Income Ratio" | Estimated periodic payment vs the borrower's disposable net income or derived average deposits (2.1.2.6) | Monthly amortization, net disposable income (NDI) or AMD | BPMN: "System Auto-Computes DBR" after gross income. Cap values are not stated anywhere (2.1.3.1 gives 80-90 %, disputed). Interviews also say "DPR (Debt/Payment Ratio)". Cashflow tab shows a DBR cell. (Q-14) |
| **Loan-to-Value (LTV)** | Requested loan amount vs appraised market value of the pledged collateral | Loan amount, appraised value | Interviews say "loan-to-collateral ratio"; the Cashflow tab shows **LCR** and **AV**. Same thing is not confirmed (Q-14). No maximum stated |
| **Amortization over income** | Amortization compared to income | Amortization, income | Listed as a separate item in the FP contents (App. I Sec. G) |
| **DTI (debt-to-income)** | Used in Sec. 1.4.1, 1.4.2.3, 1.4.2.5 as if equal to DBR | Not defined | Not a Sprint 3 deliverable; conflicts with DBR (Q-14). Also "DTI" is the trade-registry agency on documents (see glossary) |

Cashflow tab layout (self-employed): AMD (principal/business, spouse) + Other Income = Subtotal; With Existing Auto Loan = Subtotal; **Net Disposable Income (NDI)** and **Combined Income**. The arithmetic between rows is not shown.

## 5. Derived fields on the KYC tab (yellow rows; formulas not shown)
Name (from name parts), Age (from date of birth), Number of Dependents, Full Present Address, Duration of Stay (from move-in date), Years of Service (from employment date), Full Permanent Address, Full Address. Also **Initial Account Decision** (a computed cell; template shows #DIV/0!).

## 6. Verification and scoring rules
- **CI "verified" threshold:** an identity and risk profile must match on 3 of 5 (or 4 of 5) verification points (Sec. 2.1.2.1.2; App. I Sec. H). Which five points, and whether this is CI policy or MRAC, is not stated (Q-11).
- **Credit scoring:** manual against a set formula on the Credit_Score sheet (SCORE / ACTUAL / REMARKS). The score maps to a risk classification (low / acceptable to high / not acceptable) that is entered as a remark with the recommended loan amount (App. J). **Criteria are not visible** (Q-22, Q-39).
- **MRAC:** rules in `approval-rules.md`.

## 7. Turnaround measures (Module 4)
- Turnaround time = time between system-recorded stage-transition timestamps (Sec. 1.4.2.4).
- Alarm target: unresolved (Q-09).
- Evaluation baselines are in `pain-points.md`.

## Not computed by CATCH in scope
Bank charges quotation, insurance premium, LIDS amounts, release billing schedule: post-approval (App. G).
