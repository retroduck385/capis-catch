// FP X. Deposit Checking: "Fill from KYC and bank statements" (src/pages/financialPackage/depositChecks.js).
// Synthetic values only (Test Data #7's specimen statement). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositRows, statementFigures, statementValues } from '../src/pages/financialPackage/depositChecks.js';

const principal = { id: 1, role: 'PRINCIPAL', party_no: 0 };
const spouse = { id: 2, role: 'SPOUSE', party_no: 0 };
const kyc = [{ party: principal, bank_name: 'BDO Unibank, Inc. (BDO)', account_type: 'Savings', account_number: '0000-8710-0001' }];

// The AO-confirmed extraction of a 3-month statement (item_no 0 = header, 1..n = months)
const fields = [
    { field_key: 'bank_name', item_no: 0, extracted_value: 'BDO Unibank, Inc.', final_value: 'BDO Unibank, Inc.' },
    { field_key: 'account_name', item_no: 0, extracted_value: 'REYNALDO M. AQUINO', final_value: null },
    { field_key: 'account_number', item_no: 0, final_value: '0000-8710-0001' },
    { field_key: 'account_type', item_no: 0, final_value: 'Payroll Savings Account' },
    { field_key: 'month', item_no: 1, final_value: '2026-07' },
    { field_key: 'total_deposits', item_no: 1, final_value: '84714.85' },
    { field_key: 'month', item_no: 2, final_value: '2026-08' },
    { field_key: 'total_deposits', item_no: 2, final_value: '84716.30' },
    { field_key: 'month', item_no: 3, final_value: '2026-09' },
    { field_key: 'total_deposits', item_no: 3, final_value: '84717.15' },
];
const statement = { party: principal, ...statementValues(fields) };

test('statementValues: header from item 0, one row per month, final value over the extracted one', () => {
    assert.equal(statement.header.account_name, 'REYNALDO M. AQUINO');
    assert.equal(statement.header.account_type, 'Payroll Savings Account');
    assert.deepEqual(statement.rows.map((r) => r.month), ['2026-07', '2026-08', '2026-09']);
});

test('a KYC account with its confirmed statement: printed name / type, AMD = deposits / 3, ADB left blank', () => {
    const rows = depositRows(kyc, [statement]);
    assert.equal(rows.length, 1);
    const [r] = rows;
    assert.equal(r.bank_name, 'BDO Unibank, Inc. (BDO)');
    assert.equal(r.account_name, 'REYNALDO M. AQUINO');
    assert.equal(r.account_type, 'Payroll Savings Account');
    assert.equal(r.account_number, '0000-8710-0001');
    assert.equal(r.amd, '84716.10');   // 254,148.30 / 3
    assert.equal(r.adb, '');
    assert.match(r.remarks, /Jul 2026 – Sep 2026 \(3 months\)/);
    assert.match(r.remarks, /ADB not printed/);
});

test('printed monthly ADBs are weighted by days in the month', () => {
    const adbs = { '2026-07': 84863.16, '2026-08': 96712.24, '2026-09': 103012.86 };
    const rows = statement.rows.map((r) => ({ ...r, average_daily_balance: String(adbs[r.month]) }));
    // (84,863.16 x 31 + 96,712.24 x 31 + 103,012.86 x 30) / 92
    assert.equal(statementFigures(rows).adb, '94774.17');
    // one month without a printed ADB: blank, not a partial average
    assert.equal(statementFigures([...rows.slice(0, 2), statement.rows[2]]).adb, '');
});

test('KYC only, statement only, already in X., and the same account across two files', () => {
    assert.match(depositRows(kyc, [])[0].remarks, /No bank statement on file/);
    assert.equal(depositRows(kyc, [])[0].amd, '');

    const other = { party: spouse, header: { bank_name: 'Sample Bank', account_number: '1234-5678', account_type: 'Checking' },
        rows: [{ month: '2026-09', total_deposits: '20000' }] };
    const rows = depositRows(kyc, [statement, other]);
    assert.equal(rows.length, 2);
    assert.match(rows[1].remarks, /Not declared in the KYC; bank statement uploaded for the Spouse/);
    assert.equal(rows[1].amd, '20000.00');

    assert.equal(depositRows(kyc, [statement], [{ account_number: '000087100001' }]).length, 0);

    // a second file of the same account repeating September and adding October: September counted once
    const later = { party: principal, header: { account_number: '0000-8710-0001' },
        rows: [{ month: '2026-09', total_deposits: '99999' }, { month: '2026-10', total_deposits: '84716.10' }] };
    assert.equal(depositRows(kyc, [statement, later])[0].amd, ((84714.85 + 84716.30 + 84717.15 + 84716.10) / 4).toFixed(2));
});
