// AI suggestion input (src/pages/aiSuggestion/buildInput.js): figures by role only, never personal data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestionInput, changedFacts, roleOf } from '../src/pages/aiSuggestion/buildInput.js';

const party = (id, role, partyNo = 1) => ({
    id, role, party_no: partyNo, first_name: 'Ana', middle_name: 'Santos', last_name: 'Dela Cruz', date_of_birth: '1988-04-12',
    gender: 'FEMALE', civil_status: 'MARRIED', mobile_number: '09175550101', email_address: 'ana.sample@mail.test',
    tin: '123-456-789', addresses: [{ address_type: 'PRESENT', building_street: '12 Sampaguita Street' }], dependents: [{ age: 6 }],
    employment_info: [{ employment_type: 'LOCALLY_EMPLOYED', employer_business_name: 'Synthetic Manufacturing Corp',
        occupation: 'Analyst', employment_date: '2016-06-01', gross_monthly_income: 90000, contact_number: '02 8555 0101' }],
});
const principal = party(11, 'PRINCIPAL');
const cob = party(13, 'CO_BORROWER', 2);
const app = {
    application_no: 'HL-2026-000123', loan_amount: 4850000, loan_term_years: 20, interest_rate: 7.25, fixing_period: '3 years',
    submitted_at: '2026-11-01', property_address: 'Lot 7 Block 3 Synthetic Residences', loan_purposes: [{ label: 'Purchase of a house and lot' }],
    collateral_details: [{ property_type: 'House and Lot', tct_cct_no: '004-2026000123', registered_owner: 'Synthetic Land Inc.' }],
    applicants: [principal, cob],
};
const computed = {
    incomes: [
        { party: principal, basis: { value: 'PAYSLIP' }, basic: 81000, other: 5000, gross: 86000 },
        { party: cob, basis: { value: 'COE' }, basic: 44000, other: 0, gross: 44000 },
    ],
    existing: 18500, totalGross: 130000, amortization: 38333.24, dbr: 0.437, collateralValue: 6000000, appraised: 6000000, lcr: 0.808,
};
const rules = {
    criteria: [{ code: 'DBR', category: 'CAPACITY', label: 'Debt Burden Ratio' }, { code: 'NFIS', category: 'CHARACTER', label: 'NFIS Checking' },
        { code: 'GENDER', category: 'CONDITION', label: 'Gender' }, { code: 'CIVIL_STATUS', category: 'CONDITION', label: 'Civil Status' },
        { code: 'AGE', category: 'CONDITION', label: 'Age' }],
    bands: [{ criterion: 'DBR', code: 'HI', label: '> 40%', points: 0 }, { criterion: 'NFIS', code: 'OK', label: 'No adverse record', points: 7 },
        { criterion: 'GENDER', code: 'F', label: 'Female', points: 4 }, { criterion: 'CIVIL_STATUS', code: 'M', label: 'Married', points: 4 },
        { criterion: 'AGE', code: 'Y', label: '36 - 45 years old', points: 3 }],
};
const entries = [{ criterion: 'DBR', band: 'HI', remarks: 'Ana is fine' }, { criterion: 'NFIS', band: 'OK' },
    { criterion: 'GENDER', band: 'F' }, { criterion: 'CIVIL_STATUS', band: 'M' }, { criterion: 'AGE', band: 'Y' }];
const score = { byCategory: { CAPACITY: { score: 0 }, CHARACTER: { score: 7 }, COLLATERAL: { score: 0 }, CONDITION: { score: 11 } },
    total: 18, complete: false, riskRating: null, recommendation: null };
const ci = { checks: [{ applicant_id: 11, check_type: 'NFIS', result: 'NO_ADVERSE_FINDINGS', summary: 'Ana Dela Cruz has no record' },
    { applicant_id: 11, check_type: 'TU', result: 'WITH_FINDINGS', summary: 'Account 0001-2345 past due' }] };
const input = buildSuggestionInput({ app, computed, score, rules, entries, ci, ciFlagged: true,
    exceptions: [{ policy: 'Age limit', exception_recommendation: 'Allow 20 years', mitigant: 'Younger co-borrower' }, { policy: null }],
    facts: { age_at_maturity: 58, dbr_standalone: 0.5 } });
const sent = JSON.stringify(input);

test('nothing personal goes out: names, birth date, contacts, addresses, IDs, employer, title, application no, CI summaries', () => {
    for (const secret of ['Ana', 'Santos', 'Dela Cruz', '1988-04-12', '09175550101', 'ana.sample@mail.test', '123-456-789',
        'Sampaguita', 'Synthetic Manufacturing', '02 8555 0101', 'HL-2026-000123', 'Lot 7 Block 3', '004-2026000123',
        'Synthetic Land', 'past due', 'has no record', 'Ana is fine']) {
        assert.ok(!sent.includes(secret), `"${secret}" must not be sent`);
    }
});

test('no Condition criteria, only their sub-total (never gender, civil status, dependents, residence, stay, age bands)', () => {
    assert.deepEqual(input.credit_score.criteria.map((c) => c.criterion), ['DBR', 'NFIS']);
    assert.equal(input.credit_score.condition_subtotal, 11);
    for (const word of ['Female', 'Married', 'GENDER', 'CIVIL_STATUS', '36 - 45', 'FEMALE', 'dependents']) {
        assert.ok(!sent.includes(word), `"${word}" must not be sent`);
    }
});

test('no key looks personal (the database and the worker refuse those too)', () => {
    const keys = [];
    const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.push(k); walk(x); });
    };
    walk(input);
    const personal = /((^|_)name$|address|email|mobile|phone|birth|gender|civil|dependent|residence|length_of_stay|^tin$|account_number|^tct|application_no)/i;
    assert.deepEqual(keys.filter((k) => personal.test(k)), []);
    assert.deepEqual(Object.keys(input), ['schema', 'loan', 'borrowers', 'totals', 'credit_score', 'ci', 'exceptions']);
});

test('the figures are there, borrowers by role', () => {
    assert.deepEqual(input.borrowers.map((b) => b.role), ['Principal', 'Co-borrower 2']);
    assert.equal(input.borrowers[0].tenure_years, 10);
    assert.equal(input.borrowers[0].gross_income, 86000);
    assert.equal(input.loan.amount, 4850000);
    assert.equal(input.loan.collateral_basis, 'APPRAISED_VALUE');
    assert.equal(input.totals.dbr, 0.437);
    assert.equal(input.totals.principal_age_at_maturity, 58);
    assert.deepEqual(input.ci.borrowers[0], { role: 'Principal', nfis: 'NO_ADVERSE_FINDINGS', tu: 'WITH_FINDINGS' });
    assert.equal(input.ci.findings_flagged, true);
    assert.deepEqual(input.exceptions, [{ policy: 'Age limit', recommendation: 'Allow 20 years', mitigant: 'Younger co-borrower' }]);
    assert.equal(roleOf({ role: 'SPOUSE' }), 'Spouse');
});

test('changedFacts: same rule as the policy check staleness', () => {
    assert.deepEqual(changedFacts({ dbr: 0.4, loan_amount: 100 }, { schema: 1, dbr: 0.4000000001, loan_amount: 100 }), []);
    assert.deepEqual(changedFacts({ dbr: 0.4, property_type: 'Condo' }, { dbr: 0.41, property_type: 'House', new_key: 1 }), ['dbr', 'property type']);
    assert.deepEqual(changedFacts(null, { dbr: 1 }), []);
});

test('the CI file checks go out as counts (null until all CI results are in)', () => {
    const withCi = buildSuggestionInput({
        app, computed, score: {}, rules: { criteria: [], bands: [] },
        facts: { has_replevin_or_foreclosure: false, nfis_deviation_count: 1, nfis_lcr_cap_breaches: 0, undisclosed_tu_accounts: 2, expired_ci_reports: 0 },
    });
    assert.deepEqual(withCi.ci.file_checks, { has_replevin_or_foreclosure: false, nfis_deviation_count: 1, nfis_lcr_cap_breaches: 0,
        undisclosed_tu_accounts: 2, expired_ci_reports: 0 });
    const without = buildSuggestionInput({ app, computed, score: {}, rules: { criteria: [], bands: [] } });
    assert.ok(Object.values(without.ci.file_checks).every((v) => v === null));
});
