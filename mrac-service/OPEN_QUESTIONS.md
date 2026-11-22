# Open questions for the bank (found while reading the RAAC and the two operations manuals)

Nothing below is guessed in the code. Each item is either left as `needs_review` or flagged in the criterion's `notes`.

## Contradictions between documents
1. **DBR basis.** The housing RAAC: 40% of **gross** income. Consumer Credit Operations Manual s.IV (page revised 02.19.2020): 40% of
   **net** income. CATCH computes on gross.
2. **Which loans count toward DBR.** The RAAC counts housing and auto loans only and excludes payslip deductions (SSS, Pag-IBIG,
   multipurpose loans). CATCH counts every KYC loan with a term over 6 months (`loan_type` is free text, so it cannot filter by type).
   The 6-month exclusion is not in the RAAC.
3. **Approval ladder for housing loans.** CATCH uses the 10M / 30M tiers of the KYC-FP sheet. The RED Operations Manual page revised
   02.04.2025 (APP Cir 2-5729) shows tiers at 50M, 30M, 20M, 10M, 5M and 3M. The Consumer Credit Operations Manual page revised
   08.14.2024 shows 30M, 10M, 5M and 3M. The newest document differs from CATCH. Read the original pages: the PDF tables extract messily.

## Missing information
4. **RAAC date.** The `.ods` has no date or version. Chunks have no effective date until you pass `--effective-from`.
5. **Acceptable credit score.** The Operations Manual s.VII.D says a score below the acceptable score is an exception, but gives no
   number. The 55 in `POLICY-SCORE-ACCEPTABLE` comes from `creditScore.js`.
6. **Whose income** is the RAAC's "gross monthly income" (40,000 / 30,000): the principal's, or all borrowers combined? CATCH sends the combined figure.
7. **Employment types the RAAC does not name:** VIRTUAL_ASSISTANT, COMMISSION_BASED, RENTAL_BUSINESS, PUV_OPERATOR. They come out as
   `needs_review` until credit policy says how they map (and whether RAAC "OFW Land-based" = CATCH `OFW`).
8. **Co-borrower exemption for OFWs** needs proof of visits to the Philippines. Where is that recorded in CATCH?

## Data the RAAC needs that CATCH does not collect yet
`employment_status` (regular / probationary), position level, total work experience, seafarer rank, `business_years`,
`net_income_after_tax`. Until they exist, those rules report `needs_review` (missing data), never `pass`.
(NFIS record categories and `has_replevin_or_foreclosure` now come from the Credit Investigator's NFIS records:
`ci_nfis_records`, read by `catch/src/pages/ciRequest/ciFacts.js`.)

## NFIS thresholds that disagree (CATCH follows the defaults below until credit policy confirms; Josh, 2026-11-22)
9. **Closed / mishandled checking account.** RAAC rule 1c: "reported five (5) years and up, for 1 checking account only".
   The acceptable-records table (June 2021): "more than 3 years, one record only of closed CA". The Credit_Score sheet: "more
   than 5 years". CATCH: the **score** uses 5 years (the sheet), the **RAAC check** uses 3 years (the table).
10. **Cancelled credit card with a balance.** RAAC rule 1a: "unpaid balance of Php 5,000 and below, 3 years and above". The
   table: up to Php 20,000 if over 3 years (and up to Php 50,000, or Php 20,000 if over 2 years, with the 70% / 80% LCR cap).
   CATCH uses the table (it is dated, so likely the newer one).
11. **RAAC 1d** ("adverse findings already surfaced in previously fully paid or existing loans with at least 50% paid
   installment", with the bank) needs the bank's own loan history, which neither TU nor NFIS has. Where does CATCH get it?

## Useful for CATCH, not RAG
- Housing turnaround time: 1 day for a financial package without bank-statement analysis, 2 days with; cut-off 11:00 AM (Operations Manual s.IX).
- Income computation factors (OFW 90% / 80% forex factor, commission-based 60%, etc., Operations Manual s.IV.B-C): compare with the income basis factors in `creditScore.js` / `compute.js`.
