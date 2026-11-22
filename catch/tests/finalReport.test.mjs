// Final report: who sees which version, the sign-off rows and the credit score sheet (src/pages/finalReport/signoffs.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignoffs, reportMode, scoreSheet, whenPH } from '../src/pages/finalReport/signoffs.js';

test('reportMode: final once every reviewer endorsed (AO, assigned CO, routed reviewers) or Decided (Approvers); drafts for the CO and reviewers', () => {
    const mode = (stage, role, extra = {}) => reportMode({ stage: stage && { stage }, role, coCanEdit: false, ...extra });
    // Approval = every reviewer endorsed it
    for (const stage of ['APPROVAL', 'DECIDED']) {
        assert.equal(mode(stage, 'ACCOUNT_OFFICER'), 'FINAL', `AO in ${stage}`);
        assert.equal(mode(stage, 'CREDIT_OFFICER', { assigned: true }), 'FINAL', `assigned CO in ${stage}`);
        assert.equal(mode(stage, 'CREDIT_OFFICER'), null, `not the assigned CO in ${stage}`);
        assert.equal(mode(stage, 'REVIEWER', { assigned: true }), 'FINAL', `routed reviewer in ${stage}`);
        assert.equal(mode(stage, 'REVIEWER'), null, `not a routed reviewer in ${stage}`);
    }
    assert.equal(mode('DECIDED', 'APPROVER'), 'FINAL');
    assert.equal(mode('APPROVAL', 'APPROVER'), null);
    for (const role of ['DISPATCH_ADMIN', 'DEPT_HEAD', 'CREDIT_INVESTIGATOR']) {
        assert.equal(mode('DECIDED', role, { assigned: true }), null, `no final report for ${role}`);
    }
    // Before endorsement: AO / Approver none, CO draft while editing, reviewers draft while in Review
    assert.equal(mode('REVIEW', 'ACCOUNT_OFFICER'), null);
    assert.equal(mode('REVIEW', 'REVIEWER', { assigned: true }), 'DRAFT', 'routed reviewer before endorsing');
    assert.equal(mode('REVIEW', 'REVIEWER'), null, 'not routed to this reviewer');
    assert.equal(mode('CREDIT_EVALUATION', 'REVIEWER', { assigned: true }), null, 'returned to the CO');
    assert.equal(mode('CREDIT_EVALUATION', 'CREDIT_OFFICER', { coCanEdit: true }), 'DRAFT');
    assert.equal(mode('CREDIT_EVALUATION', 'CREDIT_OFFICER'), null, 'not the assigned CO');
    assert.equal(mode('REVIEW', 'CREDIT_OFFICER', { coCanEdit: true, assigned: true }), null, 'not while in Review');
    assert.equal(mode(null, 'CREDIT_OFFICER', { coCanEdit: true }), null);
});


const T = (h) => `2026-11-${String(h).padStart(2, '0')}T02:00:00Z`;
const stages = [
    { stage: 'INTAKE', entered_at: T(1), left_at: T(2), stage_status_changes: [
        { status: 'IN_PROGRESS', changed_at: T(1), changed_by: 'ao' }, { status: 'DONE', changed_at: T(2), changed_by: 'ao' }] },
    { stage: 'CREDIT_INVESTIGATION', entered_at: T(2), left_at: T(3), stage_status_changes: [
        { status: 'DONE', changed_at: T(3), changed_by: 'ci' }] },
    { stage: 'CREDIT_EVALUATION', entered_at: T(3), left_at: T(4), stage_status_changes: [
        { status: 'DONE', changed_at: T(4), changed_by: 'co' }] },
    { stage: 'REVIEW', entered_at: T(4), left_at: T(5), stage_status_changes: [] },
    { stage: 'CREDIT_EVALUATION', entered_at: T(5), left_at: T(6), stage_status_changes: [
        { status: 'RETURNED', changed_at: T(5), changed_by: 'rv1' }, { status: 'DONE', changed_at: T(6), changed_by: 'co' }] },
    { stage: 'REVIEW', entered_at: T(6), left_at: T(8), stage_status_changes: [] },
    { stage: 'APPROVAL', entered_at: T(8), left_at: T(9), stage_status_changes: [] },
    { stage: 'DECIDED', entered_at: T(9), left_at: null, stage_status_changes: [] },
];
const rows = [
    { id: 1, assignee_role: 'REVIEWER', user_id: 'rv1', seq: 1 },
    { id: 2, assignee_role: 'APPROVER', user_id: 'ap1', seq: 2 },
];
const reviews = [
    { id: 10, assignment_id: 1, action: 'RETURNED', severity: 'MINOR', remarks: 'Payslip unclear', response: 'Replaced it', decided_at: T(5) },
    { id: 11, assignment_id: 1, action: 'ENDORSED', remarks: 'Fits policy', decided_at: T(7) },
];
const approvals = [{ id: 20, assignment_id: 2, action: 'APPROVED', approval_position: 'PRESIDENT', conditions: 'Insurance first', remarks: null, decided_at: T(9) }];

test('buildSignoffs: every step in order, with who, what and when', () => {
    const s = buildSignoffs({ stages, rows, reviews, approvals, app: { status: 'APPROVED' }, positionLabel: (p) => ({ PRESIDENT: 'President' }[p]) });
    assert.deepEqual(s.map((x) => x.key), ['kyc', 'ci', 'ce-0', 'rv-10', 'ce-1', 'rv-11', 'ap-20', 'outcome']);
    assert.equal(s[0].userId, 'ao');
    assert.equal(s[1].userId, 'ci');
    assert.equal(s[2].action, 'Financial Package and credit result sent for review');
    assert.equal(s[3].action, 'Returned for revision (minor)');
    assert.deepEqual(s[3].details, ['Payslip unclear', "Credit Officer's answer: Replaced it"]);
    assert.equal(s[3].role, 'Reviewer 1');
    assert.equal(s[4].action, 'Resent for review after a return');
    assert.equal(s[5].action, 'Endorsed');
    assert.equal(s[6].role, 'President');
    assert.equal(s[6].action, 'Approved with conditions');
    assert.deepEqual(s[6].details, ['Conditions: Insurance first']);
    assert.equal(s.at(-1).action, 'Approved');
    assert.ok(s.at(-1).outcome);
});

test('buildSignoffs: nothing invented for steps that did not happen', () => {
    const s = buildSignoffs({ stages: stages.slice(0, 1), rows: [], reviews: [], approvals: [], app: { status: 'UNDER_CI' } });
    assert.deepEqual(s.map((x) => x.key), ['kyc']);
    const none = buildSignoffs({ stages: [{ stage: 'INTAKE', entered_at: T(1), left_at: null, stage_status_changes: [] }], app: {} });
    assert.deepEqual(none, []);
    const disapproved = buildSignoffs({ stages: [], rows, approvals: [{ ...approvals[0], action: 'DISAPPROVED', conditions: null, remarks: 'DBR too high' }] });
    assert.equal(disapproved[0].action, 'Disapproved');
    assert.deepEqual(disapproved[0].details, ['Remarks: DBR too high']);
});

test('scoreSheet: all bands per criterion, the picked one, sub-totals and maximum per category', () => {
    const rules = {
        criteria: [{ code: 'DBR', category: 'CAPACITY', label: 'DBR' }, { code: 'NDI', category: 'CAPACITY', label: 'NDI' },
            { code: 'AGE', category: 'CONDITION', label: 'Age' }],
        bands: [
            { criterion: 'DBR', code: 'LOW', label: 'Below 26%', points: 8, sort_order: 1 },
            { criterion: 'DBR', code: 'HIGH', label: '> 40%', points: 0, sort_order: 2 },
            { criterion: 'NDI', code: 'TOP', label: 'More than ₱100,000.00', points: 6, sort_order: 1 },
            { criterion: 'AGE', code: 'MID', label: '25 - 35', points: 6, sort_order: 1 },
        ],
    };
    const entries = [{ criterion: 'DBR', band: 'LOW', remarks: 'From the FP' }];
    const sheet = scoreSheet(rules, entries, [{ value: 'CAPACITY', label: '1. Capacity' }, { value: 'CONDITION', label: '4. Condition' }]);
    assert.equal(sheet[0].criteria.length, 2);
    assert.equal(sheet[0].criteria[0].bands.length, 2);
    assert.equal(sheet[0].criteria[0].picked.code, 'LOW');
    assert.equal(sheet[0].criteria[0].remarks, 'From the FP');
    assert.equal(sheet[0].criteria[1].points, null, 'not scored');
    assert.equal(sheet[0].subtotal, 8);
    assert.equal(sheet[0].max, 14);
    assert.equal(sheet[1].subtotal, 0);
});

test('whenPH: Philippine time whatever the computer says', () => {
    assert.match(whenPH('2026-11-20T01:02:00Z'), /Nov 20, 2026.*9:02/);
    assert.equal(whenPH(null), null);
});
