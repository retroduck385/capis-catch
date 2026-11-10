// The `facts` object sent with an MRAC check. Every number is one the Financial Package already computes
// (computeFp / totalCreditScore), so nothing is recalculated here or in the worker. Facts the RAAC needs that CATCH does not
// collect yet (employment_status, business_years, net_income_after_tax, has_replevin_or_foreclosure) are simply absent.
// Missing data stays null and the
// rule engine reports "needs review" for it, never "pass". Keys must match mrac_criteria.field.
import { getParties, getParty, one } from '../applicationForm/api';
import { wholeYears } from '../applicationForm/derived';
import { BORROWER_ROLES } from '../applicationForm/options';

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export const buildMracFacts = ({ app, computed, score, pricing = {}, exceptions = [] }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const job = one(principal?.employment_info);
    const age = wholeYears(principal?.date_of_birth, app.submitted_at);
    const term = num(app.loan_term_years);
    // The principal's DBR on his/her own income: the RAAC requires a co-borrower when this alone exceeds the limit
    const ownIncome = num(computed.incomes?.find((i) => i.party?.id === principal?.id)?.gross);
    const monthlyDebt = num(computed.amortization) === null ? null : computed.amortization + (num(computed.existing) ?? 0);
    return {
        schema: 1,
        loan_amount: num(app.loan_amount),
        loan_term_years: term,
        interest_rate: num(pricing.interest_rate ?? app.interest_rate),
        amortization: num(computed.amortization),
        total_gross_income: num(computed.totalGross),
        existing_monthly_debt: num(computed.existing),
        dbr: num(computed.dbr),                       // ratio, 0.40 = 40%
        dbr_standalone: monthlyDebt !== null && ownIncome ? monthlyDebt / ownIncome : null,
        collateral_value: num(computed.collateralValue),
        lcr: num(computed.lcr),                       // ratio, 0.80 = 80%
        age,
        age_at_maturity: age !== null && term !== null ? age + term : null,
        tenure_years: wholeYears(job?.employment_date, app.submitted_at),
        employment_type: job?.employment_type ?? null,
        borrower_count: getParties(app, BORROWER_ROLES).length,
        property_type: one(app.collateral_details)?.property_type ?? null,
        scorecard_total: score?.complete ? score.total : null,   // only a fully scored sheet counts
        scorecard_complete: Boolean(score?.complete),
        existing_exception_count: exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant).length,
    };
};
