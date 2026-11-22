// Policy-check profile (src/pages/mrac/profile.js): the wider picture for the recommender, by role only, never personal
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolicyProfile, DOCUMENT_ONLY_KEYS, PERSONAL_KEY } from '../src/pages/mrac/profile.js';

const party = (id, role, extra = {}) => ({
    id, role, party_no: extra.party_no ?? 1, first_name: 'Ana', middle_name: 'Santos', last_name: 'Dela Cruz',
    date_of_birth: '1988-04-12', gender: 'FEMALE', civil_status: 'MARRIED', citizenship: 'Filipino', mobile_number: '09175550101',
    email_address: 'ana.sample@mail.test', tin: '123-456-789', sss_no: '34-0000000-1',
    addresses: [{ address_type: 'PRESENT', building_street: '12 Sampaguita Street', living_in_ph: true, home_ownership: 'OWNED' }],
    dependents: [{ age: 6 }],
    employment_info: [{ employment_type: 'LOCALLY_EMPLOYED', employer_business_name: 'Synthetic Manufacturing Corp',
        employment_date: '2016-06-01', gross_monthly_income: 90000, contact_number: '02 8555 0101' }],
    existing_loans: [{ loan_type: 'Auto loan', lending_institution: 'Synthetic Savings Bank', monthly_payment: 12000, term_over_6_months: true }],
    bank_accounts: [{ bank_name: 'Synthetic Bank', account_number: '0001-2345-67' }],
    application_requirements: [
        { requirement_type: 'COE_ITR', documents: [{ id: 501, file_name: 'ana_coe.pdf' }] },
        { requirement_type: 'PAYSLIPS_REMITTANCES', documents: [{ id: 502, file_name: 'ana_payslips.pdf' }, { id: 503, file_name: 'p2.pdf' }] },
        { requirement_type: 'VALID_ID_PASSPORT', documents: [] },
    ],
    ...extra,
});
const principal = party(11, 'PRINCIPAL');
const ofwCob = party(13, 'CO_BORROWER', {
    party_no: 2, relationship_to_principal: 'Brother', citizenship: 'American',
    addresses: [{ address_type: 'PRESENT', living_in_ph: false, building_street: '1 Abroad Rd' }],
    employment_info: [{ employment_type: 'OFW', employment_date: '2023-02-01', employer_business_name: 'Overseas Co' }],
    existing_loans: [], application_requirements: [],
});
const aif = { id: 15, role: 'ATTORNEY_IN_FACT', first_name: 'Ramon', last_name: 'Cruz' };
const app = {
    application_no: 'HL-2026-000123', loan_amount: 4850000, loan_term_years: 20, interest_rate: 7.25, fixing_period: '3 years',
    submitted_at: '2026-11-01', property_address: 'Lot 7 Block 3 Synthetic Residences', loan_purposes: [{ label: 'Purchase of a house and lot' }],
    collateral_details: [{ property_type: 'House and Lot', tct_cct_no: '004-2026000123', registered_owner: 'Synthetic Land Inc.' }],
    referral_details: [{ developer_name: 'Synthetic Developers Inc.', channel: 'Developer', referrer: 'Juan Referrer', branch: 'Main' }],
    applicants: [principal, ofwCob, aif],
};
const computed = {
    incomes: [
        { party: principal, basis: { value: 'PAYSLIP' }, basic: 81000, other: 5000, gross: 86000 },
        { party: ofwCob, basis: { value: 'COE' }, basic: 44000, other: 0, gross: 44000 },
    ],
    existing: 12000, totalGross: 130000, amortization: 38333.24, dbr: 0.387, collateralValue: 6000000, appraised: 6000000, lcr: 0.808,
};
const ci = { checks: [
    { applicant_id: 11, check_type: 'NFIS', result: 'NO_ADVERSE_FINDINGS', summary: 'Ana Dela Cruz has no record' },
    { applicant_id: 11, check_type: 'TU', result: 'WITH_FINDINGS', summary: 'Account 0001-2345 past due' },
    { applicant_id: 13, check_type: 'BRAS', result: 'NO_ADVERSE_FINDINGS', summary: 'clean' },
] };
const fileMarks = [
    { document_id: 501, mark: 'NEEDS_NEW_COPY' }, { document_id: 501, mark: 'CLEARED' },     // latest mark wins
    { document_id: 502, mark: 'NEEDS_NEW_COPY', comment: 'Ana, page 2 is blurry' },
];
const profile = buildPolicyProfile({ app, computed, score: { total: 71, complete: true, riskRating: 'Low', recommendation: 'For Approval' },
    ci, ciFlagged: true, fileMarks, openDocumentRequest: true,
    exceptions: [{ policy: 'Age limit', exception_recommendation: 'Allow 20 years', mitigant: 'Younger co-borrower' }, { policy: null }],
    facts: { age_at_maturity: 58, dbr_standalone: 0.58 } });
const sent = JSON.stringify(profile);

test('nothing personal goes out: names, birth date, contacts, addresses, IDs, employer, lender, bank, title, referrer, CI summaries', () => {
    for (const secret of ['Ana', 'Santos', 'Dela Cruz', 'Ramon', '1988-04-12', '09175550101', 'ana.sample@mail.test', '123-456-789',
        '34-0000000-1', 'Sampaguita', 'Abroad Rd', 'Synthetic Manufacturing', 'Overseas Co', 'Synthetic Savings', 'Synthetic Bank',
        '0001-2345', '02 8555 0101', 'HL-2026-000123', 'Lot 7 Block 3', '004-2026000123', 'Synthetic Land', 'Synthetic Developers',
        'Juan Referrer', 'past due', 'has no record', 'blurry', 'ana_coe.pdf', 'FEMALE', 'OWNED', 'American', 'dependents']) {
        assert.ok(!sent.includes(secret), `"${secret}" must not be sent`);
    }
});

test('no key the database refuses (mrac_profile_problem)', () => {
    const keys = [];
    const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    };
    walk(profile);
    assert.deepEqual(keys.filter((k) => PERSONAL_KEY.test(k) && !DOCUMENT_ONLY_KEYS.includes(k)), []);
    assert.ok(!keys.includes('gender') && !keys.includes('dependents'));
    assert.deepEqual(Object.keys(profile).sort(),
        ['borrowers', 'ci', 'credit_score', 'documents', 'exceptions', 'loan', 'other_parties', 'schema', 'totals']);
});

test('borrowers by role, with what policies turn on: citizenship, abroad, employment, tenure, loans', () => {
    const [p, c] = profile.borrowers;
    assert.equal(p.role, 'Principal');
    assert.equal(p.filipino_citizen, true);
    assert.equal(p.lives_abroad, false);
    assert.equal(p.tenure_years, 10);
    assert.equal(p.civil_status, 'MARRIED', 'civil status as a category, for document rules only');
    assert.deepEqual(p.existing_loans, [{ type: 'Auto loan', monthly_payment: 12000, over_6_months: true }]);
    assert.equal(c.role, 'Co-borrower 2');
    assert.equal(c.relationship_to_principal, 'Brother');
    assert.equal(c.filipino_citizen, false);
    assert.equal(c.lives_abroad, true);
    assert.equal(c.employment_type, 'OFW');
    assert.equal(c.civil_status, 'MARRIED');
    assert.equal(profile.borrowers.length, 2, 'the attorney-in-fact is not a borrower');
    assert.deepEqual(profile.other_parties, { mortgagor: false, attorney_in_fact: true });
});

test('documents: required per borrower, files on file, latest staff mark per file', () => {
    assert.deepEqual(profile.documents.borrowers[0].required, [
        { requirement: 'COE_ITR', files: 1, cleared: 1, needs_new_copy: 0 },
        { requirement: 'PAYSLIPS_REMITTANCES', files: 2, cleared: 0, needs_new_copy: 1 },
        { requirement: 'VALID_ID_PASSPORT', files: 0, cleared: 0, needs_new_copy: 0 },
    ]);
    assert.equal(profile.documents.open_request_to_applicant, true);
});

test('loan, CI per role, totals and score', () => {
    assert.equal(profile.loan.from_developer, true);
    assert.equal(profile.loan.referral_channel, 'Developer');
    assert.equal(profile.loan.collateral_basis, 'APPRAISED_VALUE');
    const results = profile.ci.borrowers.map(({ role, nfis, tu, bras }) => ({ role, nfis, tu, bras }));
    // the CI's records and accounts (ciFacts.js): none here, and no report dates
    assert.deepEqual(profile.ci.borrowers[0].nfis_records, []);
    assert.equal(profile.ci.borrowers[0].nfis_validity, 'NO_DATE');
    assert.equal(profile.ci.borrowers[1].nfis_validity, null);
    assert.deepEqual(results, [
        { role: 'Principal', nfis: 'NO_ADVERSE_FINDINGS', tu: 'WITH_FINDINGS', bras: null },
        { role: 'Co-borrower 2', nfis: null, tu: null, bras: 'NO_ADVERSE_FINDINGS' },
    ]);
    assert.equal(profile.ci.findings_flagged, true);
    assert.equal(profile.totals.dbr_principal_only, 0.58);
    assert.equal(profile.totals.principal_age_at_maturity, 58);
    assert.deepEqual(profile.credit_score, { total: 71, complete: true, risk_rating: 'Low', recommendation: 'For Approval' });
    assert.equal(profile.exceptions.length, 1);
});

test('missing pieces stay null, never guessed', () => {
    const bare = buildPolicyProfile({ app: { applicants: [] }, computed: { incomes: [] } });
    assert.equal(bare.loan.amount, null);
    assert.equal(bare.loan.from_developer, false);
    assert.equal(bare.borrowers.length, 0);
    assert.equal(bare.credit_score.total, null);
});

test('civil status: only the four CATCH values, anything else null', () => {
    const odd = party(21, 'PRINCIPAL', { civil_status: 'complicated' });
    const out = buildPolicyProfile({ app: { applicants: [odd] }, computed: { incomes: [{ party: odd }] } });
    assert.equal(out.borrowers[0].civil_status, null);
});

test('CI records reach the policy check by role only: kind, age, balance, RAAC reading; never who reported them', () => {
    const app = {
        id: 1, loan_amount: 2000000, applicants: [{ id: 11, role: 'PRINCIPAL', party_no: 1, existing_loans: [], credit_cards: [] }],
        collateral_details: [{ selling_price: 2500000 }], referral_details: [],
    };
    const computed = { incomes: [{ party: app.applicants[0], gross: 100000 }], lcr: 0.8 };
    const ci = {
        checks: [{ applicant_id: 11, check_type: 'NFIS', result: 'WITH_FINDINGS', report_date: '2026-11-01' },
            { applicant_id: 11, check_type: 'TU', result: 'NO_ADVERSE_FINDINGS', report_date: '2026-11-01' }],
        nfisRecords: [{ id: 1, applicant_id: 11, record_type: 'FORECLOSURE', institution: 'Sample Bank', date_reported: '2015-01-01',
            case_reference: 'Civil Case 0000', remarks: 'free text' }],
        tuAccounts: [],
    };
    const profile = buildPolicyProfile({ app, computed, ci });
    const [rec] = profile.ci.borrowers[0].nfis_records;
    assert.equal(rec.kind, 'FORECLOSURE');
    assert.equal(rec.raac, 'NOT_ALLOWED');
    const text = JSON.stringify(profile);
    for (const secret of ['Sample Bank', 'Civil Case', 'free text']) assert.equal(text.includes(secret), false, secret);
    assert.equal(PERSONAL_KEY.test(Object.keys(rec).join(' ')), false);
});
