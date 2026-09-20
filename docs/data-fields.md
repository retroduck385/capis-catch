# Data fields

Sources: App. C/D (intake form), E.1 (KYC tab), E.2 (CI Request), E.5 (FP), E.6/E.12/E.13 (computation tabs), E.9 (CI Desk), F (Home Loan Tracker).
Field names are as printed. "(derived)" = highlighted yellow on the KYC tab, so calculated from other fields; the formula is not shown. Unreadable areas are listed at the end (Q-39).
Template values in the screenshots are placeholders.

## 0. Intake form: Appendices C and D
Appendix C ("Housing Loan Application Form") and Appendix D ("COF AO Forms") are **one image**: the Google Form titled **"CAF (AO endpoint)"**. The paper's own captions call it two things. The 36-page application form itself is not reproduced (Q-33).
It captures only:
- Principal Borrower's Last Name (short text)
- Principal Borrower's First Name (short text)
- Documentary Requirements (1st 10 pcs): file upload
- Documentary Requirements (next 10 pcs): file upload
- Respondent email, collected automatically

Form rules printed on it:
- Submit once per application.
- Follow-up documents go straight into the applicant's Google Drive folder.
- Files over 10 MB go directly to Drive.

Everything else is encoded afterwards by the AO on the KYC tab. Submitting the form auto-generates the KYC-FP sheet and emails the application form and the KYC form (App. G).
The paper also mentions a discontinued client-facing endpoint and a discontinued 36-page online form (Q-06).

## 1. KYC tab columns (App. E.1)
Every row has five columns: **Description | Extracted Info | Corrected Value | KYC Verification Remarks | Finalized Value.**
That is the maker-checker structure: extraction, then correction, then finalized value.
- A side panel documents an existing manual extraction routine: create a chat, upload the borrower's files to a hosted LLM, paste a fixed prompt, paste the response into the first Corrected Value cell, verify. The prompt outputs `~` for headers and missing values, stops after "Referrer", and strips trailing `~` (Q-07).
- "Time Submitted" heads the sheet.

## 2. Application / loan
- Account / Loan Application Number (tracker ID pattern: `HL_<10-digit number>_<borrower name>`)
- Date Time Submitted, Logs (tracker Applications tab)
- **Loan Details:** Purpose, Property Address, Loan Amount (client's preferred), Loan Term (years) (client's preferred), Interest Rate, Fixing Period
- Initial Account Decision (computed on the KYC tab)
- **Referral Details:** Developer's Name, Branch, Channel, Referrer
- **Verification Details:** Account Officer Name, Mode of Verification, Is Verified? (checkbox: "Make sure the Finalized Value columns are correct")
- **FP status block:** Credit Result, Date Prepared, Amendment, Waiver and Acceptance, Deferral(s), approval date; footer names Real Estate Department and Consumer Credit Department, Housing Loan Unit
- Source flags used by the process: "Is application from developer?"; OFW yes/no (drives phone vs email clarification)

## 3. Applicant (principal borrower)
- **Personal:** First Name, Middle Name, Last Name, Name Extension, Name (derived), Mobile Number, Email Address, Gender, Date of Birth, Age (derived), Birth Place, Civil Status, Citizenship, SSS No., TIN, Age of Dependents, Number of Dependents (derived)
- **Present address:** Unit / House No., Building / Block / Street Name, Subdivision / Barangay Name, Municipality / City, Province, ZIP Code, Living in the Philippines?, Full Present Address (derived), Home Ownership, Rent (if applicable), Date of Move-In, Duration of Stay (derived)
- **Permanent address:** same address fields, Full Permanent Address (derived), Date of Move-In, Duration of Stay (derived)
- **FP customer information (XIV):** Borrower's Name, Birth Date / Age, Civil Status, Citizenship, Present Address, Permanent Address, Years of Stay / Ownership, Contact Numbers, Email Address, No. of Children / Dependents and Ages

## 4. Spouse
- **Personal:** First Name, Middle Name, Last Name (Maiden Name), Last Name, Name Extension, Name (derived), Mobile Number, Email Address, Age (derived), Birth Place, Citizenship, SSS No., TIN
- **Address:** "Same as Principal Borrower?" (Yes/No; if No, the fields below must be filled), then the same address fields as the applicant, including Full Present Address (derived) and Duration of Stay (derived)
- **Employment and requirements:** as section 6

## 5. Co-borrower, attorney-in-fact, mortgagor
- **Co-borrower:** First / Middle / Last Name, Name Extension, Name (derived), Relationship with Principal Borrower, Mobile Number, Email Address, Gender, Date of Birth, Age (derived), Birth Place, Citizenship, SSS No., TIN; address (same pattern as the spouse); employment and requirements as section 6
- **Attorney-in-Fact:** First / Middle / Last Name, Name Extension, Name (derived), Relationship with Principal Borrower, Date of Birth, Age (derived), Civil Status, address fields, Full Present Address (derived), Contact Number, Email Address, SSS No., TIN
- **Mortgagor's Information:** Mortgagor's Name (single field)

The FP also has columns for Principal Borrower / Mortgagor, Spouse, Co-borrower and AIF (attorney-in-fact) (Q-03).

## 6. Employment / business (repeated per party: principal, spouse, co-borrower)
- **KYC:** Employment Type, Employer's / Business Name, Occupation, Employment Date, Years of Service (derived), Contact Number, Email Address, address fields, Full Address (derived), TIN, CTC No, Date Issued, Place Issued, Gross Monthly Income
- **FP (VIII, employment / business verification):** Borrower, Company Name / Address, Position / Rank / Status, Date Hired / Registration, Contact Numbers, Remarks
- **Applicable-requirement checkboxes per party:** Valid ID / Passport, SPA, FS / Bank Statements, COE / ITR, Payslips / Remittances (3 mos), SEC / DTI / Mayor's Permit

## 7. Income and cash flow
- **FP (IX):** Basic Income (A), Other Income (B), Gross Income (A+B), Existing Monthly Amortization (C), Total Gross Income (D); columns Principal Borrower (a), Spouse (b), Coborrower (c), Remarks; a DBR cell in the totals row
- **Cashflow tab (Self-Employed):** Account Name, Developer; Loan Amount, Term (Years), Interest Rate, Monthly Amortization; AV, LCR, DBR; AMD (principal/business, spouse), Other Income, Subtotal, With Existing Auto Loan, Subtotal, Net Disposable Income (NDI), Combined Income; a box "Computation for Borrower's Gross Monthly Income"

## 8. Obligations, deposits, trade
- **KYC Existing Financial Obligations:** Existing Bank Accounts, Name of Bank, Account Type, Account Number; Existing Loans, Loan Type, Monthly Payment, Forgivable Loans (note: "Do all loans have a term greater than 6 months"), Name of Bank / Lending Institution; Credit Card Ownership, Credit Limit, Expiry Date
- **FP X (deposit checking):** Bank Name, Account Name, Type of Account, Acct Number, AMD, ADB, Status / Handling / Remarks
- **FP XI (loan verification, from loan lists and disclosures):** Bank Name, Facility, Orig Loan, OB, Amortization, Contract Date, Maturity Date, Remarks
- **FP XII (trade checking, if applicable):** Company Name, Type of Transaction, Type of Product / Service, Vol., Frequency, Payment Handling, Remarks (informant, date of CIR)
- **AMD tab:** Name of Depositor, Account Number, Bank Name; per month (Jan-May): Date, Withdrawal, Deposit, running balance, Total; Summary: Withdrawal, Deposit, ADB per month, Total, Average, Annualized

## 9. Collateral
- **KYC:** Project Name, Property Type, Selling Price, Registered Owner, TCT/CTC No, Lot Area, Floor Area, Contact Person, Contact Number
- **FP XIII (title verification and traceback), Present Title and First Preceding Title:** Title No., Registered Owner, Date of Verification, Place of Verification, Mode of Conveyance, Date of Inscription, Remarks
- Appraisal tab (out of scope for this file): property valuation request and fee schedule

## 10. References
References #1, #2, #3: Name, Address, Contact Number, Relationship with Principal Borrower.

## 11. CI request (App. E.2)
- **NFIS Request Form:** individual (Last Name, First Name, Middle Name, Complete Address, Birth Date, Inquiry Results; include maiden name if married); corporate (Corporate / Business Name, Complete Address, Inquiry Results); Remarks
- **TransUnion (TU) Request Template:**
  - Loan Type, Desired amount to be loaned
  - Inquiry Name for Subject, Spouse, Coborrower (Last, First, Middle Name)
  - Full Maiden Name (married women), Date of birth (MM/DD/YY), Civil Status
  - ID Type, ID Number, Expiry Date
  - Complete Address (Philippines), Zip Code, Contact Number (Philippines)
  - Source of Income, Company / Employer Name, Monthly Gross Salary / Income, Annual Gross Salary / Income, Tenure (type the units)
  - Fields are mandatory; put N/A if not applicable
- **Request for Credit Investigation (completed by Credit):** Desired Loan Amount, Principal Borrower, Employer's / Business Name, Home Address, Employer's / Business Address, Status, Type of Checking, Spouse, Coborrower; contacts (Person, Home / Mobile, Office, Email Address)
- **Desk CI checklist:** Bank, Credit, Supplier, Customer, Business, Employer, PDEA, DTI, SEC, Sales Invoice / Purchase Order / Delivery Receipt Verification, Others
- **Field CI checklist:** Bank, Neighborhood, Residence (with picture), Supplier (random, with picture), Customer (random, with picture), Business (with picture), Employer, Plant (with picture), HLURB, Others
- **Attachments:** Borrower's Information Sheet / Client Application Form; Letter of Authority to conduct Bank / Credit / Trade checking; copy of bank passbook / statements / deposit certificates or account and card numbers; business registration or certificate; certificate or copy of employment; proof of billing; Others; Requested by (name), Received by (name)

## 12. CI result: Desk (App. E.9)
Columns are Subject | Spouse / Co-borrower | Business. Each section ends with Salient Findings, Recommendation, Note. Each check also records informant's name, designation, contact number(s) and remarks.
- **Header:** Borrower's Name, Requester, Type of Loan, Type of Checking, Date & Time Requested / Assigned / Done, Status
- **Database search:** NFIS Result and BRAS Result (each with Conducted by, Date); "Should you need further verification?"
- **Online registration verification:** DTI / SEC Registration, PRC Check, IBP Check, Marina (SIRB) Check, Philgeps Check, Media Search through Google Search; Closed Examination of the Attached Documents; Signature; Important Findings
- **Advice slip:** 1st / 2nd / 3rd Notice; up to six "Type of checking" selections
- **Bank check, non-borrowing accounts:** Bank name & branch, Account name, Account number, Type of account, Years of relationship, Average daily balance, Status, Experience / handling manner, Instances of returned / overdraft (frequency, period)
- **Bank check, borrowing accounts:** Entity name & branch, Loan account name, Facility loan, Security, Location, Date granted, Maturity date, Terms, Monthly amortization, Amount approved, Availed, Outstanding amount, Interest rate, Credit rating, Years of relationship, Loan cycle
- **Trade check, suppliers:** Business name / address, Product / service supplied, Volume & frequency, Credit limit, Outstanding bills, Terms & manner of payment, Cheque bank, Years of relations, Reputation, Extension / past-due instances, Satisfaction with credit relationship, Supplier rating
- **Trade check, customers:** Business name / address, Product / service, Volume & frequency, Credit limit, Terms, Years of relations, Reputation, Satisfaction with quality, Timeline of delivery, Rejected items, Complaints
- **Business check:**
  - Mayor's Permit: Entity name, Trade name & address, Owner, Permit No., Status, Taxpayer name / address, Business taxes, Date issued, Validity, Signatory
  - DTI online inquiry: Business name, Territory, Owner, Certificate No./BNN, Registration date, Status, Scope
  - SEC online inquiry: Registration No., Company name, Address, Status
- **Employment check (payslip / COE), plus a seafarer variant:** Employer's Name, Employer's Address, Salary (Gross), Payroll Date, Allowances, Status, Rank / Position, Nature of Work, Length of Service, Salary received through, Date of COE issuance, COE signatory(ies), Format of COE, Format of Payslip, Pending resignation?, Derogatory record?
- **Bar admission / law list verification:** Attorney's Name, Roll Number, Chapter, Date Submitted
- **Sign-off:** Prepared by Desk CI, Reviewed by Desk CI Supervisor, Approved by the CI Department Head

## 13. Home Loan Tracker (App. F): columns per tab
- **F.1 Change Logs:** Date, Affected Groups, Changes
- **F.2 Applications:** Account ID, Date Time Submitted, Logs
- **F.3 KYC:** Account Officer's Name, Status, Remarks
- **F.4 NFIS/TU:** Loan Application Number, AO Requester's Name, CI Processor's Name (NFIS), NFIS Status, Remarks, CI Processor's Name (TU), TU Status, Remarks
- **F.5 Appraisal:** Loan Application Number, AO Requester's Name, Appraisal Officer's Name, Status, Remarks, Appraisal Department Head's Name, Status, Remarks
- **F.6 Credit Evaluation:** Account Officer's Name, Credit Officer's Name, Credit Officer Status, CO Remarks
- **F.7 CI:** Loan Application Number, AO's Name, CI Requester's Name, Desk CI Processor's Name, Desk CI Status, Remarks, Field CI Processor's Name, Field CI Status, Remarks
- **F.8 Approval / F.9 RED Endorsement:** see `approval-rules.md`
- **F.10-F.13** (Clearance, Booking, Release, Lock): post-approval, out of stated scope (Q-05)

## Not readable in the source (Q-39)
- **E.5 FP tab:** native image is 530x806 px. Section headings and most labels are legible, but small cells (e.g. "Other information" prefixes) are not.
- **E.8 Credit_Score tab:** only the header is shown (Housing Loan Credit Scoring Sheet, Class B, Name of Borrower/s, Loan Amount, SCORE / ACTUAL / REMARKS). The criteria rows are absent.
- **E.10 CI (Field) tab:** native image is too small to read. Only three section titles are visible: Residence, Business and Employment Verification.
- **E.7 Signatures:** approval checkbox labels are partly redacted (see `approval-rules.md`).
