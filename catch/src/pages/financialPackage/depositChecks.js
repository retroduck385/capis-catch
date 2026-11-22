// FP X. Deposit Checking: "Fill from KYC and bank statements". Pure helpers (no Supabase), shared by the page and
// the tests. Proposes one row per bank account for the CO to check before saving; nothing is saved here.
//   Accounts: each one declared in the KYC, plus any account that is only on a bank statement.
//   From a bank statement the Account Officer CONFIRMED on the Document check (HITL; unconfirmed ones are not used):
//     account name / type as printed, AMD = the monthly deposit totals averaged (bankSummary, same as the Document
//     check), ADB = the printed monthly ADBs weighted by days in the month, only when every month has one (the AI
//     reads monthly totals, not daily balances, so an ADB that isn't printed is left for the CO to work out).
//   Status / handling is the CO's judgement: the remarks only say where the figures came from.
import { bankSummary, toNumber } from '../documentCheck/compare.js';
import { partyLabel } from '../applicationForm/options.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const daysIn = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

// One extraction's fields -> { header: { field_key: value }, rows: [{ field_key: value }] } (item_no 0 = header).
// The confirmed value is final_value; extracted_value only if final_value was never set.
export const statementValues = (fields) => {
    const header = {};
    const byItem = {};
    for (const f of fields ?? []) {
        const value = f.final_value ?? f.extracted_value ?? null;
        if (f.item_no === 0) header[f.field_key] = value;
        else (byItem[f.item_no] ??= {})[f.field_key] = value;
    }
    return { header, rows: Object.keys(byItem).map(Number).sort((a, b) => a - b).map((n) => byItem[n]) };
};

// Statements of the same account (same account number) as one, each month counted once (the first file's)
const groupStatements = (statements) => {
    const groups = [];
    for (const s of statements) {
        const no = digits(s.header.account_number);
        const group = no ? groups.find((g) => g.no === no) : null;
        if (group) {
            const seen = new Set(group.rows.map((r) => str(r.month).slice(0, 7)));
            group.rows.push(...s.rows.filter((r) => !seen.has(str(r.month).slice(0, 7))));
        } else {
            groups.push({ no, party: s.party, header: s.header, rows: [...s.rows] });
        }
    }
    return groups;
};

// AMD / ADB and a short note of where they came from, for one account's statement months
export const statementFigures = (rows) => {
    const s = bankSummary(rows);
    if (!s) return { amd: '', adb: '', note: 'Bank statement on file, but no monthly deposit totals were confirmed.' };
    const printed = {};
    for (const r of rows) {
        const month = str(r.month).slice(0, 7);
        const adb = toNumber(r.average_daily_balance);
        if (adb !== null && s.months.includes(month) && !(month in printed)) printed[month] = adb;
    }
    const hasAdb = s.months.every((m) => m in printed);
    const days = s.months.reduce((t, m) => t + daysIn(m), 0);
    const adb = hasAdb ? s.months.reduce((t, m) => t + printed[m] * daysIn(m), 0) / days : null;
    const n = s.months.length;
    const span = n === 1 ? monthLabel(s.months[0]) : `${monthLabel(s.months[0])} – ${monthLabel(s.months.at(-1))}`;
    const note = [
        `Bank statement ${span} (${n} month${n === 1 ? '' : 's'}): AMD = deposits ÷ ${n}.`,
        hasAdb ? 'ADB as printed on the statement.' : 'ADB not printed: work it out from the daily balances.',
        s.missing.length ? `No statement for ${s.missing.map(monthLabel).join(', ')}.` : null,
    ].filter(Boolean).join(' ');
    return { amd: s.average.toFixed(2), adb: adb === null ? '' : adb.toFixed(2), note };
};

// The X. rows to add (form strings). kycAccounts: [{ party, bank_name, account_type, account_number }];
// statements: confirmed bank statements [{ party, header, rows }] (statementValues); existing: the form's
// deposit_checks rows. Accounts already in X. (same account number) are skipped.
export const depositRows = (kycAccounts, statements, existing = []) => {
    const groups = groupStatements(statements);
    const used = new Set();
    const rows = kycAccounts.map((k) => {
        const no = digits(k.account_number);
        const g = no ? groups.find((x) => x.no === no) : null;
        if (g) used.add(g);
        const figures = g ? statementFigures(g.rows) : null;
        return {
            bank_name: str(k.bank_name) || str(g?.header.bank_name),
            account_name: str(g?.header.account_name),
            account_type: str(g?.header.account_type) || str(k.account_type),
            account_number: str(k.account_number),
            amd: figures?.amd ?? '',
            adb: figures?.adb ?? '',
            remarks: [`Declared in the KYC (${partyLabel(k.party)}).`,
                figures ? figures.note : 'No bank statement on file.'].join(' '),
        };
    });
    for (const g of groups.filter((x) => !used.has(x))) {
        const figures = statementFigures(g.rows);
        rows.push({
            bank_name: str(g.header.bank_name),
            account_name: str(g.header.account_name),
            account_type: str(g.header.account_type),
            account_number: str(g.header.account_number),
            amd: figures.amd,
            adb: figures.adb,
            remarks: `Not declared in the KYC; bank statement uploaded for the ${partyLabel(g.party)}. ${figures.note}`,
        });
    }
    const inX = (r) => existing.some((e) => (digits(r.account_number)
        ? digits(e.account_number) === digits(r.account_number)
        : !digits(e.account_number) && str(e.bank_name).toUpperCase() === r.bank_name.toUpperCase()));
    return rows.filter((r) => !inX(r));
};
