// The rows a Credit Investigator types on a report card (20261126_ci_facts.sql): one per NFIS record, one per TU
// account. Field lists, drafts (input strings) <-> payloads (what save_ci_card takes), and one-line summaries.
// Components: ciFactsEditor.jsx. Tests: tests/ciFactRows.test.mjs.
import { formatPeso, labelFor } from '../applicationForm/options.js';
import {
    CASE_STATUSES, CASE_TYPES, HAS_RETURNED_CHECKS, NEEDS_SETTLEMENT, NFIS_RECORD_TYPES, SETTLEMENTS, TU_OWNERSHIP, TU_STATUSES,
} from './options.js';

export const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
const OPEN_CLOSED = [{ value: 'true', label: 'Open' }, { value: 'false', label: 'Closed' }];
const isCourt = (r) => r.record_type === 'COURT_CASE';
const settled = (r) => r.settlement === 'FULLY_PAID' || r.settlement === 'ZERO_BALANCE';

// kind: select | date | money | int | text | bool (a Yes / No select). show(row) / required(row): default always / never.
// files: the select lists this borrower's NFIS files (the certificate of full payment is uploaded as one of them).
const NFIS_FIELDS = [
    { key: 'record_type', label: 'Kind of record', kind: 'select', options: NFIS_RECORD_TYPES, required: () => true },
    { key: 'institution', label: 'Reported by', kind: 'text', hint: 'Bank / institution' },
    { key: 'date_reported', label: 'Date reported', kind: 'date', required: () => true },
    { key: 'date_closed', label: 'Date closed / settled', kind: 'date' },
    { key: 'outstanding_balance', label: 'Outstanding balance', kind: 'money', show: (r) => !isCourt(r) },
    { key: 'settlement', label: 'Paid?', kind: 'select', options: SETTLEMENTS,
        show: (r) => NEEDS_SETTLEMENT.has(r.record_type), required: (r) => NEEDS_SETTLEMENT.has(r.record_type) },
    { key: 'full_payment_doc_id', label: 'Certificate of full payment', kind: 'file', show: settled,
        hint: 'Upload it as an NFIS file of this borrower, then pick it' },
    { key: 'returned_checks', label: 'No. of returned checks', kind: 'int', show: (r) => HAS_RETURNED_CHECKS.has(r.record_type) },
    { key: 'case_type', label: 'Kind of case', kind: 'select', options: CASE_TYPES, show: isCourt, required: isCourt },
    { key: 'case_reference', label: 'Case no. / court', kind: 'text', show: isCourt },
    { key: 'case_filed_by', label: 'Filed by', kind: 'text', show: isCourt, hint: 'Who filed it: a bank, a person, the government' },
    { key: 'amount_involved', label: 'Amount involved', kind: 'money', show: isCourt,
        required: (r) => Boolean(CASE_TYPES.find((c) => c.value === r.case_type)?.amountRequired) },
    { key: 'case_status', label: 'Case status', kind: 'select', options: CASE_STATUSES, show: isCourt },
    { key: 'remarks', label: 'Remarks', kind: 'text', wide: true, hint: 'Anything else the Credit Officer should know' },
];

const TU_FIELDS = [
    { key: 'is_open', label: 'Open or closed', kind: 'select', options: OPEN_CLOSED, required: () => true },
    { key: 'account_type', label: 'Account type', kind: 'text', required: () => true, hint: 'e.g. Credit card, Auto loan' },
    { key: 'lender_name', label: 'Lender', kind: 'text' },
    { key: 'lender_type', label: 'Lender type', kind: 'text', hint: 'e.g. Bank, Financing' },
    { key: 'ownership', label: 'Ownership', kind: 'select', options: TU_OWNERSHIP },
    { key: 'status', label: 'Status', kind: 'select', options: TU_STATUSES },
    { key: 'opened_on', label: 'Opened', kind: 'date' },
    { key: 'closed_on', label: 'Closed', kind: 'date', show: (r) => r.is_open === 'false' },
    { key: 'maturity_on', label: 'Maturity', kind: 'date' },
    { key: 'original_amount', label: 'Original loan amount', kind: 'money' },
    { key: 'credit_limit', label: 'Credit limit', kind: 'money' },
    { key: 'balance', label: 'Outstanding balance', kind: 'money' },
    { key: 'past_due', label: 'Past due now', kind: 'money' },
    { key: 'installment', label: 'Monthly installment', kind: 'money', hint: 'Cards: the payment amount' },
    { key: 'max_dpd', label: 'Max days past due', kind: 'int', hint: '0 if never late' },
    { key: 'legal_action', label: 'Legal action', kind: 'bool' },
];

export const FIELDS = { NFIS: NFIS_FIELDS, TU: TU_FIELDS };
export const NOUN = { NFIS: 'record', TU: 'account' };
export const shown = (f, row) => (f.show ? f.show(row) : true);
export const isRequired = (f, row) => (f.required ? f.required(row) : false);

// ---------- drafts <-> payloads ----------
let nextKey = 0;
// A saved row (or nothing, for a new one) as input strings
export const toDraft = (checkType, row = {}) => Object.fromEntries([
    ['_key', `r${nextKey++}`], ['id', row.id ?? null],
    ...FIELDS[checkType].map((f) => [f.key, row[f.key] === null || row[f.key] === undefined ? '' : String(row[f.key])]),
]);

const parse = (f, value) => {
    const v = value.trim();
    if (v === '') return null;
    if (f.kind === 'money') return Number(v.replaceAll(',', ''));
    if (f.kind === 'int' || f.kind === 'file') return Number(v);
    if (f.kind === 'bool' || f.key === 'is_open') return v === 'true';
    return v;
};
// What save_ci_card takes: hidden fields are sent empty, so a row never keeps a value it no longer shows
// A new row the AI filled is sent with from_ai: true (save_ci_card tags it with the AI run)
export const toPayload = (checkType, drafts) => drafts.map((d) => Object.fromEntries([
    ...(d.id ? [['id', d.id]] : d._fromAi ? [['from_ai', true]] : []),
    ...FIELDS[checkType].map((f) => [f.key, shown(f, d) ? parse(f, d[f.key]) : null]),
]));
export const rowsDirty = (checkType, drafts, savedRows) =>
    JSON.stringify(toPayload(checkType, drafts))
    !== JSON.stringify(toPayload(checkType, savedRows.map((r) => toDraft(checkType, r))));

// Problems the page can show before sending (the DB checks the same and more): bad numbers
export const rowProblems = (checkType, drafts) => drafts.flatMap((d, i) => FIELDS[checkType]
    .filter((f) => shown(f, d) && (f.kind === 'money' || f.kind === 'int') && d[f.key].trim() !== '')
    .filter((f) => {
        const n = Number(d[f.key].replaceAll(',', ''));
        return !Number.isFinite(n) || n < 0 || (f.kind === 'int' && !Number.isInteger(n));
    })
    .map((f) => `${NOUN[checkType][0].toUpperCase()}${NOUN[checkType].slice(1)} ${i + 1}: ${f.label} is not a valid number.`));

// ---------- one-line summary of a row (collapsed box, read-only list) ----------
const money = (v) => (v === '' || v === null || v === undefined ? null : formatPeso(v));
const day = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null);
export const rowSummary = (checkType, r) => {
    if (checkType === 'NFIS') {
        return [
            r.record_type ? labelFor(NFIS_RECORD_TYPES, r.record_type) : 'New record',
            r.institution || null,
            r.date_reported ? `reported ${day(r.date_reported)}` : null,
            isCourt(r) && r.case_type ? labelFor(CASE_TYPES, r.case_type) : null,
            isCourt(r) ? money(r.amount_involved) : money(r.outstanding_balance),
            NEEDS_SETTLEMENT.has(r.record_type) && r.settlement ? labelFor(SETTLEMENTS, r.settlement) : null,
        ].filter(Boolean).join(' · ');
    }
    const open = String(r.is_open);
    return [
        r.account_type || 'New account',
        r.lender_name || null,
        open === 'true' ? 'Open' : open === 'false' ? 'Closed' : null,
        money(r.balance) && `balance ${money(r.balance)}`,
        Number(r.max_dpd) > 0 ? `max ${r.max_dpd} days late` : null,
        Number(r.past_due) > 0 ? `${money(r.past_due)} past due` : null,
    ].filter(Boolean).join(' · ');
};

// ---------- "Run AI": what the AI read, as the same boxes the CI types in ----------
// check: one report's entry from fetchDocumentChecks ({ run, fields }); returns { result, summary, report_date, rows }
// as drafts (rows marked _fromAi, so a save tags them with the AI run). Only values that fit a box are taken: a date
// that isn't YYYY-MM-DD, a number that isn't one, or a status the list doesn't have is left empty for the CI.
// NFIS records aren't read by the AI yet (Part C): for NFIS it fills the result, summary and report date only.
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : '');
const num = (v) => {
    const n = Number(String(v ?? '').replaceAll(',', '').replace(/^₱|^PHP\s*/i, '').trim());
    return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(n) && n >= 0 ? String(n) : '';
};
const yesNo = (v) => (/^(y|yes|true)$/i.test(String(v ?? '').trim()) ? 'true'
    : /^(n|no|false)$/i.test(String(v ?? '').trim()) ? 'false' : '');
// TU prints the status as a code or a word
export const tuStatusOf = (printed, isOpen) => {
    const v = String(printed ?? '').trim();
    if (/written|w\/o|write/i.test(v)) return 'WRITTEN_OFF';
    if (/restruct/i.test(v)) return 'RESTRUCTURED';
    if (/legal|litig|collect/i.test(v)) return 'LEGAL';
    if (/past\s*due|delinq/i.test(v)) return 'PAST_DUE';
    if (/closed|^c$/i.test(v)) return 'CLOSED';
    if (/^(a|active|current|open)$/i.test(v)) return 'CURRENT';
    return isOpen === 'false' && v === '' ? 'CLOSED' : '';
};
const REPORT_DATE_KEY = { NFIS: 'date_reported', TU: 'report_date' };

export const aiToForm = (checkType, check) => {
    const fields = check?.fields ?? [];
    const header = Object.fromEntries(fields.filter((f) => !f.item_no).map((f) => [f.field_key, f.extracted_value]));
    const output = check?.run?.output ?? {};
    const rows = [];
    if (checkType === 'TU') {
        const byItem = {};
        for (const f of fields) {
            if (f.item_no && f.field_key.startsWith('acct_')) (byItem[f.item_no] ??= {})[f.field_key] = f.extracted_value;
        }
        for (const item of Object.keys(byItem).map(Number).sort((a, b) => a - b)) {
            const a = byItem[item];
            const section = String(a.acct_section ?? '').trim().toUpperCase();
            const isOpen = section.startsWith('OPEN') ? 'true' : section.startsWith('CLOSED') ? 'false' : '';
            rows.push({
                ...toDraft('TU'), _fromAi: true,
                is_open: isOpen,
                lender_type: a.acct_lender ?? '',
                account_type: a.acct_type ?? '',
                status: tuStatusOf(a.acct_status, isOpen),
                opened_on: isoDay(a.acct_opened),
                closed_on: isoDay(a.acct_closed),
                credit_limit: num(a.acct_credit_limit),
                balance: num(a.acct_balance),
                past_due: num(a.acct_past_due),
                installment: num(a.acct_installment),
                max_dpd: num(a.acct_max_dpd),
                legal_action: yesNo(a.acct_legal_action),
            });
        }
    }
    const proposed = ['NO_ADVERSE_FINDINGS', 'WITH_FINDINGS', 'INCONCLUSIVE'].includes(output.proposed_result)
        ? output.proposed_result : null;
    return {
        result: proposed,
        summary: String(output.findings_summary ?? '').trim(),
        report_date: isoDay(header[REPORT_DATE_KEY[checkType]]),
        rows,
    };
};
