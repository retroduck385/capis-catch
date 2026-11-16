// Checks how staff pages write who and when (src/components/people.js, DESIGN.md 11.10).
// Run: npm test (node --test, no extra packages). Dates are built in local time, so the checks hold in any time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarStyle, formatDay, formatWhen, fullWhen, initialsOf, personName } from '../src/components/people.js';

const now = new Date(2026, 10, 16, 15, 0); // Mon 16 Nov 2026, 3:00 PM

test('a role in a test account name is dropped', () => {
    assert.equal(personName('Josh Denzel Account Officer'), 'Josh Denzel');
    assert.equal(personName('Josh Credit Officer'), 'Josh');
    assert.equal(personName('Ana Dispatch Admin (Credit Officer Admin)'), 'Ana');
    assert.equal(personName('Maria Santos'), 'Maria Santos');
    assert.equal(personName('Account Officer'), 'Account Officer'); // nothing would be left: keep it
    assert.equal(personName(null), '');
});

test('initials and avatar colour are stable', () => {
    assert.equal(initialsOf('Josh Denzel Ng'), 'JD');
    assert.equal(initialsOf(''), '?');
    assert.deepEqual(avatarStyle('Josh Denzel'), avatarStyle('Josh Denzel'));
});

test('recent times are relative, older ones short', () => {
    assert.equal(formatWhen(new Date(2026, 10, 16, 14, 59, 30), now), 'Just now');
    assert.equal(formatWhen(new Date(2026, 10, 16, 14, 48), now), '12 min ago');
    assert.match(formatWhen(new Date(2026, 10, 16, 9, 5), now), /^Today, 9:05\s?AM$/i);
    assert.match(formatWhen(new Date(2026, 10, 15, 16, 48), now), /^Yesterday, 4:48\s?PM$/i);
    assert.match(formatWhen(new Date(2026, 10, 12, 14, 7), now), /^Thu, 2:07\s?PM$/i);
    assert.match(formatWhen(new Date(2026, 9, 26, 14, 7), now), /^Oct 26, 2:07\s?PM$/i);
    assert.equal(formatWhen(new Date(2025, 9, 26, 14, 7), now), 'Oct 26, 2025');
    assert.equal(formatWhen(null, now), '—');
    assert.equal(formatWhen('not a date', now), '—');
});

test('record dates and tooltips', () => {
    assert.equal(formatDay(new Date(2026, 8, 29, 14, 5)), 'Sep 29, 2026');
    assert.match(fullWhen(new Date(2026, 9, 26, 14, 7)), /October 26, 2026/);
    assert.equal(fullWhen(null), '');
});
