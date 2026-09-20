# Document requirements

Sources: App. E.4 (Document Checklist tab, "Class B Credit Requirements (Mandatory)"), BPMN AO lane notes (App. A), KYC tab (E.1), interviews (App. G, I, J).
The checklist has an **AO** and a **CO** checkbox column per document: presumably AO collected and CO verified (the paper does not say). Requirements conditionally expand with borrower type (Sec. 1.4.2.1); the base path in Sprint 1 is **salaried single applicant** and the rest arrive in Sprint 6 (Q-08, Q-27).

## Always (BPMN AO lane, "Collate Client Requirements")
- Fully accomplished Credit Application Form
- Two (2) valid government-issued photo-bearing IDs
- Proof of Income
- Proof of Marital Status
- Letter of Authorization for CI
- Special Power of Attorney (for OFWs and seafarers)

## Per borrower type (Checklist tab; every row has AO and CO checkboxes)
| Borrower type | Required documents |
|---|---|
| **Locally employed** | COEC; latest payslips (3 months) |
| **Seafarer** | Certification from Manning Agency of COEC (the sheet prints "Certification from Manning Agency of" and "COEC" on separate lines with 5 checkboxes; unclear if one item or two, Q-40); latest payslips (3 months); latest POEA contract; latest seaman's book |
| **OFW** | COEC; latest 3 months payslips; proof of remittance for the last 3 months |
| **Self-employed / business** | Articles of Partnership / Incorporation and By-Laws (if corporation); Audited Financial Statement for the last 3 years; DTI registration (if sole proprietorship); latest bank statements (6 months); latest GIS (if corporation); list of suppliers and customers (at least 3 each, with address and contact number); Mayor's Permit; **ITR if loan amount > 3M** (highlighted on the sheet) |
| **Licensed professional** | Bank statements (3 months); PRC ID |
| **Virtual assistant** | Bank statements (3 months); COEC; latest payslips (3 months) |
| **Commission-based** | Bank statements (3 months); check voucher (3 months); payslips (3 months) |
| **Rental business** | Notarized lease contract; TCT |
| **Jeepney / taxi / UV Express operators / business** | LTO franchise; LTO OR/CR |
| **Pensioner** | Bank statements (3 months); notification letter (pension) |

## Miscellaneous (credit marks Required?; then Submitted)
PSA copy of birth certificate; CENOMAR; PSA marriage certificate; PCAB; BFAD certificate.

## Developer-sourced applications (BPMN)
Developer requirements: Buyer's Information Sheet; latest Statement of Account; copy of Contract to Sell or Reservation Agreement; copy of TCT or Condominium Certificate of Title (CCT).
The developer is usually the source of the documents, so the applicant rarely uploads (App. G).

## Employment-type notes (BPMN)
- **Employed:** Certificate of Employment (COE) or COE with Compensation (COEC); 3 months payslips (if using COEC) or payroll bank statement; ITR required if the loan exceeds 3 million.
- **Self-employed:** business documents (business permits, DTI registration, etc.); 6 months bank statements; latest 3 years ITR and/or Audited Financial Statements. Virtual assistants: payslips and bank-transfer records are usually accepted.
- **Interviews (App. I):** employed = payslips, COE, ITR. Self-employed = government certificates (Mayor's Permit, DTI, or SEC for larger / corporate) plus bank statement or audited FS.

## Party-level checkboxes on the KYC tab
Per principal, spouse and co-borrower: Valid ID / Passport, SPA, FS / Bank Statements, COE / ITR, Payslips / Remittances (3 mos), SEC / DTI / Mayor's Permit.

## Acceptable alternatives and thresholds mentioned (App. I)
- Residence verification that cannot be confirmed: barangay certificate or proof of billing.
- Construction: at least 70 % of the house completed, or the developer's confirmation that payments are satisfactory.
- Many employers refuse to disclose employee information (Data Privacy Act). Payslips, statements and company ID are then accepted with terms and conditions.
- Upload limits on the current intake form: 2 x 10 files; anything over 10 MB goes to the drive.

## Later-stage checklists (Checklist tab, out of stated pre-approval scope, Q-05)
- **Credit Control Checklist (Developer / Regular Seller):** Credit Proposal (Financial Package / Accreditation, AAS / COM); Loan Documents; Transactional Documents; Security Related Documents (CI report, NFIS, appraisal, title, TCT under developer or borrower); Annotation and After-Annotation items; Insurance Requirements; Documents from the Developer; Documents from the Borrower (mandatory and others); Documents from Individual End-Buyers; and title-transfer items with "DOU in ___ days" deadlines.
- Kept here only for reference. Do not build for these until Q-05 is decided.

## Behavior to implement (from the paper)
- Selecting an attribute (e.g. "Self-Employed", "Married", co-borrower) expands the required data fields and upload slots.
- Each claim is bound to its evidence: declared income requires the ITR, COE or payslips before submission proceeds (1.3.3.3).
- File-type and legibility checks on upload (1.4.2.1, 1.3.3.3).
- A missing item triggers a targeted deficiency notice, not a generic one.
