// FP computations (KYC-FP "FP" and "Cashflow" tabs). Only the CO's inputs are stored; every figure here is
// recomputed from the record, and each result carries the inputs it came from so the page can show them.
import { getParties, one } from '../applicationForm/api';
import { BORROWER_ROLES } from '../applicationForm/options';
import { INCOME_BASES } from './options';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Excel PMT(rate/12, 12*years, -amount): the monthly payment that pays off the loan
export const monthlyAmortization = (amount, ratePercent, years) => {
    const p = num(amount);
    const n = num(years) * 12;
    const r = num(ratePercent);
    if (!p || !n || r === null) return null;
    const i = r / 100 / 12;
    return i === 0 ? p / n : (p * i) / (1 - (1 + i) ** -n);
};

// IX. Financial capacity, per borrower:
//   declared = KYC gross monthly income; (A) basic = declared x basis factor; (B) other income; gross = A + B.
// (A) is null until the CO picks a basis, unless the borrower declared no income.
const partyIncome = (party, details) => {
    const job = one(party.employment_info);
    const declared = job && job.employment_type !== 'UNEMPLOYED' ? num(job.gross_monthly_income) ?? 0 : 0;
    const basis = INCOME_BASES.find((b) => b.value === details?.income_basis) ?? null;
    const basic = declared === 0 ? 0 : basis ? declared * basis.factor : null;
    const other = num(details?.other_income) ?? 0;
    return { declared, basis, basic, other, gross: basic === null ? null : basic + other };
};

const sum = (values) => (values.some((v) => v === null) ? null : values.reduce((a, b) => a + b, 0));

// details: { [applicant_id]: fp_party_details form }, pkg: financial_packages form, pricing: { interest_rate }
export const computeFp = (app, details, pkg, pricing) => {
    const parties = getParties(app, BORROWER_ROLES);
    const incomes = parties.map((p) => ({ party: p, ...partyIncome(p, details[p.id]) }));

    // (C) existing monthly amortizations: every borrower's existing loans from the KYC. Loans with 6 months or
    // less left ("forgivable loans" on the KYC tab) are left out, the usual practice; to confirm with the bank
    // (FUTURE_TODO.md, "To ask the bank").
    const existingLoans = parties.flatMap((p) => (p.existing_loans ?? []).map((l) => ({ party: p, ...l })));
    const existing = existingLoans.filter((l) => l.term_over_6_months)
        .reduce((a, l) => a + (num(l.monthly_payment) ?? 0), 0);

    // (D) total gross income = all borrowers (principal + spouse + co-borrowers)
    const totalGross = sum(incomes.map((i) => i.gross));

    const amortization = monthlyAmortization(app.loan_amount, pricing.interest_rate, app.loan_term_years);
    const dbr = amortization === null || !totalGross ? null : (amortization + existing) / totalGross;

    // LCR = loan / appraised value when the CO has one, else TCP (selling price)
    const tcp = num(one(app.collateral_details)?.selling_price);
    const appraised = num(pkg.appraised_value);
    const collateralValue = appraised ?? tcp;
    const lcr = num(app.loan_amount) && collateralValue ? num(app.loan_amount) / collateralValue : null;

    return {
        incomes, existingLoans, existing, totalGross, amortization, dbr,
        tcp, appraised, collateralValue, lcr,
        missingBasis: incomes.filter((i) => i.basic === null).map((i) => i.party),
    };
};

export const percent = (ratio) => (ratio === null ? null : `${(ratio * 100).toFixed(2)}%`);
