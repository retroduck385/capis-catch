// Labels and defaults for the Financial Package (values match the enums in 20261020_financial_package.sql).
// Section numbers and labels follow the KYC-FP "FP" tab.

export const CREDIT_RESULTS = [
    { value: 'ENDORSED', label: 'Endorsed' },
    { value: 'NOT_ENDORSED', label: 'Not endorsed' },
    { value: 'DEFERRED', label: 'Deferred' },
];

// BPMN (Credit Officer lane): income from a COE counts at 80%, from payslips at 90%
export const INCOME_BASES = [
    { value: 'COE', label: 'COE (80%)', factor: 0.8 },
    { value: 'PAYSLIP', label: 'Payslip (90%)', factor: 0.9 },
    { value: 'DECLARED', label: 'As declared (100%)', factor: 1 },
];

export const PACKAGE_DEFAULTS = { manner_of_repayment: 'ADA or PDC' };

// Sheet's "Other Information" block per borrower in XIV. Customer Information
export const OTHER_INFO_TEMPLATE = [
    'ARSS:', 'TU:', 'New Gen, LMS & Finacle Checking:', '', 'Submitted IDs:', '', 'Submitted Documents:', '',
    'Submitted Employment Documents:', '', 'Remarks:',
].join('\n');

// VI. Terms and Conditions, from the sheet. Developer, rate and fixing period are filled in from the record.
export const termsTemplate = ({ developer, rate, fixing }) => [
    '1. Subject to the general terms and conditions of End User Financing.',
    '2. Processing Fee of Php8,500.00',
    '3. Submission of the following prior to release of loan proceeds:',
    '   a. The first year MRI and fire insurance shall be collected;',
    "   b. Latest SOA with signature of Developer's signatories and payment history;",
    "   c. Copy of CTC/CCT under Developer's Name",
    '   d. Signed/Notarized CTS;',
    '   e. Subject to occular inspection to verify % completion of the improvement;',
    '   f. Favorable residence report with pictures of Spouses;',
    '   g. Favorable employment verification of Principal Borrower;',
    '   h. Signed ARSS of spouses; and',
    '4. Borrowers must be enrolled with Mortgage Redemption Insurance either on the following options.',
    '   a. Enrollment to MRI covering the total loan amount of Borrower.',
    '   b. Endorsement of their existing life insurance in favor of the Bank.',
    `5. Issuance of Letter of Guarantee in favor of ${developer || '_______'}.`,
    '6. Amortization Schedule.',
    '7. Loan proceeds shall be payable to the seller/developer.',
    '8. Subject to the submission of DOU between the bank and the developer with the conformity of the buyer.',
    `9. The interest rate of ${rate ? `${rate}%` : '_______'} fixed for ${fixing || '____'} shall be valid for 60 days from the date of approval. If availed beyond 60 days, the prevailing ALCO rate shall apply, subject to LTAD validation.`,
    "10. Insurance premium (MRI/Fire) payments will be distributed across (tucked-in) the borrower's monthly amortizations or Interest rate is not inclusive of 0.70% for MRI & Fire Insurance. Borrowers to pay the yearly insurance premiums separately. To submit Post Dated Check (PDC) or ADA covering the MRI & Fire Insurance for the second year and every year thereafter.",
].join('\n');

// Row lists the CO adds to (config format = applicationForm/fields.jsx FieldGroup)
export const EXCEPTION_FIELDS = {
    policy: { label: 'Policy' },
    exception_recommendation: { label: 'Exception/s / Recommendation' },
    mitigant: { label: 'Risk Mitigant / Justifications' },
};

export const DEPOSIT_CHECK_FIELDS = {
    bank_name: { label: 'Bank Name' },
    account_name: { label: 'Account Name' },
    account_type: { label: 'Type of Account' },
    account_number: { label: 'Account Number' },
    amd: { label: 'AMD (PHP)', type: 'money' },
    adb: { label: 'ADB (PHP)', type: 'money' },
    remarks: { label: 'Status / Handling / Remarks' },
};

export const LOAN_CHECK_FIELDS = {
    bank_name: { label: 'Bank Name' },
    facility: { label: 'Facility' },
    original_loan: { label: 'Original Loan (PHP)', type: 'money' },
    outstanding_balance: { label: 'Outstanding Balance (PHP)', type: 'money' },
    amortization: { label: 'Amortization (PHP)', type: 'money' },
    contract_date: { label: 'Contract Date', type: 'date' },
    maturity_date: { label: 'Maturity Date', type: 'date' },
    remarks: { label: 'Remarks (Informant, Date of CIR)' },
};

export const TRADE_CHECK_FIELDS = {
    company_name: { label: 'Company Name' },
    transaction_type: { label: 'Type of Transaction' },
    product_service: { label: 'Type of Product / Service' },
    volume: { label: 'Volume' },
    frequency: { label: 'Frequency' },
    payment_handling: { label: 'Payment Handling' },
    remarks: { label: 'Remarks (Informant, Date of CIR)' },
};

export const TITLE_KINDS = [
    { value: 'PRESENT', label: 'Present Title' },
    { value: 'PRECEDING', label: 'First Preceding Title' },
];

export const TITLE_FIELDS = {
    title_no: { label: 'Title No.' },
    registered_owner: { label: 'Registered Owner' },
    date_of_verification: { label: 'Date of Verification', type: 'date' },
    place_of_verification: { label: 'Place of Verification' },
    mode_of_conveyance: { label: 'Mode of Conveyance' },
    date_of_inscription: { label: 'Date of Inscription', type: 'date' },
    remarks: { label: 'Remarks' },
};

// audit_log table names that belong to the FP (for its change history)
export const FP_TABLES = ['financial_packages', 'fp_party_details', 'fp_exceptions', 'fp_deposit_checks',
    'fp_loan_checks', 'fp_trade_checks', 'fp_title_verifications'];
