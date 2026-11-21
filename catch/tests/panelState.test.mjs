// Side panels (item 38): the hidden state is remembered per page type and never breaks the page when storage fails.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelKey, readHidden, writeHidden } from '../src/components/panelState.js';

const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('remembered per page type', () => {
    const s = memory();
    assert.equal(readHidden('fp', s), false, 'shown until hidden');
    assert.equal(writeHidden('fp', true, s), true);
    assert.equal(readHidden('fp', s), true);
    assert.equal(readHidden('folder-nav', s), false, 'another page type keeps its own setting');
    writeHidden('fp', false, s);
    assert.equal(readHidden('fp', s), false);
    assert.equal(s.m.has(panelKey('fp')), false, 'showing again removes the entry');
});

test('blocked or missing storage: the panel shows and nothing throws', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.equal(readHidden('fp', blocked), false);
    assert.equal(writeHidden('fp', true, blocked), false);
    assert.equal(readHidden('fp', null), false, 'no storage at all (node has none)');
    assert.equal(writeHidden('fp', true, null), false);
});
