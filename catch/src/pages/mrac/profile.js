// The application profile sent with a policy check (mrac_runs.profile, 20261122_mrac_profile.sql). The policy
// recommender (mrac-service) reads it to find which policies the file triggers: borrower types, documents on file, CI
// results, collateral, the figures. The flat `facts` (facts.js) stay what the rules test and what "figures changed
// since the check" compares; this is the wider picture.
//
// Pure (no React, no Supabase) so tests/mracProfile.test.mjs can check it. Same privacy rule as the AI suggestion
// (aiSuggestion/buildInput.js): borrowers by ROLE only; never names, birth dates, gender, dependents, addresses,
// contact details, employer / bank / lender names, ID / TIN / account / title numbers, the application number or the
// CI's free-text summaries. The database refuses a profile with a personal key (mrac_profile_problem).
// One exception (Josh, 2026-11-22): civil status as a category (SINGLE / MARRIED / WIDOWED / SEPARATED), ONLY so the
// recommender can find document rules (marriage certificate, CENOMAR, spousal consent). The recommender is told never
// to use it as a judgment of the borrower, and the database accepts it only as borrowers[].civil_status with one of
// those values.
import { roleOf, yearsBetween } from '../aiSuggestion/buildInput.js';

const BORROWERS = ['PRINCIPAL', 'SPOUSE', 'CO_BORROWER'];
// The civil_status_type values; anything else is sent as null
const CIVIL_STATUSES = new Set(['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED']);
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const present = (party) => party?.addresses?.find((a) => a.address_type === 'PRESENT') ?? null;

// Free-text citizenship -> true / false / null (not stated)
const filipino = (v) => (text(v) === null ? null : /filipin|pilipin|philippine/i.test(v));

// latest mark per document id (marks come oldest first)
const latestMarks = (marks) => {
    const out = {};
    for (const m of marks) out[m.document_id] = m.mark;
    return out;
};

// app: the application record (fetchApplication); computed: computeFp(); score: totalCreditScore();
// ci: { checks } from fetchCiResults; ciFlagged: a CI flagged findings; fileMarks: document_file_marks rows;
// openDocumentRequest: an AO request to the applicant is still open; exceptions: the FP's V. Exception/s rows;
// facts: buildMracFacts() (for the principal's age at maturity and stand-alone DBR).
export const buildPolicyProfile = ({ app, computed, score = {}, ci = { checks: [] }, ciFlagged = false, fileMarks = [],
    openDocumentRequest = false, exceptions = [], facts = {} }) => {
    const collateral = one(app.collateral_details);
    const referral = one(app.referral_details);
    const parties = app.applicants ?? [];
    const borrowers = (computed.incomes ?? []).map((i) => i.party).filter((p) => BORROWERS.includes(p.role));
    const income = Object.fromEntries((computed.incomes ?? []).map((i) => [i.party.id, i]));
    const ciOf = (party, type) => ci.checks.find((x) => x.applicant_id === party.id && x.check_type === type)?.result ?? null;
    const marks = latestMarks(fileMarks);

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
            from_developer: Boolean(text(referral?.developer_name)),
            referral_channel: text(referral?.channel),
        },
        borrowers: borrowers.map((party) => {
            const job = one(party.employment_info);
            const i = income[party.id] ?? {};
            const loans = party.existing_loans ?? [];
            const address = present(party);
            return {
                role: roleOf(party),
                relationship_to_principal: party.role === 'CO_BORROWER' ? text(party.relationship_to_principal) : null,
                filipino_citizen: filipino(party.citizenship),
                // document rules only (see the top of this file); the spouse form has no civil status, so it stays null
                civil_status: CIVIL_STATUSES.has(party.civil_status) ? party.civil_status : null,
                lives_abroad: address && address.living_in_ph === false ? true : address ? false : null,
                employment_type: job?.employment_type ?? null,
                tenure_years: job && job.employment_type !== 'UNEMPLOYED' ? yearsBetween(job.employment_date, app.submitted_at) : null,
                income_basis: i.basis?.value ?? null,
                gross_income: num(i.gross),
                existing_loans: loans.map((l) => ({ type: text(l.loan_type), monthly_payment: num(l.monthly_payment),
                    over_6_months: l.term_over_6_months ?? null })),
            };
        }),
        other_parties: {
            mortgagor: parties.some((p) => p.role === 'MORTGAGOR'),
            attorney_in_fact: parties.some((p) => p.role === 'ATTORNEY_IN_FACT'),
        },
        totals: {
            existing_monthly_amortization: num(computed.existing),
            total_gross_income: num(computed.totalGross),
            new_monthly_amortization: num(computed.amortization),
            dbr: num(computed.dbr),
            dbr_principal_only: num(facts.dbr_standalone),
            principal_age_at_maturity: num(facts.age_at_maturity),
        },
        credit_score: {
            total: num(score.total),
            complete: Boolean(score.complete),
            risk_rating: score.riskRating ?? null,
            recommendation: score.recommendation ?? null,
        },
        ci: {
            borrowers: borrowers.map((p) => ({ role: roleOf(p), nfis: ciOf(p, 'NFIS'), tu: ciOf(p, 'TU'), bras: ciOf(p, 'BRAS') })),
            findings_flagged: Boolean(ciFlagged),
        },
        // The checklist CATCH derived from each borrower's employment type, with what is on file and the staff marks
        documents: {
            borrowers: borrowers.map((p) => ({
                role: roleOf(p),
                required: (p.application_requirements ?? []).map((r) => {
                    const docs = r.documents ?? [];
                    return {
                        requirement: r.requirement_type,
                        files: docs.length,
                        cleared: docs.filter((d) => marks[d.id] === 'CLEARED').length,
                        needs_new_copy: docs.filter((d) => marks[d.id] === 'NEEDS_NEW_COPY').length,
                    };
                }),
            })),
            open_request_to_applicant: Boolean(openDocumentRequest),
        },
        exceptions: exceptions.filter((e) => e.policy || e.exception_recommendation || e.mitigant).map((e) => ({
            policy: text(e.policy), recommendation: text(e.exception_recommendation), mitigant: text(e.mitigant),
        })),
    };
};

// The one key that matches PERSONAL_KEY but is allowed, only on a borrower and only as a CIVIL_STATUSES value
export const DOCUMENT_ONLY_KEYS = ['civil_status'];

// Same pattern the database refuses (mrac_profile_problem / credit_suggestion_input_problem)
export const PERSONAL_KEY = /((^|_)name$|address|email|mobile|phone|birth|gender|civil|dependent|residence|length_of_stay|^tin$|account_number|^tct|application_no)/i;
