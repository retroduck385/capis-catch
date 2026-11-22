// What the CI results mean for the file (src/pages/ciRequest/ciFacts.js). Synthetic values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ciSlots, dbrWithTu, depositBandFromNfis, loanHistoryBand, nfisBand, raacNfis, raacRecord, reportValidity, returnedChecks,
    undisclosedLoans, validityRows, yearsSince,
} from '../src/pages/ciRequest/ciFacts.js';

const AS_OF = new Date('2026-11-22T00:00:00');
const app = {
    applicants: [
        { id: 1, role: 'PRINCIPAL', existing_loans: [{ loan_type: 'Auto', monthly_payment: 12000, term_over_6_months: true }], credit_cards: [] },
        { id: 2, role: 'SPOUSE', existing_loans: [], credit_cards: [{ issuing_bank: 'X' }] },
        { id: 9, role: 'MORTGAGOR' },
    ],
};
const ci = (checks, nfisRecords = [], tuAccounts = []) => ({ checks, nfisRecords, tuAccounts });
const both = (nfis, tu = 'NO_ADVERSE_FINDINGS') => [1, 2].flatMap((id) => [
    { applicant_id: id, check_type: 'NFIS', result: nfis, report_date: '2026-10-01' },
    { applicant_id: id, check_type: 'TU', result: tu, report_date: '2026-10-01' },
]);
const rec = (applicant_id, record_type, extra = {}) => ({ applicant_id, record_type, date_reported: '2020-01-15', ...extra });

test('slots: borrowers only, principal first, each with its NFIS records and TU accounts', () => {
    const slots = ciSlots(app, ci(both('WITH_FINDINGS'), [rec(2, 'CANCELLED_CARD', { settlement: 'UNPAID' })]));
    assert.deepEqual(slots.map((s) => s.who), ['Principal Borrower', 'Spouse']);
    assert.equal(slots[1].nfis.records.length, 1);
    assert.equal(slots[0].nfis.records.length, 0);
});

test('NFIS band: no records = no adverse; waits for every result; inconclusive is left to the CO', () => {
    assert.equal(nfisBand(ciSlots(app, ci(both('NO_ADVERSE_FINDINGS'))), AS_OF).band, 'NO_ADVERSE');
    const waiting = nfisBand(ciSlots(app, ci(both('NO_ADVERSE_FINDINGS').filter((c) => !(c.applicant_id === 2 && c.check_type === 'NFIS')))), AS_OF);
    assert.equal(waiting.band, null);
    assert.match(waiting.source, /Spouse/);
    const checks = both('NO_ADVERSE_FINDINGS').map((c) => (c.applicant_id === 1 && c.check_type === 'NFIS' ? { ...c, result: 'INCONCLUSIVE' } : c));
    assert.equal(nfisBand(ciSlots(app, ci(checks)), AS_OF).band, null);
});

test('NFIS band: the worst record of any borrower decides, like the sheet', () => {
    const band = (records) => nfisBand(ciSlots(app, ci(both('WITH_FINDINGS'), records)), AS_OF).band;
    assert.equal(band([rec(1, 'CANCELLED_CARD', { settlement: 'FULLY_PAID' })]), 'CANCELLED_CARD_SETTLED');
    assert.equal(band([rec(1, 'CANCELLED_CARD', { settlement: 'FULLY_PAID' }), rec(2, 'CANCELLED_CARD', { settlement: 'UNPAID' })]), 'CANCELLED_CARD_UNSETTLED');
    assert.equal(band([rec(1, 'COURT_CASE', { date_reported: '2012-01-01', date_closed: '2014-06-01' })]), 'COURT_CASE_OLD');
    assert.equal(band([rec(1, 'COURT_CASE', { date_reported: '2019-01-01' })]), 'COURT_CASE_RECENT');
    assert.equal(band([rec(1, 'CLOSED_CHECKING_ACCOUNT', { date_closed: '2019-01-01' })]), 'MISHANDLED_CHECKING_OLD');
    assert.equal(band([rec(1, 'CLOSED_CHECKING_ACCOUNT'), rec(2, 'RETURNED_CHECKS')]), 'MULTIPLE_MISHANDLED');
    // a record the sheet has no band for: the CO picks, unless the band is already the worst
    assert.equal(band([rec(1, 'FORECLOSURE')]), null);
    assert.equal(band([rec(1, 'CLOSED_CHECKING_ACCOUNT', { date_closed: '2024-01-01' })]), null);
    assert.equal(band([rec(1, 'FORECLOSURE'), rec(1, 'COURT_CASE', { date_reported: '2023-01-01' })]), 'COURT_CASE_RECENT');
});

test('loan history from every TU account: poor / fair / good / none', () => {
    const band = (accounts) => loanHistoryBand(ciSlots(app, ci(both('NO_ADVERSE_FINDINGS', 'WITH_FINDINGS'), [], accounts))).band;
    const acct = (applicant_id, extra) => ({ applicant_id, is_open: true, account_type: 'PERSONAL LOAN', max_dpd: 0, past_due: 0, ...extra });
    assert.equal(band([]), 'NONE');
    assert.equal(band([acct(1, {})]), 'GOOD');
    assert.equal(band([acct(1, {}), acct(2, { max_dpd: 25 })]), 'FAIR');
    assert.equal(band([acct(1, { max_dpd: 45 })]), 'POOR');
    assert.equal(band([acct(1, { past_due: 300 })]), 'POOR');
    assert.equal(band([acct(1, { is_open: false, status: 'WRITTEN_OFF' })]), 'POOR');
});

test('returned checks on the NFIS give the deposit band', () => {
    const slots = (records, result = 'WITH_FINDINGS') => ciSlots(app, ci(both(result), records));
    assert.equal(returnedChecks(slots([rec(1, 'RETURNED_CHECKS', { returned_checks: 3 }), rec(2, 'CLOSED_CHECKING_ACCOUNT', { returned_checks: 4 })])), 7);
    assert.equal(depositBandFromNfis(7), 'POOR');
    assert.equal(depositBandFromNfis(2), 'FAIR');
    assert.equal(depositBandFromNfis(returnedChecks(slots([], 'NO_ADVERSE_FINDINGS'))), 'GOOD');
    assert.equal(returnedChecks(ciSlots(app, ci([]))), null);
});

test('RAAC acceptable records (as of June 2021): the table, edge by edge', () => {
    const r = (record_type, date_reported, outstanding_balance, extra = {}) =>
        raacRecord({ record_type, date_reported, outstanding_balance, settlement: 'UNPAID', ...extra }, { asOf: AS_OF }).status;
    assert.equal(r('FORECLOSURE', '2001-01-01'), 'NOT_ALLOWED');
    assert.equal(r('REPLEVIN', '2001-01-01'), 'NOT_ALLOWED');
    assert.equal(r('CANCELLED_CARD', '2025-01-01', 90000, { settlement: 'ZERO_BALANCE' }), 'ACCEPTABLE');   // a
    assert.equal(r('CANCELLED_CARD', '2022-01-01', 20000), 'ACCEPTABLE');                                  // b
    assert.equal(r('ADVERSE_LOAN', '2022-01-01', 50000), 'ACCEPTABLE_IF_LCR');                             // c
    assert.equal(r('CANCELLED_CARD', '2023-11-01', 15000), 'ACCEPTABLE_IF_LCR');                           // d: over 2 years
    assert.equal(r('CANCELLED_CARD', '2025-01-01', 15000), 'DEVIATION');                                   // under 2 years
    assert.equal(r('CANCELLED_CARD', '2022-01-01', 50000.01), 'DEVIATION');
    assert.equal(r('CANCELLED_CARD', '2022-01-01', null), 'CHECK');
    assert.equal(r('CLOSED_CHECKING_ACCOUNT', '2020-01-01'), 'ACCEPTABLE');
    assert.equal(r('CLOSED_CHECKING_ACCOUNT', '2025-01-01'), 'ACCEPTABLE_IF_LCR');
    assert.equal(raacRecord({ record_type: 'CLOSED_CHECKING_ACCOUNT', date_reported: '2010-01-01' }, { asOf: AS_OF, closedAccounts: 2 }).status, 'DEVIATION');
    assert.equal(r('COURT_CASE', '2020-01-01'), 'DEVIATION');
    assert.equal(r('FRAUD', '2010-01-01'), 'DEVIATION');
});

test('the LCR cap: 70% of appraised value for a regular loan, 80% of TCP for end-user financing', () => {
    const slots = ciSlots(app, ci(both('WITH_FINDINGS'), [rec(1, 'ADVERSE_LOAN', { date_reported: '2022-01-01', outstanding_balance: 30000, settlement: 'UNPAID' })]));
    const [regular] = raacNfis(slots, { asOf: AS_OF, lcr: 0.72 });
    assert.equal(regular.cap.cap, 0.7);
    assert.equal(regular.lcrOk, false);
    const [endUser] = raacNfis(slots, { asOf: AS_OF, endUser: true, lcr: 0.9, tcpLcr: 0.8 });
    assert.equal(endUser.cap.against, 'TCP');
    assert.equal(endUser.lcrOk, true);
    assert.equal(raacNfis(slots, { asOf: AS_OF })[0].lcrOk, null);   // no LCR yet
});

test('TU accounts the borrowers did not declare, and the DBR with their installments', () => {
    const accounts = [
        { applicant_id: 1, is_open: true, account_type: 'AUTO LOAN', installment: 12000 },
        { applicant_id: 1, is_open: true, account_type: 'PERSONAL LOAN', installment: 8000 },
        { applicant_id: 1, is_open: true, account_type: 'SALARY LOAN', installment: 5000, ownership: 'GUARANTOR' },
        { applicant_id: 1, is_open: false, account_type: 'HOME LOAN', installment: 20000 },
        { applicant_id: 2, is_open: true, account_type: 'CREDIT CARD', installment: 0 },
    ];
    const rows = undisclosedLoans(ciSlots(app, ci(both('NO_ADVERSE_FINDINGS'), [], accounts)));
    assert.deepEqual(rows.map((r) => [r.who, r.extraLoans, r.extraCards]), [['Principal Borrower', 1, 0], ['Spouse', 0, 0]]);
    assert.equal(rows[0].tuInstallments, 20000);
    assert.equal(rows[0].declaredPayments, 12000);
    const computed = { amortization: 30000, existing: 12000, totalGross: 140000 };
    assert.equal(dbrWithTu(computed, rows), (30000 + 12000 + 8000) / 140000);
    assert.equal(dbrWithTu(computed, [{ ...rows[0], tuInstallments: 12000 }]), null);
});

test('report validity: a year, or 4 months for an NFIS with a court case', () => {
    assert.equal(reportValidity('2025-11-01', { asOf: AS_OF }).status, 'EXPIRED');
    assert.equal(reportValidity('2025-12-10', { asOf: AS_OF }).status, 'SOON');
    assert.equal(reportValidity('2026-06-01', { asOf: AS_OF }).status, 'OK');
    assert.equal(reportValidity('2026-07-01', { asOf: AS_OF, court: true }).status, 'EXPIRED');
    assert.equal(reportValidity('2026-07-01', { asOf: AS_OF, court: true }).expiresOn, '2026-11-01');
    assert.equal(reportValidity(null).status, 'NO_DATE');
    const rows = validityRows(ciSlots(app, ci(both('WITH_FINDINGS'), [rec(1, 'COURT_CASE')])), AS_OF);
    assert.deepEqual(rows.map((r) => `${r.who} ${r.check} ${r.months}`), ['Principal Borrower NFIS 4', 'Principal Borrower TU 12', 'Spouse NFIS 12', 'Spouse TU 12']);
    assert.equal(yearsSince('2020-11-23', AS_OF), 5);
    assert.equal(yearsSince('2020-11-22', AS_OF), 6);
});

test('Copy from TU: open and closed loans (not cards) become XI. rows, without the ones already there', async () => {
    const { tuLoanRows } = await import('../src/pages/ciRequest/ciFacts.js');
    const accounts = [
        { applicant_id: 1, is_open: false, account_type: 'PERSONAL LOAN', lender_type: 'BANK', balance: 0, installment: 6300,
            original_amount: 151200, opened_on: '2017-08-18', closed_on: '2019-08-18', maturity_on: '2019-08-18' },
        { applicant_id: 1, is_open: true, account_type: 'AUTO LOAN', lender_name: 'Sample Bank', balance: 350000, installment: 12000,
            original_amount: 900000, opened_on: '2023-02-01', maturity_on: '2028-02-01', max_dpd: 15 },
        { applicant_id: 1, is_open: true, account_type: 'CREDIT CARD', lender_type: 'BANK', balance: 5000 },
        { applicant_id: 1, is_open: false, account_type: 'CREDIT CARD', lender_type: 'BANK', balance: 0 },
        { applicant_id: 2, is_open: true, account_type: 'SALARY LOAN', lender_type: 'FINANCING', balance: 20000, ownership: 'GUARANTOR' },
    ];
    const slots = ciSlots(app, ci(both('NO_ADVERSE_FINDINGS'), [], accounts));
    const rows = tuLoanRows(slots);
    assert.equal(rows.length, 3);
    // per borrower, open loans first
    assert.deepEqual(rows[0], {
        bank_name: 'Sample Bank', facility: 'AUTO LOAN', original_loan: '900000', outstanding_balance: '350000',
        amortization: '12000', contract_date: '2023-02-01', maturity_date: '2028-02-01',
        remarks: 'TU report 2026-10-01 (Principal Borrower), max 15 days late',
    });
    assert.deepEqual(rows[1], {
        bank_name: 'BANK', facility: 'PERSONAL LOAN', original_loan: '151200', outstanding_balance: '0',
        amortization: '6300', contract_date: '2017-08-18', maturity_date: '2019-08-18',
        remarks: 'TU report 2026-10-01 (Principal Borrower), closed 2019-08-18',
    });
    assert.match(rows[2].remarks, /as guarantor/);
    assert.equal(rows[2].bank_name, 'FINANCING');
    // already in XI.: skipped
    assert.equal(tuLoanRows(slots, [{ bank_name: 'sample bank', facility: 'Auto Loan', outstanding_balance: '350000' }]).length, 2);
    assert.equal(tuLoanRows(slots, [{ bank_name: 'Bank', facility: 'personal loan', outstanding_balance: '0' }]).length, 2);
});
