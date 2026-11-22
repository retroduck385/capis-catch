// CI facts rows (src/pages/ciRequest/ciFactRows.js): drafts <-> payloads for save_ci_card (20261126_ci_facts.sql).
// Synthetic values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiToForm, rowProblems, rowsDirty, rowSummary, toDraft, toPayload, tuStatusOf } from '../src/pages/ciRequest/ciFactRows.js';

const savedCard = {
    id: 7, applicant_id: 3, record_type: 'CANCELLED_CARD', institution: 'Sample Bank', date_reported: '2021-03-15',
    date_closed: null, outstanding_balance: 18500, settlement: 'UNPAID', full_payment_doc_id: null, returned_checks: null,
    case_type: null, case_reference: null, amount_involved: null, case_status: null, remarks: null, extraction_run_id: null,
};
const savedAccount = {
    id: 11, applicant_id: 3, is_open: true, lender_type: 'BANK', lender_name: 'Sample Bank', account_type: 'CREDIT CARD',
    ownership: 'INDIVIDUAL', status: 'CURRENT', opened_on: '2019-06-01', closed_on: null, maturity_on: null,
    original_amount: null, credit_limit: 80000, balance: 12000.5, past_due: 0, installment: 2500, max_dpd: 0,
    legal_action: false, extraction_run_id: null,
};

test('a saved row goes back to the same payload (no false "unsaved changes")', () => {
    assert.equal(rowsDirty('NFIS', [toDraft('NFIS', savedCard)], [savedCard]), false);
    assert.equal(rowsDirty('TU', [toDraft('TU', savedAccount)], [savedAccount]), false);
    const [p] = toPayload('TU', [toDraft('TU', savedAccount)]);
    assert.equal(p.id, 11);
    assert.equal(p.is_open, true);
    assert.equal(p.legal_action, false);
    assert.equal(p.balance, 12000.5);
    assert.equal(p.max_dpd, 0);
    assert.equal('applicant_id' in p, false);
    assert.equal('extraction_run_id' in p, false);
});

test('editing, adding or removing a row is a change', () => {
    const edited = { ...toDraft('NFIS', savedCard), settlement: 'FULLY_PAID' };
    assert.equal(rowsDirty('NFIS', [edited], [savedCard]), true);
    assert.equal(rowsDirty('NFIS', [toDraft('NFIS', savedCard), toDraft('NFIS')], [savedCard]), true);
    assert.equal(rowsDirty('NFIS', [], [savedCard]), true);
});

test('a new row has no id, and empty inputs are sent as null', () => {
    const [p] = toPayload('NFIS', [{ ...toDraft('NFIS'), record_type: 'COURT_CASE', date_reported: '2020-01-02' }]);
    assert.equal('id' in p, false);
    assert.equal(p.case_type, null);
    assert.equal(p.institution, null);
});

test('fields hidden for the kind of record are sent empty (no stale values)', () => {
    // a court case typed as a cancelled card first: balance and settlement must not stay on it
    const draft = { ...toDraft('NFIS', savedCard), record_type: 'COURT_CASE', case_type: 'BP22', amount_involved: '45,000' };
    const [p] = toPayload('NFIS', [draft]);
    assert.equal(p.outstanding_balance, null);
    assert.equal(p.settlement, null);
    assert.equal(p.case_type, 'BP22');
    assert.equal(p.amount_involved, 45000);
    // and the other way: case fields go when it is no longer a court case
    const back = toPayload('NFIS', [{ ...draft, record_type: 'ADVERSE_LOAN' }])[0];
    assert.equal(back.case_type, null);
    assert.equal(back.amount_involved, null);
    // closed date only on closed TU accounts
    const open = toPayload('TU', [{ ...toDraft('TU', savedAccount), closed_on: '2024-01-01' }])[0];
    assert.equal(open.closed_on, null);
});

test('bad numbers are caught before saving, named by row', () => {
    const rows = [toDraft('TU', savedAccount), { ...toDraft('TU', savedAccount), id: null, max_dpd: '2.5', balance: '-3' }];
    const problems = rowProblems('TU', rows);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /^Account 2: /);
    assert.deepEqual(rowProblems('TU', [toDraft('TU', savedAccount)]), []);
});

test('the one-line summary reads like the report', () => {
    const s = rowSummary('NFIS', savedCard);
    assert.match(s, /Cancelled credit card/);
    assert.match(s, /Sample Bank/);
    assert.match(s, /Unpaid/);
    assert.match(rowSummary('TU', { ...savedAccount, max_dpd: 45, past_due: 3000 }), /max 45 days late/);
    assert.match(rowSummary('TU', toDraft('TU')), /^New account$/);
});

// ---------- Run AI: what the AI read goes into the same boxes ----------
const f = (field_key, extracted_value, item_no = 0) => ({ field_key, extracted_value, item_no });

test('the AI fills the TU boxes: report date, result, summary and one row per account', () => {
    const check = {
        run: { id: 5, output: { proposed_result: 'WITH_FINDINGS', findings_summary: ' One card 45 days late. ' } },
        fields: [
            f('report_date', '2026-10-30'), f('score', '612'),
            f('acct_section', 'OPEN', 1), f('acct_type', 'CREDIT CARD', 1), f('acct_lender', 'BANK', 1),
            f('acct_status', 'A', 1), f('acct_opened', '2019-06-01', 1), f('acct_balance', '12,000.50', 1),
            f('acct_past_due', '3000', 1), f('acct_max_dpd', '45', 1), f('acct_legal_action', 'N', 1),
            f('acct_section', 'CLOSED ACCOUNTS', 2), f('acct_type', 'AUTO LOAN', 2), f('acct_closed', '03/2024', 2),
            f('acct_balance', 'n/a', 2),
            f('inq_member', 'SAMPLE', 1),
        ],
    };
    const form = aiToForm('TU', check);
    assert.equal(form.result, 'WITH_FINDINGS');
    assert.equal(form.summary, 'One card 45 days late.');
    assert.equal(form.report_date, '2026-10-30');
    assert.equal(form.rows.length, 2);
    const [a, b] = form.rows;
    assert.equal(a._fromAi, true);
    assert.equal(a.is_open, 'true');
    assert.equal(a.status, 'CURRENT');
    assert.equal(a.balance, '12000.5');
    assert.equal(a.max_dpd, '45');
    assert.equal(a.legal_action, 'false');
    assert.equal(b.is_open, 'false');
    assert.equal(b.status, 'CLOSED');
    assert.equal(b.closed_on, '');      // not a YYYY-MM-DD date: left for the CI
    assert.equal(b.balance, '');        // not a number: left for the CI
    // a row the AI filled is sent with from_ai (save_ci_card tags it with the run)
    const [p] = toPayload('TU', [a]);
    assert.equal(p.from_ai, true);
    assert.equal('id' in p, false);
});

test('the AI fills the NFIS result, summary and date; it does not list records yet', () => {
    const form = aiToForm('NFIS', {
        run: { id: 9, output: { proposed_result: 'NO_ADVERSE_FINDINGS', findings_summary: 'No adverse findings.' } },
        fields: [f('result_text', 'No Adverse Findings'), f('date_reported', '2026-11-02')],
    });
    assert.deepEqual(form, { result: 'NO_ADVERSE_FINDINGS', summary: 'No adverse findings.', report_date: '2026-11-02', rows: [] });
    // nothing read yet: empty boxes, no crash
    assert.deepEqual(aiToForm('TU', null), { result: null, summary: '', report_date: '', rows: [] });
    assert.equal(aiToForm('NFIS', { run: { output: { proposed_result: 'MAYBE' } }, fields: [] }).result, null);
});

test('TU statuses as printed map to the list', () => {
    assert.equal(tuStatusOf('WRITTEN OFF'), 'WRITTEN_OFF');
    assert.equal(tuStatusOf('Restructured'), 'RESTRUCTURED');
    assert.equal(tuStatusOf('PAST DUE'), 'PAST_DUE');
    assert.equal(tuStatusOf('', 'false'), 'CLOSED');
    assert.equal(tuStatusOf('X9'), '');
});
