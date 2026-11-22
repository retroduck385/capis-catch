// CI result labels (enum values match ci_check_type / ci_check_result in 20261108_ci_results.sql; INCONCLUSIVE and the
// NFIS / TU row values in 20261126_ci_facts.sql; FRAUD in 20261127_ci_report_values.sql).
// BRAS is still a value of ci_check_type but is no longer used (meeting 2026-11-18): old rows stay in the database
// and are left out when CI results load (fetchCiResults in api.js).

export const CI_CHECKS = [
    { value: 'NFIS', label: 'NFIS', required: true },
    { value: 'TU', label: 'TransUnion (TU)', required: true },
];

// tone: the .lf-choice / chip colour. Inconclusive = the report couldn't settle it (consumer credit manual IV.D:
// discrepancies with the application form, or information that can't be verified)
export const CI_RESULTS = [
    { value: 'NO_ADVERSE_FINDINGS', label: 'No adverse findings', tone: 'ok' },
    { value: 'WITH_FINDINGS', label: 'With findings', tone: 'warn' },
    { value: 'INCONCLUSIVE', label: 'Inconclusive', tone: 'warn' },
];
export const resultTone = (value) => CI_RESULTS.find((r) => r.value === value)?.tone ?? 'none';
// Results the Credit Officer must look at (anything but a clean report)
export const needsAttention = (value) => value === 'WITH_FINDINGS' || value === 'INCONCLUSIVE';

// ---------- NFIS records (ci_nfis_records) ----------
export const NFIS_RECORD_TYPES = [
    { value: 'CANCELLED_CARD', label: 'Cancelled credit card' },
    { value: 'ADVERSE_LOAN', label: 'Adversely classified loan' },
    { value: 'CLOSED_CHECKING_ACCOUNT', label: 'Closed / mishandled checking account' },
    { value: 'RETURNED_CHECKS', label: 'Returned checks' },
    { value: 'COURT_CASE', label: 'Court case' },
    { value: 'REPLEVIN', label: 'Replevin' },
    { value: 'FORECLOSURE', label: 'Foreclosure' },
    { value: 'FRAUD', label: 'Fraud / fake documents' },
    { value: 'OTHER', label: 'Other' },
];
export const SETTLEMENTS = [
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'FULLY_PAID', label: 'Fully paid' },
    { value: 'ZERO_BALANCE', label: 'Zero balance' },
];
// The first four are the kinds whose amount the Credit Policy Manual (VII.D.3.c) says must be disclosed
export const CASE_TYPES = [
    { value: 'SUM_OF_MONEY', label: 'Sum of money', amountRequired: true },
    { value: 'DAMAGES', label: 'Damages', amountRequired: true },
    { value: 'ESTAFA', label: 'Estafa', amountRequired: true },
    { value: 'BP22', label: 'BP 22 (bouncing checks)', amountRequired: true },
    { value: 'OTHER', label: 'Other', amountRequired: false },
];
export const CASE_STATUSES = [
    { value: 'PENDING', label: 'Pending' },
    { value: 'DISMISSED', label: 'Dismissed' },
    { value: 'DECIDED', label: 'Decided' },
    { value: 'OTHER', label: 'Other' },
];
// Record kinds that need settled / unpaid (the RAAC acceptable cases depend on it)
export const NEEDS_SETTLEMENT = new Set(['CANCELLED_CARD', 'ADVERSE_LOAN']);
// Record kinds that carry a returned-checks count (the score's deposit / current account handling)
export const HAS_RETURNED_CHECKS = new Set(['CLOSED_CHECKING_ACCOUNT', 'RETURNED_CHECKS']);

// ---------- TU accounts (ci_tu_accounts) ----------
export const TU_OWNERSHIP = [
    { value: 'INDIVIDUAL', label: 'Individual' },
    { value: 'JOINT', label: 'Joint' },
    { value: 'GUARANTOR', label: 'Guarantor' },
    { value: 'CO_MAKER', label: 'Co-maker' },
];
export const TU_STATUSES = [
    { value: 'CURRENT', label: 'Current' },
    { value: 'PAST_DUE', label: 'Past due' },
    { value: 'WRITTEN_OFF', label: 'Written off' },
    { value: 'RESTRUCTURED', label: 'Restructured' },
    { value: 'LEGAL', label: 'Legal / collections' },
    { value: 'CLOSED', label: 'Closed' },
];
