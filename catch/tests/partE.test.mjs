// Part E: "Doesn't endorse" is sent as a Major return (item 34); a reviewer starts from their OK items after a return
// (item 35). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotEndorsedReturn, seedFromReturn, toSubmission } from '../src/pages/review/reviewSubmit.js';

const items = [{ code: 'INCOME' }, { code: 'TERMS' }, { code: 'RECOMMENDATION' }];
const form = (action, checks, remarks = 'Income not proven', severity = '') => ({ action, remarks, severity, checks });
const blank = { result: '', remark: '' };

test('Endorse and Return are sent as they are', () => {
    const f = form('ENDORSED', { INCOME: { result: 'OK', remark: '' }, TERMS: { result: 'OK', remark: ' fine ' }, RECOMMENDATION: { result: 'OK', remark: '' } }, ' Good ');
    assert.deepEqual(toSubmission(f, items), {
        action: 'ENDORSED', remarks: 'Good', severity: null,
        items: [{ code: 'INCOME', result: 'OK', remark: null }, { code: 'TERMS', result: 'OK', remark: 'fine' }, { code: 'RECOMMENDATION', result: 'OK', remark: null }],
    });
    const r = form('RETURNED', { INCOME: { result: 'NEEDS_REVISION', remark: 'Use 90%' }, TERMS: blank, RECOMMENDATION: blank }, 'Fix income', 'MINOR');
    assert.deepEqual(toSubmission(r, items), {
        action: 'RETURNED', remarks: 'Fix income', severity: 'MINOR', items: [{ code: 'INCOME', result: 'NEEDS_REVISION', remark: 'Use 90%' }],
    });
});

test('Doesn\'t endorse goes back as a Major return with "Not endorsed: " and Recommendation marked', () => {
    const f = form('NOT_ENDORSED', { INCOME: { result: 'OK', remark: '' }, TERMS: { result: 'OK', remark: '' }, RECOMMENDATION: { result: 'OK', remark: '' } });
    const s = toSubmission(f, items);
    assert.equal(s.action, 'RETURNED');
    assert.equal(s.severity, 'MAJOR');
    assert.equal(s.remarks, 'Not endorsed: Income not proven');
    assert.deepEqual(s.items.find((i) => i.code === 'RECOMMENDATION'), { code: 'RECOMMENDATION', result: 'NEEDS_REVISION', remark: 'Income not proven' });
    assert.equal(s.items.filter((i) => i.code === 'RECOMMENDATION').length, 1);
    assert.ok(s.items.some((i) => i.code === 'INCOME' && i.result === 'OK'), 'the other items are kept');
});

test('the reviewer\'s own Recommendation remark is kept; other flagged items stay flagged', () => {
    const f = form('NOT_ENDORSED', {
        INCOME: { result: 'NEEDS_REVISION', remark: 'Payslips missing' }, TERMS: blank,
        RECOMMENDATION: { result: 'NEEDS_REVISION', remark: 'Recommendation not supported' },
    });
    const s = toSubmission(f, items);
    assert.equal(s.items.find((i) => i.code === 'RECOMMENDATION').remark, 'Recommendation not supported');
    assert.deepEqual(s.items.find((i) => i.code === 'INCOME'), { code: 'INCOME', result: 'NEEDS_REVISION', remark: 'Payslips missing' });
    assert.ok(isNotEndorsedReturn({ action: 'RETURNED', remarks: s.remarks }));
    assert.ok(!isNotEndorsedReturn({ action: 'RETURNED', remarks: 'Fix income' }));
});

test('after a return the reviewer starts from their OK items; Needs revision items and the decision are blank', () => {
    const decision = { action: 'RETURNED', remarks: 'Fix income', review_decision_items: [
        { item_code: 'INCOME', result: 'NEEDS_REVISION', remark: 'Use 90%' },
        { item_code: 'TERMS', result: 'OK', remark: 'fine' },
        { item_code: 'COLLATERAL', result: 'OK', remark: null },
    ] };
    assert.deepEqual(seedFromReturn(decision), {
        checks: { TERMS: { result: 'OK', remark: 'fine' }, COLLATERAL: { result: 'OK', remark: '' } },
        action: '', remarks: '', severity: '',
    });
    assert.equal(seedFromReturn({ action: 'ENDORSED', review_decision_items: [] }), null);
    assert.equal(seedFromReturn({ action: 'RETURNED', review_decision_items: [{ item_code: 'INCOME', result: 'NEEDS_REVISION' }] }), null);
    assert.equal(seedFromReturn(null), null);
});
