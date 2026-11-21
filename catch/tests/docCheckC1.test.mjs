// Part C1: severity colours on the AI check (item 12) and KYC "Request a file" (item 15). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differsTone, docHasProblem, fieldTone, worst } from '../src/pages/documentCheck/severity.js';
import { kycFileRequest } from '../src/pages/loanFolder/kycAsk.js';

const def = (field_key, extra = {}) => ({ field_key, ...extra });

test('a difference on a key fact is a problem; other differences are worth a look', () => {
    for (const k of ['last_name', 'date_of_birth', 'sex', 'employee_tin', 'employer_tin', 'sss_no', 'monthly_gross_income']) {
        assert.equal(fieldTone({ def: def(k), status: 'DIFFERS' }), 'bad', k);
        assert.equal(differsTone(def(k)), 'bad', k);
    }
    assert.equal(fieldTone({ def: def('employee_name', { compare_with: 'FULL_NAME' }), status: 'DIFFERS' }), 'bad');
    for (const k of ['address', 'employer_name', 'position']) {
        assert.equal(fieldTone({ def: def(k), status: 'DIFFERS' }), 'check', k);
    }
});

test('expired and wrong format are problems; hard to read is a look; the rest is neutral or good', () => {
    assert.equal(fieldTone({ def: def('expiry_date'), status: null, expired: true }), 'bad');
    assert.equal(fieldTone({ def: def('issue_date'), status: null, invalid: true }), 'bad');
    assert.equal(fieldTone({ def: def('position'), status: 'MATCH', lowConfidence: true }), 'check');
    assert.equal(fieldTone({ def: def('employee_tin'), status: 'NOT_ON_DOCUMENT' }), 'neutral');
    assert.equal(fieldTone({ def: def('employee_tin'), status: 'NOT_IN_APPLICATION' }), 'neutral');
    assert.equal(fieldTone({ def: def('employee_tin'), status: 'MATCH' }), 'good');
    assert.equal(worst(['good', 'check', 'neutral']), 'check');
    assert.equal(worst(['check', 'bad']), 'bad');
});

test('the document list flags what the AI found on its own, until the officer confirms', () => {
    const neverExpired = () => false;
    const run = (output, extra = {}) => ({ run: { status: 'DONE', confirmed_at: null, output, ...extra }, fields: [] });
    assert.equal(docHasProblem(run({ document_kind: 'NOT_AN_ID' }), neverExpired), true);
    assert.equal(docHasProblem(run({ issues: [{ text: 'Looks edited', severity: 'MAJOR' }] }), neverExpired), true);
    assert.equal(docHasProblem(run({ issues: [{ text: 'Typo', severity: 'MINOR' }] }), neverExpired), false);
    assert.equal(docHasProblem(run({ document_kind: 'NOT_AN_ID' }, { confirmed_at: '2026-11-22' }), neverExpired), false);
    assert.equal(docHasProblem({ run: { status: 'RUNNING' } }, neverExpired), false);
    const expired = { ...run({}), fields: [{ field_key: 'expiry_date', extracted_value: '2020-01-01' }] };
    assert.equal(docHasProblem(expired, (v) => v === '2020-01-01'), true);
    assert.equal(docHasProblem(undefined, neverExpired), false);
});

const req = (...types) => types.map((requirement_type) => ({ requirement_type }));
const parties = [
    { id: 1, role: 'PRINCIPAL', application_requirements: req('VALID_ID_PASSPORT', 'COE_ITR', 'PAYSLIPS_REMITTANCES', 'FS_BANK_STATEMENTS') },
    { id: 2, role: 'SPOUSE', application_requirements: req('VALID_ID_PASSPORT', 'SEC_DTI_MAYORS_PERMIT') },
    { id: 3, role: 'CO_BORROWER', party_no: 1, application_requirements: req('VALID_ID_PASSPORT') },
    { id: 4, role: 'CO_BORROWER', party_no: 2, application_requirements: req('VALID_ID_PASSPORT', 'COE_ITR') },
    { id: 5, role: 'ATTORNEY_IN_FACT', application_requirements: req('VALID_ID_PASSPORT', 'SPA') },
];
const picked = (ask) => ask.items.map((i) => `${i.applicant_id}:${i.requirement_type}`);

test('each KYC section ticks the documents that back it, for that person only', () => {
    assert.deepEqual(picked(kycFileRequest('principalInfo', parties, 'Principal Borrower')), ['1:VALID_ID_PASSPORT']);
    assert.deepEqual(picked(kycFileRequest('principalEmployment', parties, 'Employment')), ['1:COE_ITR', '1:PAYSLIPS_REMITTANCES']);
    assert.deepEqual(picked(kycFileRequest('spouse', parties, 'Spouse')), ['2:VALID_ID_PASSPORT', '2:SEC_DTI_MAYORS_PERMIT']);
    assert.deepEqual(picked(kycFileRequest('coBorrower-2', parties, 'Co-borrower 2')), ['4:VALID_ID_PASSPORT', '4:COE_ITR']);
    assert.deepEqual(picked(kycFileRequest('obligations', parties, 'Financial Obligations')), ['1:FS_BANK_STATEMENTS']);
    assert.deepEqual(picked(kycFileRequest('mortgagor', parties, 'Mortgagor / Attorney-in-Fact')), ['5:VALID_ID_PASSPORT', '5:SPA']);
});

test('a section with no checklist document gets one empty Other line; Documents ticks what is missing', () => {
    for (const key of ['principalAddress', 'loan', 'references', 'collateral']) {
        const ask = kycFileRequest(key, parties, 'X');
        assert.deepEqual(ask.items, [], key);
        assert.equal(ask.blankOtherFor, 1, key);
    }
    const docs = kycFileRequest('documents', parties, 'Documents');
    assert.deepEqual(docs.items, []);
    assert.equal(docs.blankOtherFor, undefined);
});

test('it is a file request, and the message never carries the AO\'s remark', () => {
    const ask = kycFileRequest('principalInfo', parties, 'Principal Borrower');
    assert.equal(ask.kind, 'file');
    assert.match(ask.note, /copy of the document\(s\) below for the Principal Borrower part/);
    assert.equal('remark' in ask, false);
    assert.match(ask.from, /Needs clarification/);
});
