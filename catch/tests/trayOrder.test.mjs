// Work tray order: most urgent first, and the "TAT position" column = place in that order. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byUrgency, positionHint, urgencyRanks } from '../src/pages/workTray/options.js';

// rows arrive in submission order (FIFO), like fetchWorkTray()
const row = (id, tat_state, days, limit) => ({ application_id: id, tat_state, days_in_stage: days, tat_days: limit });
const rows = [
    row(1, 'ON_TRACK', 1, 10),   // 10%
    row(2, null, 0, null),       // Decided: no TAT
    row(3, 'NEAR', 8, 10),       // 80%
    row(4, 'BEYOND', 11, 10),    // 110%
    row(5, 'BEYOND', 30, 10),    // 300%
    row(6, 'ON_TRACK', 6, 10),   // 60%
    row(7, 'NEAR', 9, 10),       // 90%
    row(8, 'ON_TRACK', 6, 10),   // 60%, same as 6: keeps arrival order
    row(9, null, 0, null),
];
const ids = (list) => list.map((r) => r.application_id);

test('beyond, near, on track, then no TAT; inside each the largest share of the target first', () => {
    assert.deepEqual(ids([...rows].sort(byUrgency)), [5, 4, 7, 3, 6, 8, 1, 2, 9]);
});

test('equal files and files without a TAT keep their arrival order', () => {
    const sorted = ids([...rows].sort(byUrgency));
    assert.ok(sorted.indexOf(6) < sorted.indexOf(8));
    assert.ok(sorted.indexOf(2) < sorted.indexOf(9));
});

test('the share is per stage target (a short stage can be more urgent than a long one)', () => {
    assert.deepEqual(ids([row(1, 'NEAR', 8, 10), row(2, 'NEAR', 2.5, 3)].sort(byUrgency)), [2, 1]);
});

test('missing numbers never break the order', () => {
    assert.doesNotThrow(() => [row(1, 'NEAR', null, 0), row(2, 'NEAR', '4', '5')].sort(byUrgency));
    assert.deepEqual(ids([row(1, 'NEAR', null, 0), row(2, 'NEAR', '4', '5')].sort(byUrgency)), [2, 1]);
});

test('ranks number every file the user can see by urgency, 1 = most urgent', () => {
    const ranks = urgencyRanks(rows);
    assert.equal(ranks.get(5), 1);
    assert.equal(ranks.get(4), 2);
    assert.equal(ranks.get(9), 9);
    assert.equal(rows[0].application_id, 1, 'the rows themselves are not reordered');
});

test('the hover gives the rank and the order of arrival', () => {
    assert.equal(positionHint(1, 5, 9), 'Position 1 of 9 by urgency (1 = most urgent).\nArrived 5th (order of submission).');
    assert.match(positionHint(2, 1, 9), /Arrived 1st/);
    assert.match(positionHint(2, 2, 9), /Arrived 2nd/);
    assert.match(positionHint(2, 3, 9), /Arrived 3rd/);
    assert.match(positionHint(2, 11, 20), /Arrived 11th/);
    assert.match(positionHint(2, 22, 30), /Arrived 22nd/);
});
