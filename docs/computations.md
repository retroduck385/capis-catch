# Computations

Sources: interviews App. I (Sec. J, K, M) and App. J; BPMN credit-officer lane (App. A.4); KYC-FP tracker tabs E.6, E.12, E.13; main paper Sec. 1.4.3, 2.1.2.6, 2.1.3.1, 3.2.4.3.4, 3.2.4.4.2.
Rule for the build: computed values must **display the inputs they came from** so a Credit Officer can trace any figure (Sprint 3).
Where the sources disagree or omit a value, it is marked **TBD** and linked to `open-questions.md`. Sections 1-6 describe the sources. What the code computes was **decided by implementation on 2026-10-21**: see "Implemented in the Financial Package" at the end.

## 1. Gross income by borrower type (credit officer, today done by hand)
| Type | Rule as stated | Inputs | Source | Status |
|---|---|---|---|---|
| **COE-based employee** | Computed income counts at **80 %** | Monthly income per COE / COEC | App. I Sec. J; BPMN "Rule: COE = 80%" | **Built** (Q-15, decided 2026-10-21) |
| **Payslip-based ("pay-case")** | Computed income counts at **90 %** | Monthly income per payslips (3 months) | App. I Sec. J; BPMN "Payslip = 90%" | **Built** (Q-15, decided 2026-10-21) |
| **Seafarer** | (allotment x number of months, i.e. "times of contract") / 12, then x **80 %** factor | Allotment per contract, contract count | App. I Sec. J; Sec. 2.1.3.1 (80 %). BPMN note reads "80 or 90%" | **TBD**: 80 % vs 80-or-90 % (Q-15) |
| **Self-employed / business** | Use bank statements and ITR. Compute the Average Monthly Deposit (AMD), then apply a **10-15 % risk factor** depending on the nature and risk of the business | Bank statement transactions, ITR / AFS | App. I Sec. J; Sec. 2.1.3.1; BPMN "Use Bank Statements/ITR" | **TBD**: factor per sector, direction, months (Q-16) |
| **Spouse / co-borrower** | Combined with the principal; both streams assessed jointly | Each party's income | Cashflow tab ("Combined Income"); Sprint 6 | **Built:** Total Gross Income (D) sums every borrower |
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
- Interest rate, fixing period: entered on the KYC Loan Details (source of the rate TBD, Q-18). **Built:** the assigned CO enters them in the FP (decided by implementation 2026-10-21). The monthly amortization is computed with the PMT formula above; the schedule itself is not built.

## 4. Ratios (paper Sec. 1.4.3, 2.1.2.6, 3.2.4.3.4)
| Ratio | Definition in the paper | Inputs | Notes |
|---|---|---|---|
| **Debt Burden Ratio (DBR)** = "Amortization-to-Net-Income Ratio" | Estimated periodic payment vs the borrower's disposable net income or derived average deposits (2.1.2.6) | Monthly amortization, net disposable income (NDI) or AMD | BPMN: "System Auto-Computes DBR" after gross income. Cap values are not stated anywhere (2.1.3.1 gives 80-90 %, disputed). Interviews also say "DPR (Debt/Payment Ratio)". Cashflow tab shows a DBR cell. (Q-14) **Built** as defined below |
| **Loan-to-Value (LTV)** | Requested loan amount vs appraised market value of the pledged collateral | Loan amount, appraised value | Interviews say "loan-to-collateral ratio"; the Cashflow tab shows **LCR** and **AV**. Same thing is not confirmed (Q-14). No maximum stated. **Built as LCR** (below); the name LTV is not used |
| **Amortization over income** | Amortization compared to income | Amortization, income | Listed as a separate item in the FP contents (App. I Sec. G) |
| **DTI (debt-to-income)** | Used in Sec. 1.4.1, 1.4.2.3, 1.4.2.5 as if equal to DBR | Not defined | Not a Sprint 3 deliverable; conflicts with DBR (Q-14). Also "DTI" is the trade-registry agency on documents (see glossary) |

Cashflow tab layout (self-employed): AMD (principal/business, spouse) + Other Income = Subtotal; With Existing Auto Loan = Subtotal; **Net Disposable Income (NDI)** and **Combined Income**. The arithmetic between rows is not shown.

## 5. Derived fields on the KYC tab (yellow rows; formulas not shown)
Name (from name parts), Age (from date of birth), Number of Dependents, Full Present Address, Duration of Stay (from move-in date), Years of Service (from employment date), Full Permanent Address, Full Address. Also **Initial Account Decision** (a computed cell; template shows #DIV/0!).

## 6. Verification and scoring rules
- **CI "verified" threshold:** an identity and risk profile must match on 3 of 5 (or 4 of 5) verification points (Sec. 2.1.2.1.2; App. I Sec. H). Which five points, and whether this is CI policy or MRAC, is not stated (Q-11).
- **Credit scoring:** manual against a set formula on the Credit_Score sheet (SCORE / ACTUAL / REMARKS). The score maps to a risk classification (low / acceptable to high / not acceptable) that is entered as a remark with the recommended loan amount (App. J). The paper's screenshot shows no criteria (Q-39). **Built from the full sheet** (Q-22, decided 2026-10-21): see below.
- **MRAC:** rules in `approval-rules.md`.

## 7. Turnaround measures (Module 4)
- Turnaround time = time between system-recorded stage-transition timestamps (Sec. 1.4.2.4).
- Alarm target: unresolved (Q-09).
- Evaluation baselines are in `pain-points.md`.

## Not computed by CATCH in scope
Bank charges quotation, insurance premium, LIDS amounts, release billing schedule: post-approval (App. G).

## Implemented in the Financial Package (decided by implementation, 2026-10-21)
Code: `catch/src/pages/financialPackage/compute.js` and `creditScore.js`. Only the CO's inputs are stored; every figure is recomputed on the page from the record and shown with its inputs. Nothing here is stored as a result.

**IX. Financial capacity, per borrower (principal, spouse, co-borrowers)**
- Declared = the KYC gross monthly income (0 if unemployed).
- (A) Basic income = declared x the income-basis factor the CO picks: COE 80 %, payslip 90 %, as declared 100 % (Q-15). Blank until the CO picks, unless declared is 0.
- (B) Other income: entered by the CO. Gross income = A + B.
- (C) Existing monthly amortizations: every borrower's existing loans from the KYC, leaving out loans with 6 months or less left ("forgivable loans"). The code notes this is to confirm with the bank.
- (D) Total gross income = sum of every borrower's gross income.

**Amortization:** PMT(rate / 12, 12 x term in years, -loan amount), from the loan amount and term on the record and the rate the CO enters (Q-18).

**DBR** = (new monthly amortization + C) / D (Q-14).

**LCR** = loan amount / appraised value when the CO enters one, else the selling price (TCP) (Q-14).

**Not built:** seafarer income rule, self-employed AMD and risk factor (Q-16), foreign currency (Q-17), ratio caps (Q-14).

**Credit scoring (Q-22).** 17 criteria in four categories, points per band seeded from the Credit_Score sheet (`credit_score_criteria`, `credit_score_bands`):
| Category (max) | Criteria |
|---|---|
| Capacity (30) | DBR, Net Disposable Income (the sheet scores Total Gross Income (D) here), employment tenure / length of business, source of income |
| Character (20) | Loan borrowings, deposit / current account handling, NFIS checking |
| Collateral (20) | Collateral value, type of collateral, property usage, LCR |
| Condition (30) | Number of dependents, length of stay at the current address, age, civil status, gender, type of residence |
- The page suggests a band for each criterion it can work out from the record (thresholds copy the sheet's IF formulas). Condition criteria, tenure and source of income use the principal borrower only, as on the sheet.
- Nothing counts until the CO picks or accepts a band. The suggested band is stored beside the pick, so overrides show in the audit trail.
- Total maps to a description (Excellent 90+ ... Expected Loss below 35), a risk rating (Very Low Risk 90+ ... Very High Risk below 50) and a recommendation (For Approval 60+; Acceptable per RAAC 55+; for consideration with higher equity or rate 50+; Disapprove below 50). The recommendation is a guide only: the CO sets the Credit Result, and the system never rejects.
