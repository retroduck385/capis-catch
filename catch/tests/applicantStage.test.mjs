// What the applicant sees: the stage in plain words, an outcome only once the AO's notice is sent (the database's
// visible_status), and "Documents needed" / "Documents sent" while a request is open. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    APPLICANT_STAGES, applicantLabel, applicantStageIndex, shownOutcome,
} from '../src/pages/notifications/applicantStatus.js';

test('the five steps, in order', () => {
    assert.deepEqual(APPLICANT_STAGES, ['Received', 'Background check', 'Evaluation', 'Review', 'Final approval']);
});

test('each internal status shows its plain stage name', () => {
    const shown = Object.fromEntries(['SUBMITTED', 'UNDER_CI', 'UNDER_CREDIT_EVALUATION', 'UNDER_REVIEW', 'FOR_APPROVAL']
        .map((s) => [s, applicantLabel(s, 'UNDER_REVIEW')]));
    assert.deepEqual(shown, {
        SUBMITTED: 'Received', UNDER_CI: 'Background check', UNDER_CREDIT_EVALUATION: 'Evaluation',
        UNDER_REVIEW: 'Review', FOR_APPROVAL: 'Final approval',
    });
});

test('a decision never shows before the notice: Final approval', () => {
    for (const s of ['APPROVED', 'REJECTED', 'DEFERRED']) {
        assert.equal(applicantLabel(s, 'UNDER_REVIEW'), 'Final approval', `${s}, notice not sent`);
        assert.equal(applicantLabel(s, null), 'Final approval', `${s}, still loading`);
        assert.equal(applicantStageIndex(s), 4);
    }
});

test('after the notice: the outcome', () => {
    assert.equal(applicantLabel('APPROVED', 'APPROVED'), 'Approved');
    assert.equal(applicantLabel('REJECTED', 'REJECTED'), 'Rejected');
    assert.equal(applicantLabel('DEFERRED', 'DEFERRED'), 'Deferred');
    assert.equal(shownOutcome('UNDER_REVIEW'), null);
});

test('an open document request wins over the stage', () => {
    assert.equal(applicantLabel('UNDER_CREDIT_EVALUATION', 'DOCUMENTS_NEEDED'), 'Documents needed');
    assert.equal(applicantLabel('UNDER_REVIEW', 'DOCUMENTS_SENT'), 'Documents sent');
});

test('a reviewer return shows Evaluation again (accurate)', () => {
    assert.equal(applicantLabel('UNDER_CREDIT_EVALUATION', 'UNDER_REVIEW'), 'Evaluation');
});

test('off the track: Draft, Incomplete submission, unknown values', () => {
    assert.equal(applicantLabel('DRAFT', 'DRAFT'), 'Draft');
    assert.equal(applicantLabel('FOR_CLARIFICATION', 'INCOMPLETE'), 'Incomplete submission');
    assert.equal(applicantLabel('SOMETHING_NEW', null), 'In progress');
    assert.equal(applicantLabel('toString', null), 'In progress');
    assert.equal(applicantStageIndex('DRAFT'), null);
    assert.equal(applicantStageIndex('FOR_CLARIFICATION'), null);
    assert.equal(applicantStageIndex('constructor'), null);
});

test('no internal name is ever shown', () => {
    const internal = /UNDER_|CREDIT_|FOR_|INTAKE|INVESTIGATION|_/;
    for (const s of ['SUBMITTED', 'FOR_CLARIFICATION', 'UNDER_CI', 'UNDER_CREDIT_EVALUATION', 'DEFERRED', 'UNDER_REVIEW',
        'FOR_APPROVAL', 'APPROVED', 'REJECTED']) {
        assert.doesNotMatch(applicantLabel(s, null), internal, s);
    }
});
