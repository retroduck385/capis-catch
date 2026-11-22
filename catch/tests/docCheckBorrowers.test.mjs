// Document check on the spouse's and co-borrowers' files (fix/doccheck-coborrowers). Run: npm test
//   - "Check on the document": notes with a severity get the Major / Minor tag, old plain-text notes still show
//   - "Needs a new copy": a mark saved before a failed request refreshes File status and says the mark is saved
//   - switching borrower leaves "Earlier versions"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIssues } from '../src/pages/documentCheck/issues.js';
import { docHasProblem } from '../src/pages/documentCheck/severity.js';
import { saveNewCopy, sendFailedText } from '../src/pages/documentRequests/newCopySave.js';
import { PARTY_SWITCH_RESET, showsEarlier } from '../src/pages/documentCheck/partySwitch.js';

const neverExpired = () => false;
const runWith = (issues) => ({ run: { status: 'DONE', confirmed_at: null, output: { document_kind: 'PAYSLIP', issues } }, fields: [] });

test('notes as the worker now saves them ({text, severity}) keep their tag, Major first', () => {
    const got = readIssues({ issues: [{ text: 'Name abbreviated', severity: 'MINOR' }, { text: 'October payslip missing', severity: 'MAJOR' }] });
    assert.deepEqual(got, [{ text: 'October payslip missing', severity: 'MAJOR' }, { text: 'Name abbreviated', severity: 'MINOR' }]);
});

test('old plain-text notes still show, without a tag, after the tagged ones', () => {
    const got = readIssues({ issues: ['Old note', { text: 'New note', severity: 'MAJOR' }, '  ', { text: 'Odd', severity: null }] });
    assert.deepEqual(got, [{ text: 'New note', severity: 'MAJOR' }, { text: 'Old note', severity: null }, { text: 'Odd', severity: null }]);
    assert.deepEqual(readIssues(undefined), []);
});

test('the problem dot follows a Major note whoever the borrower is; plain notes never raise it', () => {
    assert.equal(docHasProblem(runWith([{ text: 'Looks edited', severity: 'MAJOR' }]), neverExpired), true);
    assert.equal(docHasProblem(runWith(['Looks edited']), neverExpired), false);
});

// fake database calls for "Needs a new copy"
const calls = () => {
    const log = [];
    return {
        log,
        markFile: async (...a) => { log.push(['mark', ...a]); },
        openRequest: async (...a) => { log.push(['open', ...a]); },
        refused: async () => { log.push(['open-refused']); throw new Error('A request is already waiting for the applicant'); },
        markRefused: async () => { throw new Error('Only the assigned Account Officer or the assigned Credit Officer can mark a file'); },
    };
};
const spouseFile = { documentId: 1001, comment: 'Blurry', applicationId: 7, message: 'Please upload a clear copy.',
    items: [{ applicant_id: 11, requirement_type: 'PAYSLIPS_REMITTANCES' }] };

test('mark and request both go through: File status refreshes once, nothing to report', async () => {
    const c = calls();
    let reloads = 0;
    const r = await saveNewCopy({ ...spouseFile, markFile: c.markFile, openRequest: c.openRequest, onMarked: () => { reloads++; }, send: true });
    assert.deepEqual(r, { marked: true, sent: true, error: null });
    assert.equal(reloads, 1);
    assert.deepEqual(c.log, [['mark', 1001, 'NEEDS_NEW_COPY', 'Blurry'], ['open', 7, 'Please upload a clear copy.', spouseFile.items]]);
});

test('the mark is saved but the request fails: File status still refreshes and the message says the mark is saved', async () => {
    const c = calls();
    let reloads = 0;
    const r = await saveNewCopy({ ...spouseFile, markFile: c.markFile, openRequest: c.refused, onMarked: () => { reloads++; }, send: true });
    assert.equal(r.marked, true);
    assert.equal(r.sent, false);
    assert.equal(reloads, 1, 'File status reloaded right after the mark, before the failed request');
    assert.match(r.error, /^The mark "Needs a new copy" is saved and shows in File status\./);
    assert.match(r.error, /was not sent: A request is already waiting/);
});

test('trying again after a failed send only sends the request (no second mark)', async () => {
    const c = calls();
    let reloads = 0;
    const r = await saveNewCopy({ ...spouseFile, markFile: c.markFile, openRequest: c.openRequest, onMarked: () => { reloads++; }, send: true, alreadyMarked: true });
    assert.deepEqual(r, { marked: true, sent: true, error: null });
    assert.equal(reloads, 0);
    assert.deepEqual(c.log.map((x) => x[0]), ['open']);
});

test('save without asking marks only; a refused mark is reported as it is and nothing refreshes', async () => {
    const c = calls();
    const only = await saveNewCopy({ ...spouseFile, markFile: c.markFile, openRequest: c.openRequest, send: false });
    assert.deepEqual(only, { marked: true, sent: false, error: null });
    assert.deepEqual(c.log.map((x) => x[0]), ['mark']);
    let reloads = 0;
    const refused = await saveNewCopy({ ...spouseFile, markFile: c.markRefused, openRequest: c.openRequest, onMarked: () => { reloads++; }, send: true });
    assert.equal(refused.marked, false);
    assert.match(refused.error, /^Only the assigned/);
    assert.equal(reloads, 0);
    assert.equal(sendFailedText(''), 'The mark "Needs a new copy" is saved and shows in File status. The request to the applicant was not sent.');
});

test('opening another borrower starts on their current files, not "Earlier versions"', () => {
    assert.deepEqual({ ...PARTY_SWITCH_RESET }, { docId: null, focused: null, page: 1, view: 'current', earlierId: null });
    const spouse = { earlier: [{ id: 9 }] };
    assert.equal(showsEarlier('earlier', spouse), true);
    assert.equal(showsEarlier(PARTY_SWITCH_RESET.view, spouse), false, 'after the switch the spouse\'s current files show');
    assert.equal(showsEarlier('earlier', { earlier: [] }), false);
    assert.equal(showsEarlier('earlier', null), false);
});
