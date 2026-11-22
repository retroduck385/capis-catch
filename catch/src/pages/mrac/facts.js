// The `facts` object sent with an MRAC check. Every number is one the Financial Package already computes
// (computeFp / totalCreditScore), so nothing is recalculated here or in the worker. Facts the RAAC needs that CATCH does not
// collect yet (employment_status, business_years, net_income_after_tax) are simply absent.
// From the Credit Investigator's saved NFIS records / TU accounts (ciFacts.js, when ci is passed): replevin /
// foreclosure, NFIS records outside the RAAC's acceptable records, acceptable ones whose LCR cap this loan breaks,
// TU loans and cards not declared in the KYC, and CI reports past their validity. null until every CI result is in.
// Missing data stays null and the
// rule engine reports "needs review" for it, never "pass". Keys must match mrac_criteria.field.
import { getParties, getParty, one } from '../applicationForm/api';
import { wholeYears } from '../applicationForm/derived';
import { BORROWER_ROLES } from '../applicationForm/options';
import { ciSlots, raacNfis, undisclosedLoans, validityRows } from '../ciRequest/ciFacts';

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// The CI facts (null each while any borrower's NFIS / TU result is missing; without ci, all null)
export const ciMracFacts = (app, computed, ci) => {
    const slots = ci ? ciSlots(app, ci) : [];
    const nfisIn = slots.length > 0 && slots.every((s) => s.nfis.result);
    const tuIn = slots.length > 0 && slots.every((s) => s.tu.result);
    const endUser = Boolean(one(app.referral_details)?.developer_name);
    const tcp = num(one(app.collateral_details)?.selling_price);
    const records = nfisIn ? raacNfis(slots, {
        endUser, lcr: computed?.lcr ?? null, tcpLcr: num(app.loan_amount) && tcp ? num(app.loan_amount) / tcp : null,
    }) : [];
    const tu = tuIn ? undisclosedLoans(slots) : [];
    const validity = validityRows(slots);
    return {
        has_replevin_or_foreclosure: nfisIn ? records.some((r) => r.status === 'NOT_ALLOWED') : null,
        nfis_deviation_count: nfisIn ? records.filter((r) => r.status === 'DEVIATION').length : null,
        nfis_lcr_cap_breaches: nfisIn ? records.filter((r) => r.status === 'ACCEPTABLE_IF_LCR' && r.lcrOk === false).length : null,
        undisclosed_tu_accounts: tuIn ? tu.reduce((t, r) => t + r.extraLoans + r.extraCards, 0) : null,
        expired_ci_reports: nfisIn && tuIn ? validity.filter((v) => v.status === 'EXPIRED' || v.status === 'NO_DATE').length : null,
    };
};

export const buildMracFacts = ({ app, computed, score, pricing = {}, exceptions = [], ci = null }) => {
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
        ...ciMracFacts(app, computed, ci),
    };
};
