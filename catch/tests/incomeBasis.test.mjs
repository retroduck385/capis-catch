// Income basis (FP IX. Cash flow): the dropdown shows only the percent, the source word goes into the Remarks,
// and the factors used by the computations don't change. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INCOME_BASES, basisText, withBasisLine } from '../src/pages/financialPackage/options.js';
import { tatSlashHint } from '../src/pages/workTray/options.js';

test('the dropdown shows only the percent; values and factors are unchanged', () => {
    assert.deepEqual(INCOME_BASES.map((b) => [b.value, b.label, b.factor]),
        [['COE', '80%', 0.8], ['PAYSLIP', '90%', 0.9], ['DECLARED', '100%', 1]]);
    assert.equal(basisText(INCOME_BASES[1]), 'payslip (90%)');
    assert.equal(basisText(null), '');
});

test('picking a basis writes the first line of the remarks and keeps the CO\'s text', () => {
    assert.equal(withBasisLine('', 'COE'), 'Income basis: COE (80%).');
    assert.equal(withBasisLine(null, 'PAYSLIP'), 'Income basis: payslip (90%).');
    assert.equal(withBasisLine('Stable job.', 'PAYSLIP'), 'Income basis: payslip (90%).\nStable job.');
});

test('picking again replaces the line; clearing the basis removes it', () => {
    const once = withBasisLine('Stable job.', 'COE');
    assert.equal(withBasisLine(once, 'DECLARED'), 'Income basis: as declared (100%).\nStable job.');
    assert.equal(withBasisLine(once, ''), 'Stable job.');
    assert.equal(withBasisLine('Income basis: COE (80%).', null), '');
});

test('the CO\'s own text that mentions the basis is not touched', () => {
    const own = 'Income basis is unclear, check the ITR.';
    assert.equal(withBasisLine(own, 'COE'), `Income basis: COE (80%).\n${own}`);
});

test('the TAT "4d / 10d" hover says what the two numbers are, then the detail', () => {
    const [first, second] = tatSlashHint(4, 10).split('\n');
    assert.equal(first, '"4d / 10d": days in this stage so far / this stage\'s target.');
    assert.equal(second, '4d of the 10d target (40%).');
});
