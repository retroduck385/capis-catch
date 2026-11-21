// Part D: credit result boxes (item 31), score history lines (item 32), where to fix a return (item 33). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    fieldsToRemove, shownFields, undoResultFor, withHiddenCleared,
} from '../src/pages/financialPackage/creditResultFields.js';
import { scoreHistory } from '../src/pages/financialPackage/scoreHistory.js';
import { returnTargets } from '../src/pages/review/returnTargets.js';

test('each result shows only its boxes', () => {
    assert.deepEqual(shownFields(''), []);
    assert.deepEqual(shownFields(null), []);
    assert.deepEqual(shownFields('ENDORSED'), ['justification', 'amendment', 'waiver_and_acceptance']);
    assert.deepEqual(shownFields('NOT_ENDORSED'), ['justification', 'amendment', 'waiver_and_acceptance']);
    assert.deepEqual(shownFields('DEFERRED'), ['justification', 'amendment', 'waiver_and_acceptance', 'deferrals']);
});

test('a box the chosen result hides is emptied on save, with an Undo back to Deferred', () => {
    const pkg = { credit_result: 'ENDORSED', justification: 'Good', amendment: '', waiver_and_acceptance: 'W', deferrals: 'Need ITR' };
    assert.deepEqual(fieldsToRemove(pkg), ['deferrals']);
    assert.equal(undoResultFor(pkg), 'DEFERRED');
    const saved = withHiddenCleared(pkg);
    assert.equal(saved.deferrals, '');
    assert.equal(saved.waiver_and_acceptance, 'W');
    assert.equal(saved.justification, 'Good');
    assert.equal(pkg.deferrals, 'Need ITR', 'the form itself is not changed');
});

test('nothing is removed for Deferred, for blank boxes, or while no result is chosen', () => {
    assert.deepEqual(fieldsToRemove({ credit_result: 'DEFERRED', deferrals: 'x', justification: 'y' }), []);
    assert.deepEqual(fieldsToRemove({ credit_result: 'ENDORSED', deferrals: '   ' }), []);
    const none = { credit_result: '', justification: 'kept', deferrals: 'kept' };
    assert.deepEqual(fieldsToRemove(none), []);
    assert.deepEqual(withHiddenCleared(none), none);
    assert.equal(undoResultFor(none), null);
});

const rules = {
    criteria: [{ code: 'DBR', label: 'Debt to Income Ratio' }, { code: 'AGE', label: 'Age' }],
    bands: [
        { criterion: 'DBR', code: 'LOW', label: 'Below 26%', points: 8 },
        { criterion: 'DBR', code: 'MID', label: '26-35%', points: 6 },
        { criterion: 'AGE', code: 'A1', label: '25-45', points: 1 },
    ],
};

test('score history: band names and points, newest first, the criterion found for an update', () => {
    const audit = [
        { id: 1, row_id: 10, action: 'INSERT', new_data: { id: 10, criterion: 'DBR', band: 'MID', remarks: '' }, changed_by: 'u', changed_at: 't1' },
        { id: 2, row_id: 10, action: 'UPDATE', old_data: { band: 'MID', suggested_band: 'MID' }, new_data: { band: 'LOW', suggested_band: 'LOW' }, changed_by: 'u', changed_at: 't2' },
        { id: 3, row_id: 10, action: 'UPDATE', old_data: { remarks: '' }, new_data: { remarks: 'Payslips confirm it' }, changed_by: 'u', changed_at: 't3' },
        { id: 4, row_id: 10, action: 'UPDATE', old_data: { suggested_band: 'LOW' }, new_data: { suggested_band: 'MID' }, changed_by: 'u', changed_at: 't4' },
        { id: 5, row_id: 11, action: 'DELETE', old_data: { id: 11, criterion: 'AGE', band: 'A1' }, changed_by: 'u', changed_at: 't5' },
    ];
    const lines = scoreHistory(audit, rules);
    assert.deepEqual(lines.map((l) => l.id), [5, 3, 2, 1], 'newest first; a suggestion-only change is left out');
    assert.equal(lines[0].text, 'Age: score cleared (was 25-45 (1 pt))');
    assert.equal(lines[1].text, 'Debt to Income Ratio: remarks changed');
    assert.equal(lines[1].remarks, 'Payslips confirm it');
    assert.equal(lines[2].text, 'Debt to Income Ratio: 26-35% (6 pts) → Below 26% (8 pts)');
    assert.equal(lines[3].text, 'Debt to Income Ratio: scored 26-35% (6 pts)');
});

test('score history: an update without its insert in the log takes the criterion from the saved scores', () => {
    const audit = [{ id: 9, row_id: 42, action: 'UPDATE', old_data: { band: 'MID' }, new_data: { band: 'LOW' }, changed_by: 'u', changed_at: 't' }];
    assert.equal(scoreHistory(audit, rules, [{ id: 42, criterion: 'DBR' }])[0].text, 'Debt to Income Ratio: 26-35% (6 pts) → Below 26% (8 pts)');
    assert.match(scoreHistory(audit, rules, [])[0].text, /^A criterion:/);
});

test('where to fix a return: only Needs revision items, with their section; documents are the AO\'s', () => {
    const sources = {
        INCOME: { there: { path: '/financialPackagePage', hash: 'fp-ix', label: 'FP IX. Cash flow' } },
        CREDIT_SCORE: { there: { path: '/creditScorePage', label: 'Credit scoring' } },
        DOCUMENTS: { there: { path: '/loanFolderPage', label: 'Loan folder' } },
    };
    const checkItems = [{ code: 'INCOME', label: 'Income' }, { code: 'CREDIT_SCORE', label: 'Credit score' }, { code: 'DOCUMENTS', label: 'Documents' }];
    const decision = { review_decision_items: [
        { item_code: 'INCOME', result: 'NEEDS_REVISION', remark: 'Use 90%' },
        { item_code: 'CREDIT_SCORE', result: 'OK', remark: null },
        { item_code: 'DOCUMENTS', result: 'NEEDS_REVISION', remark: '' },
        { item_code: 'NEW_ITEM', result: 'NEEDS_REVISION', remark: null },
    ] };
    const t = returnTargets(decision, checkItems, sources);
    assert.deepEqual(t.map((x) => x.code), ['INCOME', 'DOCUMENTS', 'NEW_ITEM']);
    assert.deepEqual(t[0], { code: 'INCOME', label: 'Income', remark: 'Use 90%', path: '/financialPackagePage', hash: 'fp-ix', place: 'FP IX. Cash flow', canFix: true });
    assert.equal(t[1].canFix, false);
    assert.equal(t[1].remark, null);
    assert.equal(t[2].path, null, 'an item with no known place gets no button');
    assert.deepEqual(returnTargets(null, checkItems, sources), []);
});

test('every reviewer checklist item has a place to go (CHECK_SOURCES)', () => {
    const src = readFileSync(new URL('../src/pages/review/reviewChecks.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const CHECK_SOURCES'));
    for (const code of ['DOCUMENTS', 'INCOME', 'LOAN_TERMS', 'COLLATERAL', 'CREDIT_CHECKS', 'EXCEPTIONS', 'CREDIT_SCORE', 'TERMS', 'RECOMMENDATION']) {
        assert.match(block, new RegExp(`\\b${code}: \\{[\\s\\S]*?there: \\{ path: '/`), code);
    }
});
