// Values typed by hand (item 14): the page's limits match the migration, starting labels, what counts as a change.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    LIMITS, MANUAL_TYPES, STARTING_LABELS, filledRows, rowsProblem, sameAsSaved, savesByDocument, startingRows,
} from '../src/pages/documentCheck/manualValues.js';

const sql = readFileSync(new URL('../supabase/migrations/20261123_manual_document_values.sql', import.meta.url), 'utf8');

test('the file types and limits are the same as in the migration', () => {
    assert.match(sql, new RegExp(`array\\[${MANUAL_TYPES.map((t) => `'${t}'`).join(', ')}\\]`));
    assert.match(sql, new RegExp(`jsonb_array_length\\(p_entries\\) > ${LIMITS.rows}`));
    assert.match(sql, new RegExp(`length\\(v_label\\) > ${LIMITS.label}`));
    assert.match(sql, new RegExp(`length\\(v_value\\) > ${LIMITS.value}`));
});

test('starting labels: SPA and SEC get suggestions, Other one blank row; a saved file starts from its save', () => {
    assert.equal(startingRows('SPA', null)[0].label, 'Principal (grantor)');
    assert.equal(startingRows('SEC_DTI_MAYORS_PERMIT', null).length, STARTING_LABELS.SEC_DTI_MAYORS_PERMIT.length);
    assert.deepEqual(startingRows('OTHER', null), [{ label: '', value: '' }]);
    assert.ok(startingRows('SPA', null).every((r) => r.value === ''));
    const latest = { entries: [{ label: 'Business name', value: 'ABC Trading' }] };
    assert.deepEqual(startingRows('SPA', latest), [{ label: 'Business name', value: 'ABC Trading' }]);
});

test('empty rows are left out; the same wording as the database for each problem', () => {
    const rows = [{ label: 'Name', value: 'A' }, { label: ' ', value: '' }, { label: 'Issued', value: '' }];
    assert.equal(filledRows(rows).length, 2);
    assert.equal(rowsProblem(filledRows(rows)), 'Row 2 (Issued) needs a value');
    assert.equal(rowsProblem([{ label: '', value: 'x' }]), 'Row 1 needs a label');
    assert.equal(rowsProblem([{ label: 'x'.repeat(61), value: 'v' }]), 'Row 1: the label is longer than 60 characters');
    assert.equal(rowsProblem([{ label: 'x', value: 'v'.repeat(301) }]), 'Row 1 (x): the value is longer than 300 characters');
    assert.equal(rowsProblem([{ label: 'Name', value: 'a' }, { label: 'name ', value: 'b' }]), 'The label "name" is there twice');
    assert.equal(rowsProblem(Array.from({ length: 31 }, (_, i) => ({ label: `L${i}`, value: 'v' }))), 'At most 30 rows');
    assert.equal(rowsProblem([{ label: 'Name', value: 'A' }]), null);
});

test('nothing to save when the trimmed rows equal the latest save', () => {
    const latest = { entries: [{ label: 'Name', value: 'A' }] };
    assert.equal(sameAsSaved([{ label: ' Name ', value: 'A ' }], latest), true);
    assert.equal(sameAsSaved([{ label: 'Name', value: 'B' }], latest), false);
    assert.equal(sameAsSaved([], null), true);
    assert.equal(sameAsSaved([], latest), false);
});

test('saves are grouped per file, newest first', () => {
    const by = savesByDocument([{ id: 1, document_id: 7 }, { id: 3, document_id: 7 }, { id: 2, document_id: 9 }]);
    assert.deepEqual(by[7].map((s) => s.id), [3, 1]);
    assert.deepEqual(by[9].map((s) => s.id), [2]);
});
