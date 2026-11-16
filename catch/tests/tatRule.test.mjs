// Checks the work tray's TAT wording (src/pages/workTray/options.js) against the rule in the database.
// Run: npm test (node --test, no extra packages)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    TAT_NEAR_RATIO, TAT_RULE, TAT_STATE_RULES, TAT_TARGET_DAYS, TAT_TARGETS_TEXT, tatDetail,
} from '../src/pages/workTray/options.js';

const sql = readFileSync(new URL('../supabase/migrations/20261005_work_tray.sql', import.meta.url), 'utf8');

test('targets and the near ratio match stage_tat in the migration', () => {
    const insert = sql.match(/insert into public\.stage_tat \(stage, tat_days\) values([\s\S]*?)on conflict/);
    assert.ok(insert, 'stage_tat insert not found');
    const fromSql = Object.fromEntries([...insert[1].matchAll(/\('(\w+)',\s*([\d.]+)\)/g)].map((m) => [m[1], Number(m[2])]));
    assert.deepEqual(fromSql, TAT_TARGET_DAYS);
    const ratio = sql.match(/near_ratio numeric\(3,2\) not null default ([\d.]+)/);
    assert.equal(Number(ratio[1]), TAT_NEAR_RATIO);
});

test('the rule names the three states with 75% and 100%', () => {
    assert.match(TAT_RULE, /calendar days/);
    assert.match(TAT_RULE, /On track: up to 75%/);
    assert.match(TAT_RULE, /Near TAT: past 75%/);
    assert.match(TAT_RULE, /Beyond TAT: past 100%/);
    assert.match(TAT_STATE_RULES.NEAR, /75%/);
    assert.match(TAT_STATE_RULES.BEYOND, /100%/);
});

test('the targets text lists every stage and says they are placeholders', () => {
    assert.match(TAT_TARGETS_TEXT, /placeholders/);
    assert.equal(TAT_TARGETS_TEXT,
        "Targets (placeholders until the bank's SLA is known): Intake 1 day, Credit Investigation 3 days, "
        + 'Credit Evaluation 3 days, Review 2 days, Approval 2 days.');
});

test('the cell hover: days against the target, percent, days over', () => {
    const [line] = tatDetail(2.1, 3).split('\n');
    assert.equal(line, '2.1d of the 3d target (70%).');
    assert.equal(tatDetail('4.5', '3').split('\n')[0], '4.5d of the 3d target (150%), 1.5d over.');
    const lines = tatDetail(1, 1).split('\n');
    assert.equal(lines[0], '1d of the 1d target (100%).');
    assert.equal(lines[1], TAT_RULE);
    assert.match(lines[2], /placeholder/);
});
