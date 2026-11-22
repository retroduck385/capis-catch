// "Ask the applicant" prefill (src/pages/documentRequests/askOnce.js): one click fills the request box once.
// Round 2 item 12: a remount or reload ran the prefill again and replaced what the AO had typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAskUsed, markAskUsed, withoutAsk } from '../src/pages/documentRequests/askOnce.js';

test('a click is new until it has filled the box, then it is used for good', () => {
    const click = { at: 1700000000001, note: 'Please upload a new, clear and complete copy.' };
    assert.equal(isAskUsed(click), false);
    markAskUsed(click);
    assert.equal(isAskUsed(click), true);
    // the same click seen again (the box mounted a second time, same history state) never prefills
    assert.equal(isAskUsed({ ...click }), true);
    // a new click (a new time) prefills again
    assert.equal(isAskUsed({ at: 1700000000002 }), false);
});

test('no click, or a click without a time, never prefills', () => {
    assert.equal(isAskUsed(null), true);
    assert.equal(isAskUsed({ note: 'x' }), true);
    markAskUsed(null); // no-op, no throw
});

test('withoutAsk drops only the click from the history state', () => {
    assert.equal(withoutAsk({ ask: { at: 1 } }), null);
    assert.deepEqual(withoutAsk({ ask: { at: 1 }, from: 'tray' }), { from: 'tray' });
    assert.equal(withoutAsk(null), null);
    assert.equal(withoutAsk('x'), null);
});
