// FP XI. Loan Verification: "Fill from KYC". Pure helper (no Supabase): proposes one XI. row per existing loan the
// borrowers declared in the KYC, for the CO to check against Loandex / the TU report before saving.
// The KYC only has the lender, the loan type and the monthly payment, so the balance, original loan and dates stay
// empty for the CO. Rows already in XI. (same lender, facility and amortization) are skipped.
// kycLoans: computed.existingLoans ({ party, loan_type, lending_institution, monthly_payment, term_over_6_months }).
// existing: the form's loan_checks rows.
import { partyLabel } from '../applicationForm/options.js';

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const same = (a, b) => str(a).toUpperCase() === str(b).toUpperCase();

export const kycLoanRows = (kycLoans, existing = []) => kycLoans
    .map((l) => ({
        bank_name: str(l.lending_institution),
        facility: str(l.loan_type),
        original_loan: '',
        outstanding_balance: '',
        amortization: str(l.monthly_payment),
        contract_date: '',
        maturity_date: '',
        remarks: `Declared in the KYC (${partyLabel(l.party)}), term ${l.term_over_6_months ? 'over 6 months' : '6 months or less'}`,
    }))
    .filter((r) => !existing.some((e) => same(e.bank_name, r.bank_name) && same(e.facility, r.facility)
        && Number(e.amortization || 0) === Number(r.amortization || 0)));
