// AI suggestion for the credit result: what the page sends (20261120_credit_ai_suggestions.sql, ocr-service/advise.py).
// Pure (no React, no Supabase), so tests/aiSuggestion.test.mjs can check it never lets personal data through.
// Only saved, confirmed values, as figures and labels; borrowers by ROLE, never by name. Left out on purpose: names,
// birth dates, addresses, contact details, employer and bank names, ID / TIN / account / title numbers, the
// application number, the CI's free-text summaries, and the Condition criteria (gender, civil status, dependents,
// residence type, length of stay, age bands): only their sub-total is sent.
// SYNTHETIC TEST FILES ONLY until the data privacy question (Q-04) is cleared.

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export const roleOf = (party) => (party.role === 'PRINCIPAL' ? 'Principal' : party.role === 'SPOUSE' ? 'Spouse'
    : party.role === 'CO_BORROWER' ? `Co-borrower ${party.party_no ?? 1}` : 'Borrower');

const yearsBetween = (from, asOf) => {
    if (!from || !asOf) return null;
    const a = new Date(from);
    const b = new Date(asOf);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    let years = b.getFullYear() - a.getFullYear();
    if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) years -= 1;
    return Math.max(0, years);
};

// app: the application record; computed: computeFp(); score: totalCreditScore(); rules: { criteria, bands };
// entries: credit_score_entries; ci: { checks } from fetchCiResults; ciFlagged: true if a CI flagged findings;
// exceptions: fp_exceptions rows; facts: the policy-check facts of now (buildMracFacts) for the principal's age.
export const buildSuggestionInput = ({ app, computed, score, rules, entries = [], ci = { checks: [] }, ciFlagged = false,
    exceptions = [], facts = {} }) => {
    const collateral = one(app.collateral_details);
    const condition = new Set(rules.criteria.filter((c) => c.category === 'CONDITION').map((c) => c.code));
    const bandOf = (criterion, code) => rules.bands.find((b) => b.criterion === criterion && b.code === code) ?? null;
    const parties = computed.incomes.map((i) => i.party);

    return {
        schema: 1,
        loan: {
            amount: num(app.loan_amount),
            term_years: num(app.loan_term_years),
            interest_rate: num(app.interest_rate),
            fixing_period: text(app.fixing_period),
            purpose: text(one(app.loan_purposes)?.label ?? app.loan_purpose_other),
            property_type: text(collateral?.property_type),
            collateral_value: num(computed.collateralValue),
            collateral_basis: computed.appraised !== null && computed.appraised !== undefined ? 'APPRAISED_VALUE' : 'SELLING_PRICE',
            lcr: num(computed.lcr),
        },
        borrowers: computed.incomes.map(({ party, basis, basic, other, gross }) => {
            const job = one(party.employment_info);
            return {
                role: roleOf(party),
                employment_type: job?.employment_type ?? null,
                tenure_years: job && job.employment_type !== 'UNEMPLOYED' ? yearsBetween(job.employment_date, app.submitted_at) : null,
                income_basis: basis?.value ?? null,
                basic_income: num(basic),
                other_income: num(other),
                gross_income: num(gross),
            };
        }),
        totals: {
            existing_monthly_amortization: num(computed.existing),
            total_gross_income: num(computed.totalGross),
            new_monthly_amortization: num(computed.amortization),
            dbr: num(computed.dbr),
            dbr_principal_only: num(facts.dbr_standalone),
            principal_age_at_maturity: num(facts.age_at_maturity),
        },
        credit_score: {
            criteria: rules.criteria.filter((c) => !condition.has(c.code)).map((c) => {
                const entry = entries.find((e) => e.criterion === c.code);
                const band = entry ? bandOf(c.code, entry.band) : null;
                return { category: c.category, criterion: c.code, label: c.label, band: band?.label ?? null, points: band ? num(band.points) : null };
            }),
            subtotals: Object.fromEntries(Object.entries(score.byCategory ?? {}).map(([k, v]) => [k, num(v.score)])),
            condition_subtotal: num(score.byCategory?.CONDITION?.score),
            total: num(score.total),
            complete: Boolean(score.complete),
            risk_rating: score.riskRating ?? null,
            recommendation: score.recommendation ?? null,
        },
        ci: {
            borrowers: parties.map((p) => ({
                role: roleOf(p),
                nfis: ci.checks.find((x) => x.applicant_id === p.id && x.check_type === 'NFIS')?.result ?? null,
                tu: ci.checks.find((x) => x.applicant_id === p.id && x.check_type === 'TU')?.result ?? null,
            })),
            findings_flagged: Boolean(ciFlagged),
        },
        exceptions: exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant).map((e) => ({
            policy: text(e.policy), recommendation: text(e.exception_recommendation), mitigant: text(e.mitigant),
        })),
    };
};

// Which facts differ between the ones the policy check ran on and the figures now (same rule as Decision Support
// and request_credit_suggestion() in the database)
export const changedFacts = (runFacts, nowFacts) => {
    if (!runFacts) return [];
    return Object.keys(nowFacts).filter((key) => {
        if (key === 'schema' || !(key in runFacts)) return false;
        const a = runFacts[key];
        const b = nowFacts[key];
        if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
        return (a ?? null) !== (b ?? null);
    }).map((key) => key.replaceAll('_', ' '));
};

export const RESULT_LABELS = { ENDORSED: 'Endorsed', NOT_ENDORSED: 'Not endorsed', DEFERRED: 'Deferred' };
