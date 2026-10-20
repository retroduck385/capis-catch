// Housing Loan Credit Scoring (KYC-FP "Credit_Score" tab). Points per band come from the DB
// (credit_score_bands, column B of the sheet); this file only SUGGESTS a band per criterion from the record
// and adds up what the CO picked. Nothing counts until the CO picks or accepts a band (human in the loop).
//
// Like the sheet, the Condition criteria and tenure / source of income use the principal borrower only.
// Thresholds copy the sheet's IF formulas, including where they sit on the boundary (e.g. DBR 33.9% = 26–33%).
import { getAddress, getParty, one } from '../applicationForm/api';
import { tenure, wholeYears } from '../applicationForm/derived';
import { CIVIL_STATUSES, EMPLOYMENT_TYPES, GENDERS, HOME_OWNERSHIP, formatMoney, labelFor } from '../applicationForm/options';
import { percent } from './compute';

export const CATEGORIES = [
    { value: 'CAPACITY', label: '1. Capacity' },
    { value: 'CHARACTER', label: '2. Character' },
    { value: 'COLLATERAL', label: '3. Collateral' },
    { value: 'CONDITION', label: '4. Condition' },
];

// Credit Score Legend (sheet G100:J110): lower bound (inclusive) -> label
const DESCRIPTIONS = [[90, 'Excellent'], [80, 'Strong'], [70, 'Good'], [60, 'Fair'], [55, 'Acceptable'],
    [50, 'Marginal'], [45, 'Unsatisfactory'], [40, 'Substandard'], [35, 'Doubtful'], [-Infinity, 'Expected Loss']];
const RISK_RATINGS = [[90, 'Very Low Risk'], [80, 'Low Risk'], [60, 'Moderate Risk'], [50, 'High Risk'],
    [-Infinity, 'Very High Risk']];
const RECOMMENDATIONS = [[60, 'For Approval'], [55, 'For approval (Acceptable per RAAC)'],
    [50, 'For consideration if with higher equity or higher interest rate'], [-Infinity, 'Disapprove']];
const lookup = (table, score) => table.find(([min]) => score >= min)[1];

const peso = (v) => `₱${formatMoney(v)}`;
const years = (n) => `${n} ${n === 1 ? 'year' : 'years'}`;

// Each suggester returns { input, band, source }: input = the value scored ("Actual" in the sheet),
// band = suggested band code or null, source = where it came from / why there's no suggestion.
const pick = (input, band, source) => ({ input, band, source });
const none = (source, input = null) => ({ input, band: null, source });

// Employment type -> Source of Income band. Licensed professionals and VAs can be employed or
// self-employed, so the CO picks those.
const INCOME_SOURCE_BANDS = {
    LOCALLY_EMPLOYED: 'LOCALLY_EMPLOYED',
    COMMISSION_BASED: 'LOCALLY_EMPLOYED',
    OFW: 'OFW',
    SEAFARER: 'SEAFARER',
    SELF_EMPLOYED: 'SELF_EMPLOYED',
    RENTAL_BUSINESS: 'SELF_EMPLOYED',
    PUV_OPERATOR: 'SELF_EMPLOYED',
    PENSIONER: 'PENSION',
};

// Property type is free text in the KYC; fall back to the loan purpose. Order matters
// ("townhouse" / "row house" before "house and lot").
const COLLATERAL_TYPE_PATTERNS = [
    [/condo/i, 'CONDOMINIUM'],
    [/town\s*house/i, 'TOWNHOUSE'],
    [/row\s*house/i, 'ROW_HOUSE'],
    [/vacant|lot only/i, 'VACANT_LOT'],
    [/\bhouse/i, 'HOUSE_AND_LOT'],
];

const RESIDENCE_BANDS = { LIVING_WITH_RELATIVES: 'WITH_PARENTS', OWNED: 'OWNED', RENTED: 'RENTED', OTHER: 'OTHERS' };

const SUGGESTERS = {
    // ---------- Capacity ----------
    DBR: ({ computed }) => {
        if (computed.amortization === null) return none('Needs the interest rate (II. Facility).');
        if (computed.totalGross === null) return none('Pick every borrower\'s income basis (IX. Cash Flow).');
        if (computed.dbr === null) return none('No income to divide by.');
        const d = computed.dbr;
        return pick(percent(d), d < 0.26 ? 'BELOW_26' : d < 0.34 ? 'FROM_26_TO_33' : d <= 0.4 ? 'FROM_34_TO_40' : 'ABOVE_40',
            'DBR from IX. Financial Capacity.');
    },
    // The sheet scores Total Gross Income (D) here (FP!D120), not a net figure
    NDI: ({ computed }) => {
        const v = computed.totalGross;
        if (v === null) return none('Pick every borrower\'s income basis (IX. Cash Flow).');
        return pick(peso(v), v < 40000 ? 'BELOW_40K' : v < 60000 ? 'FROM_40K' : v < 80000 ? 'FROM_60K'
            : v < 100000 ? 'FROM_80K' : 'FROM_100K', 'Total Gross Income (D) from IX, as the sheet does.');
    },
    TENURE: ({ app, principal }) => {
        const job = one(principal?.employment_info);
        const y = wholeYears(job?.employment_date, app.submitted_at);
        if (y === null) return none('No employment / business registration date in the KYC.');
        return pick(tenure(job.employment_date, app.submitted_at),
            y < 2 ? 'BELOW_2' : y <= 3 ? 'FROM_2_TO_3' : y <= 5 ? 'FROM_3_TO_5' : 'ABOVE_5',
            'Principal\'s date hired / registration, in whole years as of submission.');
    },
    INCOME_SOURCE: ({ principal }) => {
        const type = one(principal?.employment_info)?.employment_type;
        if (!type) return none('No employment type in the KYC.');
        const input = labelFor(EMPLOYMENT_TYPES, type);
        const band = INCOME_SOURCE_BANDS[type];
        return band ? pick(input, band, 'Principal\'s employment type.')
            : none('Could be locally employed or self-employed: pick from the documents.', input);
    },

    // ---------- Character (mostly from the CI and the CO's own checks) ----------
    LOAN_HISTORY: ({ computed, form }) => {
        const checked = form.loan_checks.filter((r) => r.bank_name || r.facility).length;
        if (computed.existingLoans.length || checked) {
            return none('Has loans: pick from the payment history (Loandex / CI).',
                `${computed.existingLoans.length} declared, ${checked} verified`);
        }
        return pick('None declared or verified', 'NONE',
            'No loans in the KYC or XI. Loan Verification. Fully paid past loans won\'t show here; check Loandex / CI.');
    },
    DEPOSIT_HANDLING: ({ app, form }) => {
        const types = [
            ...(app.applicants ?? []).flatMap((p) => (p.bank_accounts ?? []).map((b) => b.account_type)),
            ...form.deposit_checks.map((r) => r.account_type),
        ].filter(Boolean);
        if (types.length === 0) return none('No bank accounts in the KYC or X. Deposit Checking.');
        const input = [...new Set(types)].join(', ');
        if (types.every((t) => /saving/i.test(t))) {
            return pick(input, 'SAVINGS_ONLY', 'Every declared / checked account is a savings account.');
        }
        return none('Has a checking / other account: pick from the returned-check history.', input);
    },
    NFIS: () => none('Awaiting the Credit Investigator\'s NFIS results.'),

    // ---------- Collateral ----------
    // The sheet points this at the Statement of Account cell (FP!D42); CATCH uses the collateral value
    COLLATERAL_VALUE: ({ computed }) => {
        const v = computed.collateralValue;
        if (!v) return none('No appraised value or selling price yet.');
        return pick(peso(v), v < 1000000 ? 'BELOW_1M' : v <= 3000000 ? 'FROM_1M_TO_3M' : 'ABOVE_3M',
            computed.appraised !== null ? 'Appraised value (III).' : 'TCP / selling price (no appraised value yet).');
    },
    COLLATERAL_TYPE: ({ app }) => {
        const type = one(app.collateral_details)?.property_type;
        const purpose = one(app.loan_purposes)?.label ?? app.loan_purpose_other;
        for (const [text, source] of [[type, 'Property type in the KYC.'], [purpose, 'Loan purpose (no matching property type).']]) {
            const match = text && COLLATERAL_TYPE_PATTERNS.find(([re]) => re.test(text));
            if (match) return pick(text, match[1], source);
        }
        return none('Property type doesn\'t match a band.', type || purpose);
    },
    // The KYC doesn't ask how the property will be used; this reads the loan purpose
    PROPERTY_USAGE: ({ app }) => {
        const purpose = one(app.loan_purposes)?.label ?? app.loan_purpose_other;
        if (!purpose) return none('No loan purpose in the KYC.');
        if (/investment/i.test(purpose)) return pick(purpose, 'INVESTMENT', 'Loan purpose says investment.');
        if (/another property/i.test(purpose)) return none('Different property from the collateral: ask the borrower.', purpose);
        if (/acquisition|purchase/i.test(purpose)) {
            return pick(purpose, 'FOR_PRIMARY', 'Buying a home (purpose doesn\'t say investment). Confirm with the borrower.');
        }
        return none('Refinancing / construction / improvement: check if they live there now.', purpose);
    },
    LCR: ({ computed }) => {
        const l = computed.lcr;
        if (l === null) return none('Needs the loan amount and a collateral value.');
        return pick(percent(l), l < 0.6 ? 'BELOW_60' : l <= 0.8 ? 'FROM_60_TO_80' : 'ABOVE_80',
            'LCR from II. Facility.');
    },

    // ---------- Condition (principal borrower) ----------
    DEPENDENTS: ({ principal }) => {
        const n = (principal?.dependents ?? []).length;
        return pick(String(n), n < 2 ? 'ONE_OR_NONE' : n <= 3 ? 'TWO_TO_THREE' : 'MORE_THAN_THREE',
            'Principal\'s dependents in the KYC.');
    },
    LENGTH_OF_STAY: ({ app, principal }) => {
        const y = wholeYears(getAddress(principal, 'PRESENT')?.date_move_in, app.submitted_at);
        if (y === null) return none('No move-in date for the present address.');
        return pick(years(y), y < 2 ? 'ONE_DOWN' : y < 4 ? 'TWO_TO_THREE' : y < 6 ? 'FOUR_TO_FIVE' : 'SIX_UP',
            'Principal\'s present address move-in date, whole years as of submission.');
    },
    AGE: ({ app, principal }) => {
        const a = wholeYears(principal?.date_of_birth, app.submitted_at);
        if (a === null) return none('No date of birth in the KYC.');
        return pick(years(a), a < 25 || a > 65 ? 'OUTSIDE_25_65' : a < 36 ? 'FROM_25_TO_35' : a < 46 ? 'FROM_36_TO_45' : 'FROM_46_TO_65',
            'Principal\'s age as of submission.');
    },
    CIVIL_STATUS: ({ principal }) => {
        const s = principal?.civil_status;
        if (!s) return none('No civil status in the KYC.');
        return pick(labelFor(CIVIL_STATUSES, s), s === 'MARRIED' ? 'MARRIED' : 'NOT_MARRIED', 'Principal\'s civil status.');
    },
    GENDER: ({ principal }) => {
        const g = principal?.gender;
        if (!g) return none('No gender in the KYC.');
        if (g === 'MALE' || g === 'FEMALE') return pick(labelFor(GENDERS, g), g, 'Principal\'s gender.');
        return none('The sheet only has Male / Female bands.', labelFor(GENDERS, g));
    },
    RESIDENCE_TYPE: ({ principal }) => {
        const own = getAddress(principal, 'PRESENT')?.home_ownership;
        if (!own) return none('No home ownership for the present address.');
        return pick(labelFor(HOME_OWNERSHIP, own), RESIDENCE_BANDS[own], 'Principal\'s home ownership (present address).');
    },
};

// { [criterion]: { input, band, source } } for every criterion in the rules
export const suggestCreditScore = (app, computed, form, criteria) => {
    const ctx = { app, computed, form, principal: getParty(app, 'PRINCIPAL') };
    return Object.fromEntries(criteria.map((c) => [c.code, SUGGESTERS[c.code]?.(ctx) ?? none('No suggestion for this criterion.')]));
};

// rules = { criteria, bands } from the DB; scores = { [criterion]: { band } } (the CO's picks)
export const totalCreditScore = (rules, scores) => {
    const pointsOf = (criterion, band) => rules.bands.find((b) => b.criterion === criterion && b.code === band)?.points ?? null;
    const maxOf = (criterion) => Math.max(...rules.bands.filter((b) => b.criterion === criterion).map((b) => b.points));
    const byCategory = Object.fromEntries(CATEGORIES.map(({ value }) => {
        const criteria = rules.criteria.filter((c) => c.category === value);
        const picked = criteria.map((c) => pointsOf(c.code, scores[c.code]?.band)).filter((p) => p !== null);
        return [value, { score: picked.reduce((a, b) => a + b, 0), max: criteria.reduce((a, c) => a + maxOf(c.code), 0) }];
    }));
    const scored = rules.criteria.filter((c) => scores[c.code]?.band).length;
    const total = Object.values(byCategory).reduce((a, c) => a + c.score, 0);
    const complete = scored === rules.criteria.length && scored > 0;
    return {
        byCategory, total, scored, count: rules.criteria.length, complete, pointsOf,
        description: complete ? lookup(DESCRIPTIONS, total) : null,
        riskRating: complete ? lookup(RISK_RATINGS, total) : null,
        recommendation: complete ? lookup(RECOMMENDATIONS, total) : null,
    };
};
