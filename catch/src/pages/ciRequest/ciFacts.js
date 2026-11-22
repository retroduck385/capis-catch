// What the CI's saved results mean for the file (Part D): the Credit Investigator's NFIS records and TU accounts
// (20261126_ci_facts.sql), read by the credit score, the policy check (MRAC), the FP and the reviewer / approver pages.
// Everything here is a PROPOSAL or a flag for a person: the CO accepts or changes a score band, and an exception
// is written by the CO. Nothing approves, rejects or changes a record by itself.
//
// Sources (policy_chunks):
//   * Credit_Score tab rows 31-49: Loan Borrowing/s, Deposit / current account handling, NFIS Checking bands.
//   * RAAC-HL-03-NFIS-BMI-DATABASE (+ -EXCEPTIONS): acceptable NFIS records (as of June 2021), the LCR caps
//     (70% vs appraised value for regular loans, 80% vs TCP for end-user financing), replevin / foreclosure never.
//   * CPM-VII-0035: the CI report is valid for 1 year; court and trade information for 4 months (as of recommendation).
// Where the sheet and the RAAC table give different numbers (e.g. 5 vs 3 years for a closed checking account),
// the score uses the sheet's and the RAAC check uses the RAAC table's (Josh, 2026-11-22; mrac-service/OPEN_QUESTIONS.md).
//
// Pure (no React, no Supabase): tests/ciFacts.test.mjs.
import { BORROWER_ROLES, partyLabel } from '../applicationForm/options.js';
import { NFIS_RECORD_TYPES } from './options.js';

const labelOf = (options, value) => options.find((o) => o.value === value)?.label ?? value ?? 'Record';

const DAY = 24 * 60 * 60 * 1000;
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const toDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`) : null);
// Whole years between two dates (as of asOf), like the sheet's ROUNDDOWN(YEARFRAC())
export const yearsSince = (from, asOf = new Date()) => {
    const a = toDate(from);
    if (!a) return null;
    const b = asOf instanceof Date ? asOf : toDate(asOf);
    let y = b.getFullYear() - a.getFullYear();
    if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y -= 1;
    return y;
};
const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- the CI results per borrower ----------
// app: fetchApplication record; ci: fetchCiResults() ({ checks, nfisRecords, tuAccounts }).
// -> [{ party, who, nfis: { result, report_date, records }, tu: { result, report_date, accounts } }]
export const ciSlots = (app, ci) => (app?.applicants ?? [])
    .filter((p) => BORROWER_ROLES.includes(p.role))
    .sort((a, b) => BORROWER_ROLES.indexOf(a.role) - BORROWER_ROLES.indexOf(b.role) || (a.party_no ?? 0) - (b.party_no ?? 0))
    .map((party) => {
        const check = (type) => (ci?.checks ?? []).find((c) => c.applicant_id === party.id && c.check_type === type) ?? null;
        const nfis = check('NFIS');
        const tu = check('TU');
        return {
            party,
            who: partyLabel(party),
            nfis: { result: nfis?.result ?? null, report_date: nfis?.report_date ?? null,
                records: (ci?.nfisRecords ?? []).filter((r) => r.applicant_id === party.id) },
            tu: { result: tu?.result ?? null, report_date: tu?.report_date ?? null,
                accounts: (ci?.tuAccounts ?? []).filter((r) => r.applicant_id === party.id) },
        };
    });

const settled = (r) => r.settlement === 'FULLY_PAID' || r.settlement === 'ZERO_BALANCE';
const isMishandledChecking = (r) => r.record_type === 'CLOSED_CHECKING_ACCOUNT' || r.record_type === 'RETURNED_CHECKS';
// Court cases and closed accounts count from the date closed when there is one ("from date closed / reported")
const sinceClosed = (r, asOf) => yearsSince(r.date_closed ?? r.date_reported, asOf);

// The suggestion shape creditScore.js uses: { input, band, source } (band null = the CO picks)
const pick = (input, band, source) => ({ input, band, source });
const none = (source, input = null) => ({ input, band: null, source });
// Waiting for a result, or the CI couldn't settle it: no suggestion
const notReady = (slots, part, label) => {
    const missing = slots.filter((s) => !s[part].result);
    if (missing.length) return none(`Waiting for the Credit Investigator's ${label} result: ${missing.map((s) => s.who).join(', ')}.`);
    const unsure = slots.filter((s) => s[part].result === 'INCONCLUSIVE');
    if (unsure.length) return none(`${label} was inconclusive for ${unsure.map((s) => s.who).join(', ')}: pick from the CI's summary.`);
    return null;
};

// ---------- Credit score: 2. Character ----------
// NFIS Checking (sheet rows 42-49), from every borrower's NFIS records; the worst record decides.
// Worst first, as the sheet's points rank them (-7, -7, 0, 0, 3, 3, 7).
const NFIS_BAND_RANK = ['COURT_CASE_RECENT', 'MULTIPLE_MISHANDLED', 'CANCELLED_CARD_UNSETTLED', 'COURT_CASE_OLD',
    'MISHANDLED_CHECKING_OLD', 'CANCELLED_CARD_SETTLED', 'NO_ADVERSE'];
export const nfisBand = (slots, asOf = new Date()) => {
    if (!slots.length) return none('No borrowers.');
    const wait = notReady(slots, 'nfis', 'NFIS');
    if (wait) return wait;
    const records = slots.flatMap((s) => s.nfis.records.map((r) => ({ ...r, who: s.who })));
    if (records.length === 0) return pick('No adverse record', 'NO_ADVERSE', 'Every borrower\'s NFIS result has no records.');

    const bands = [];
    const unscored = [];
    const mishandled = records.filter(isMishandledChecking);
    if (mishandled.length > 1) bands.push('MULTIPLE_MISHANDLED');
    else if (mishandled.length === 1) {
        if ((sinceClosed(mishandled[0], asOf) ?? 0) > 5) bands.push('MISHANDLED_CHECKING_OLD');
        else unscored.push('1 mishandled checking account within 5 years');
    }
    for (const r of records) {
        if (r.record_type === 'CANCELLED_CARD') bands.push(settled(r) ? 'CANCELLED_CARD_SETTLED' : 'CANCELLED_CARD_UNSETTLED');
        else if (r.record_type === 'COURT_CASE') bands.push((sinceClosed(r, asOf) ?? 0) > 10 ? 'COURT_CASE_OLD' : 'COURT_CASE_RECENT');
        else if (!isMishandledChecking(r)) unscored.push(labelOf(NFIS_RECORD_TYPES, r.record_type).toLowerCase());
    }
    const input = `${plural(records.length, 'record')}: ${records.map((r) => labelOf(NFIS_RECORD_TYPES, r.record_type)).join(', ')}`;
    const worst = NFIS_BAND_RANK.find((b) => bands.includes(b));
    // A record the sheet has no band for could be worse than any it has: only suggest when it can't change the band
    if (unscored.length && worst !== NFIS_BAND_RANK[0] && worst !== NFIS_BAND_RANK[1]) {
        return none(`The score sheet has no band for: ${[...new Set(unscored)].join(', ')}. Pick from the CI's records.`, input);
    }
    return pick(input, worst, 'The worst of every borrower\'s NFIS records (from the CI results).');
};

// Loan Borrowing/s (rows 32-36), from every borrower's TU accounts, open and closed:
// Poor = past due now, a past due / written-off / legal status, or ever more than 30 days late;
// Fair = ever 1-30 days late; Good = loans, never late; None = no accounts on any TU report.
export const loanHistoryBand = (slots) => {
    if (!slots.length) return none('No borrowers.');
    const wait = notReady(slots, 'tu', 'TU');
    if (wait) return wait;
    const accounts = slots.flatMap((s) => s.tu.accounts);
    if (accounts.length === 0) return pick('No accounts on the TU reports', 'NONE', 'No borrower has an account on TU.');
    const poor = accounts.filter((a) => (num(a.past_due) ?? 0) > 0 || ['PAST_DUE', 'WRITTEN_OFF', 'LEGAL'].includes(a.status)
        || (num(a.max_dpd) ?? 0) > 30);
    const fair = accounts.filter((a) => (num(a.max_dpd) ?? 0) >= 1 && (num(a.max_dpd) ?? 0) <= 30);
    const input = `${plural(accounts.length, 'TU account')}`;
    if (poor.length) return pick(`${input}, ${poor.length} past due`, 'POOR', 'A TU account is past due, written off, in legal, or was over 30 days late.');
    if (fair.length) return pick(`${input}, ${fair.length} late 1-30 days`, 'FAIR', 'A TU account was 1-30 days late at most.');
    return pick(`${input}, never late`, 'GOOD', 'TU accounts with no late payment.');
};

// Returned checks on the NFIS records (rows 37-41): more than 5 = Poor, 1-5 = Fair, none = Good.
// null when the NFIS results aren't all in (the score keeps its own reading of the declared accounts).
export const returnedChecks = (slots) => {
    if (!slots.length || slots.some((s) => !s.nfis.result || s.nfis.result === 'INCONCLUSIVE')) return null;
    return slots.flatMap((s) => s.nfis.records).reduce((t, r) => t + (num(r.returned_checks) ?? 0), 0);
};
export const depositBandFromNfis = (total) => (total === null ? null
    : total > 5 ? 'POOR' : total >= 1 ? 'FAIR' : 'GOOD');

// ---------- RAAC: NFIS / bank database, acceptable records ----------
// lcr: { value, basis } of the loan (computeFp: appraised value if any, else TCP); endUser: bought from a developer
// (end-user financing: 80% vs TCP), else a regular loan (70% vs appraised value).
// -> { status, reason, cap? } status: ACCEPTABLE | ACCEPTABLE_IF_LCR | DEVIATION | NOT_ALLOWED | CHECK
export const lcrCapOf = (endUser) => (endUser ? { cap: 0.8, against: 'TCP' } : { cap: 0.7, against: 'appraised value' });
export const raacRecord = (r, { asOf = new Date(), closedAccounts = 1, endUser = false } = {}) => {
    const cap = lcrCapOf(endUser);
    const years = yearsSince(r.date_reported, asOf);
    if (r.record_type === 'REPLEVIN' || r.record_type === 'FORECLOSURE') {
        return { status: 'NOT_ALLOWED', reason: 'Replevin or foreclosure: not allowed, regardless of the date of the report.' };
    }
    if (r.record_type === 'CANCELLED_CARD' || r.record_type === 'ADVERSE_LOAN') {
        if (settled(r)) return { status: 'ACCEPTABLE', reason: 'Fully paid or zero balance (acceptable record a; verify any certificate of full payment).' };
        const ob = num(r.outstanding_balance);
        if (ob === null || years === null) return { status: 'CHECK', reason: 'Needs the outstanding balance and the date reported.' };
        if (years > 3 && ob <= 20000) return { status: 'ACCEPTABLE', reason: `Over 3 years old, ${peso(ob)} outstanding (₱20,000 at most).` };
        if (years > 3 && ob <= 50000) {
            return { status: 'ACCEPTABLE_IF_LCR', cap, reason: `Over 3 years old, ${peso(ob)} outstanding (over ₱20,000, up to ₱50,000).` };
        }
        if (years > 2 && ob <= 20000) {
            return { status: 'ACCEPTABLE_IF_LCR', cap, reason: `Over 2 years old, ${peso(ob)} outstanding (₱20,000 at most).` };
        }
        return { status: 'DEVIATION', reason: `${plural(years, 'year')} since reported, ${peso(ob)} unpaid: outside the acceptable records.` };
    }
    if (r.record_type === 'CLOSED_CHECKING_ACCOUNT') {
        if (closedAccounts > 1) return { status: 'DEVIATION', reason: `${closedAccounts} closed checking accounts (one at most is acceptable).` };
        const y = sinceClosed(r, asOf);
        if (y === null) return { status: 'CHECK', reason: 'Needs the date reported.' };
        if (y > 3) return { status: 'ACCEPTABLE', reason: 'One closed checking account, over 3 years ago.' };
        return { status: 'ACCEPTABLE_IF_LCR', cap, condition: 'and 1 existing current account without returned checks',
            reason: 'One closed checking account, 3 years ago or less.' };
    }
    return { status: 'DEVIATION', reason: `${labelOf(NFIS_RECORD_TYPES, r.record_type)}: not one of the acceptable records.` };
};

// Every borrower's NFIS records with their RAAC reading and, for the ones that need it, whether the loan's LCR
// is within the cap. lcr: computeFp().lcr; tcpLcr: loan / TCP (for end-user financing the cap is against TCP).
export const raacNfis = (slots, { asOf = new Date(), endUser = false, lcr = null, tcpLcr = null } = {}) =>
    slots.flatMap((s) => {
        const closedAccounts = s.nfis.records.filter((r) => r.record_type === 'CLOSED_CHECKING_ACCOUNT').length;
        return s.nfis.records.map((r) => {
            const out = raacRecord(r, { asOf, closedAccounts, endUser });
            if (out.status !== 'ACCEPTABLE_IF_LCR') return { who: s.who, record: r, ...out };
            const value = endUser ? tcpLcr : lcr;
            const lcrOk = value === null || value === undefined ? null : value <= out.cap.cap + 1e-9;
            return { who: s.who, record: r, ...out, lcr: value ?? null, lcrOk };
        });
    });

// ---------- TU vs what the borrowers declared in the KYC ----------
const isCard = (a) => /card/i.test(a.account_type ?? '');
// Open TU accounts the borrower owes (not as guarantor) vs declared existing loans / credit cards, per borrower.
// -> [{ who, tuLoans, declaredLoans, extraLoans, tuCards, declaredCards, extraCards, tuInstallments, declaredPayments }]
export const undisclosedLoans = (slots) => slots.filter((s) => s.tu.result).map((s) => {
    const own = s.tu.accounts.filter((a) => a.is_open && a.ownership !== 'GUARANTOR');
    const loans = own.filter((a) => !isCard(a));
    const cards = own.filter(isCard);
    const declaredLoans = s.party.existing_loans ?? [];
    const declaredCards = s.party.credit_cards ?? [];
    return {
        who: s.who,
        tuLoans: loans.length, declaredLoans: declaredLoans.length, extraLoans: Math.max(0, loans.length - declaredLoans.length),
        tuCards: cards.length, declaredCards: declaredCards.length, extraCards: Math.max(0, cards.length - declaredCards.length),
        tuInstallments: loans.reduce((t, a) => t + (num(a.installment) ?? 0), 0),
        declaredPayments: declaredLoans.reduce((t, l) => t + (num(l.monthly_payment) ?? 0), 0),
    };
});
// What the DBR would be with the TU installments a borrower didn't declare (TU above declared, per borrower) added
// to the existing amortizations. null when TU shows nothing extra. computed: computeFp().
export const extraTuInstallments = (rows) => rows.reduce((t, r) => t + Math.max(0, r.tuInstallments - r.declaredPayments), 0);
export const dbrWithTu = (computed, rows) => {
    const extra = extraTuInstallments(rows);
    if (!computed || computed.amortization === null || computed.amortization === undefined || !computed.totalGross || extra < 0.005) return null;
    return (computed.amortization + (computed.existing ?? 0) + extra) / computed.totalGross;
};

// ---------- Report validity (CPM-VII-0035) ----------
// NFIS with a court case: 4 months; otherwise 1 year from the report date. soonDays: "expires soon" warning.
// -> { status: OK | SOON | EXPIRED | NO_DATE, expiresOn, months }
export const reportValidity = (reportDate, { court = false, asOf = new Date(), soonDays = 30 } = {}) => {
    const d = toDate(reportDate);
    const months = court ? 4 : 12;
    if (!d) return { status: 'NO_DATE', expiresOn: null, months };
    const expires = new Date(d);
    expires.setMonth(expires.getMonth() + months);
    const now = asOf instanceof Date ? asOf : toDate(asOf);
    const left = (expires - now) / DAY;
    const expiresOn = expires.toLocaleDateString('en-CA');
    return { status: left < 0 ? 'EXPIRED' : left <= soonDays ? 'SOON' : 'OK', expiresOn, months };
};
export const validityRows = (slots, asOf = new Date()) => slots.flatMap((s) => [
    s.nfis.result && { who: s.who, check: 'NFIS', ...reportValidity(s.nfis.report_date,
        { court: s.nfis.records.some((r) => r.record_type === 'COURT_CASE'), asOf }) },
    s.tu.result && { who: s.who, check: 'TU', ...reportValidity(s.tu.report_date, { asOf }) },
].filter(Boolean));

// ---------- FP XI. Loan Verification: "Copy from TU" ----------
// The borrowers' TU loans (not credit cards), open and closed, as XI. rows (form strings), for the CO to check before
// saving. Per borrower, open loans first; a closed one says so in its remarks (it shows the payment history; XI. rows
// don't count in the DBR). Rows already in XI. (same lender, facility and balance) are skipped.
// existing: the form's loan_checks rows.
const str = (v) => (v === null || v === undefined ? '' : String(v));
const same = (a, b) => str(a).trim().toUpperCase() === str(b).trim().toUpperCase();
export const tuLoanRows = (slots, existing = []) => slots.flatMap((s) => s.tu.accounts
    .filter((a) => !isCard(a))
    .sort((a, b) => Number(b.is_open) - Number(a.is_open))
    .map((a) => ({
        bank_name: str(a.lender_name || a.lender_type),
        facility: str(a.account_type),
        original_loan: str(a.original_amount),
        outstanding_balance: str(a.balance),
        amortization: str(a.installment),
        contract_date: str(a.opened_on),
        maturity_date: str(a.maturity_on),
        remarks: [`TU report${s.tu.report_date ? ` ${s.tu.report_date}` : ''} (${s.who})`,
            a.is_open ? null : `closed${a.closed_on ? ` ${a.closed_on}` : ''}`,
            a.ownership === 'GUARANTOR' ? 'as guarantor' : null,
            (num(a.max_dpd) ?? 0) > 0 ? `max ${a.max_dpd} days late` : null,
            (num(a.past_due) ?? 0) > 0 ? `${peso(a.past_due)} past due` : null].filter(Boolean).join(', '),
    })))
    .filter((r) => !existing.some((e) => same(e.bank_name, r.bank_name) && same(e.facility, r.facility)
        && Number(e.outstanding_balance || 0) === Number(r.outstanding_balance || 0)));
