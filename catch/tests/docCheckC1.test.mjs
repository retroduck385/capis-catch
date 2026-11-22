// Part C1: severity colours on the AI check (item 12). Run: npm test
// (KYC "Request a file", item 15, was replaced by the KYC clarification thread: tests/kycClarify.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differsTone, docHasProblem, fieldTone, worst } from '../src/pages/documentCheck/severity.js';

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
