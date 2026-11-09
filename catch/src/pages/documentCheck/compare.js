// What the AI read from a document vs what the applicant typed in, plus the checks shown next to each
// field (low OCR confidence, expired ID) and the per-document summaries (payslip average vs declared
// income, average monthly deposits, TU credit report vs the declared loans / cards). No Supabase calls here.

// Below this, PaddleOCR wasn't sure of a line: the AO should look at the document closely (P2)
export const LOW_CONFIDENCE = 0.85;

const clean = (s) => String(s ?? '').toUpperCase().replace(/[.,'"()\-/#]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => clean(s).split(' ').filter(Boolean);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

export const toNumber = (v) => {
    if (blank(v)) return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
};

// Same rules as confirm_extraction() in the migration, so the AO sees problems before confirming
export const isValid = (value, dataType) => {
    if (blank(value)) return true;
    const v = String(value).trim();
    switch (dataType) {
        case 'DATE': {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
            const d = new Date(`${v}T00:00:00Z`);
            return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        }
        case 'MONTH': return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
        case 'AMOUNT':
        case 'NUMBER': return toNumber(v) !== null;
        case 'SEX': return ['MALE', 'FEMALE'].includes(v.toUpperCase());
        default: return true;
    }
};

export const FORMAT_HINTS = { DATE: 'YYYY-MM-DD', MONTH: 'YYYY-MM', AMOUNT: 'e.g. 45000.00', NUMBER: 'a number' };

export const displayValue = (value, dataType) => {
    if (blank(value)) return '—';
    if (dataType === 'AMOUNT') {
        const n = toNumber(value);
        return n === null ? String(value)
            : `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (dataType === 'SEX') return { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }[String(value).toUpperCase()] ?? String(value);
    return String(value);
};

export const sameValue = (a, b, dataType) => {
    if (blank(a) || blank(b)) return false;
    if (dataType === 'AMOUNT' || dataType === 'NUMBER') {
        const x = toNumber(a);
        const y = toNumber(b);
        return x !== null && y !== null && Math.abs(x - y) < 0.005;
    }
    if (dataType === 'DATE' || dataType === 'MONTH') return String(a).trim().slice(0, 10) === String(b).trim().slice(0, 10);
    return clean(a) === clean(b);
};

export const fullName = (party) =>
    (party ? [party.first_name, party.middle_name, party.last_name, party.name_extension].filter(Boolean).join(' ') : '') || null;

const TITLES = new Set(['MR', 'MS', 'MRS', 'MISS', 'DR', 'ENGR', 'ATTY']);

// Full name on a document vs the borrower's record. First and last name must all be there; the middle
// name may be written in full, as an initial (CARLO MIGUEL S. VILLANUEVA) or left out.
export const nameMatches = (docName, party) => {
    if (!party) return false;
    const tokens = words(docName).filter((t) => !TITLES.has(t));
    const required = words(`${party.first_name ?? ''} ${party.last_name ?? ''}`);
    if (required.length === 0 || !required.every((t) => tokens.includes(t))) return false;
    const extension = words(party.name_extension);
    const middle = words(party.middle_name);
    const leftover = tokens.filter((t) => !required.includes(t) && !extension.includes(t));
    if (leftover.length === 0) return true;
    if (middle.length === 0) return false;
    return leftover.every((t) => middle.includes(t) || (t.length === 1 && middle.some((m) => m.startsWith(t))));
};

const ADDRESS_NOISE = new Set(['ST', 'STREET', 'BRGY', 'BARANGAY', 'CITY', 'OF', 'THE', 'UNIT', 'AVE', 'AVENUE',
    'RD', 'ROAD', 'PROVINCE', 'METRO', 'BLK', 'BLOCK', 'LOT', 'PHASE', 'SUBD', 'SUBDIVISION', 'VILLAGE', 'PHILIPPINES']);

// Addresses are written many ways, so this is only "looks similar": most of the meaningful words are shared
export const addressSimilar = (a, b) => {
    const x = new Set(words(a).filter((t) => !ADDRESS_NOISE.has(t)));
    const y = new Set(words(b).filter((t) => !ADDRESS_NOISE.has(t)));
    if (x.size === 0 || y.size === 0) return false;
    const shared = [...x].filter((t) => y.has(t)).length;
    return shared / Math.min(x.size, y.size) >= 0.7;
};

// Values derived from the record for extraction_field_defs.compare_with (compared only, never written)
const COMPARE_VALUES = {
    FULL_NAME: (ctx) => fullName(ctx.party),
    PRESENT_ADDRESS: (ctx) => ctx.presentAddress ?? null,
    DATE_OF_BIRTH: (ctx) => ctx.party?.date_of_birth ?? null,
    SEX: (ctx) => ctx.party?.gender ?? null,
    CIVIL_STATUS: (ctx) => ctx.party?.civil_status ?? null,
    DEPENDENTS: (ctx) => (ctx.party ? String(ctx.party.dependents?.length ?? 0) : null),
    LOAN_AMOUNT: (ctx) => ctx.loanAmount ?? null,
};

// ctx = { party, employment, presentAddress, loanAmount } of the borrower the document belongs to.
// undefined = this field has nothing in the application to compare with.
export const applicationValue = (def, ctx) => {
    if (def.target_table === 'applicants') return ctx.party?.[def.target_column] ?? null;
    if (def.target_table === 'employment_info') return ctx.employment?.[def.target_column] ?? null;
    if (COMPARE_VALUES[def.compare_with]) return COMPARE_VALUES[def.compare_with](ctx);
    return undefined;
};

// 'MATCH' | 'DIFFERS' | 'NOT_IN_APPLICATION' | 'NOT_ON_DOCUMENT' | null (nothing to compare)
export const compareStatus = (def, docValue, appValue, ctx) => {
    if (appValue === undefined) return null;
    if (blank(docValue)) return 'NOT_ON_DOCUMENT';
    if (blank(appValue)) return 'NOT_IN_APPLICATION';
    const same = def.compare_with === 'FULL_NAME' ? nameMatches(docValue, ctx.party)
        : def.compare_with === 'PRESENT_ADDRESS' ? addressSimilar(docValue, appValue)
            : sameValue(docValue, appValue, def.data_type);
    return same ? 'MATCH' : 'DIFFERS';
};

// The AO must pick "keep application" or "update application" before confirming
export const needsChoice = (def, status) =>
    Boolean(def.target_column) && (status === 'DIFFERS' || status === 'NOT_IN_APPLICATION');

export const lowestConfidence = (lines) =>
    (lines?.length ? Math.min(...lines.map((l) => Number(l.confidence))) : null);

export const isExpired = (value, asOf = new Date()) =>
    isValid(value, 'DATE') && !blank(value) && new Date(`${value}T23:59:59`) < asOf;

// Calendar months between the first and last month that have no row (e.g. a missing payslip month)
const missingMonths = (months) => {
    if (months.length < 2) return [];
    const [firstYear, firstMonth] = months[0].split('-').map(Number);
    const [lastYear, lastMonth] = months.at(-1).split('-').map(Number);
    const all = [];
    for (let i = firstYear * 12 + firstMonth - 1; i <= lastYear * 12 + lastMonth - 1; i += 1) {
        all.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
    }
    return all.filter((m) => !months.includes(m));
};

const monthOf = (row) => String(row.period_end || row.pay_date || row.period_start || row.month || '').slice(0, 7);

// rows = [{ field_key: value }]. Payslips: gross pay added up per calendar month, then averaged.
export const payslipSummary = (rows) => {
    const byMonth = {};
    for (const row of rows) {
        const amount = toNumber(row.gross_pay);
        const month = monthOf(row);
        if (amount === null || !/^\d{4}-\d{2}$/.test(month)) continue;
        byMonth[month] = (byMonth[month] ?? 0) + amount;
    }
    const months = Object.keys(byMonth).sort();
    if (months.length === 0) return null;
    const total = months.reduce((sum, m) => sum + byMonth[m], 0);
    return { months, byMonth, average: total / months.length, missing: missingMonths(months) };
};

// Bank statements: average monthly deposits (AMD) over the months with a deposit total
export const bankSummary = (rows) => {
    const byMonth = {};
    for (const row of rows) {
        const amount = toNumber(row.total_deposits);
        const month = String(row.month ?? '').slice(0, 7);
        if (amount === null || !/^\d{4}-\d{2}$/.test(month)) continue;
        byMonth[month] = (byMonth[month] ?? 0) + amount;
    }
    const months = Object.keys(byMonth).sort();
    if (months.length === 0) return null;
    const total = months.reduce((sum, m) => sum + byMonth[m], 0);
    return { months, byMonth, average: total / months.length, missing: missingMonths(months) };
};

// Percent difference of a documented amount from the declared one (null if either is missing)
export const percentOff = (documented, declared) => {
    const d = toNumber(declared);
    return documented === null || d === null || d === 0 ? null : ((documented - d) / d) * 100;
};

// ---------- TU credit report vs the application (P2 / P3: declared obligations, IDs) ----------

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const isYes = (v) => /^Y(ES)?$/i.test(String(v ?? '').trim());
const isCard = (row) => /CARD/i.test(row.acct_type ?? '');
export const isOpenAccount = (row) => !/CLOSED/i.test(`${row.acct_section ?? ''} ${row.acct_status ?? ''}`) && blank(row.acct_closed);

// A TU ID number vs the record's (TIN may carry a 3-digit branch code on one side)
const sameId = (a, b) => {
    const x = digits(a);
    const y = digits(b);
    if (x.length < 6 || y.length < 6) return false;
    return x === y || (Math.min(x.length, y.length) >= 9 && (x.startsWith(y) || y.startsWith(x)));
};

// What the report says the account owes / did wrong, in short phrases (empty = nothing adverse)
export const accountFlags = (row) => [
    toNumber(row.acct_past_due) > 0 && `past due ${displayValue(row.acct_past_due, 'AMOUNT')}`,
    toNumber(row.acct_max_dpd) > 0 && `up to ${toNumber(row.acct_max_dpd)} days past due${blank(row.acct_max_dpd_date) ? '' : ` (${row.acct_max_dpd_date})`}`,
    !blank(row.acct_late_months) && `late: ${row.acct_late_months}`,
    isYes(row.acct_legal_action) && 'legal action',
].filter(Boolean);

// header = { field_key: value }; groups = { accounts: [rows], ids: [rows], inquiries: [rows] };
// party = the borrower with existing_loans / credit_cards / tin / sss_no from the application.
export const tuSummary = (header, groups, party) => {
    const accounts = groups.accounts ?? [];
    const open = accounts.filter(isOpenAccount);
    const openCards = open.filter(isCard);
    const openLoans = open.filter((r) => !isCard(r));
    const declaredLoans = party?.existing_loans ?? [];
    const declaredCards = party?.credit_cards ?? [];

    // Each open TU loan is paired with a declared loan of about the same monthly payment (within 2% / ₱1)
    const unpaired = [...declaredLoans];
    const undeclaredLoans = openLoans.filter((row) => {
        const amount = toNumber(row.acct_installment);
        const i = amount === null ? -1 : unpaired.findIndex((l) =>
            Math.abs(Number(l.monthly_payment) - amount) <= Math.max(1, amount * 0.02));
        if (i === -1) return true;
        unpaired.splice(i, 1);
        return false;
    });
    const sum = (rows, get) => rows.reduce((total, r) => total + (toNumber(get(r)) ?? 0), 0);

    const idChecks = (groups.ids ?? []).flatMap((row) => {
        const type = String(row.id_type ?? '').toUpperCase();
        const column = /TIN/.test(type) ? 'tin' : /SSS/.test(type) ? 'sss_no' : null;
        if (!column || blank(row.id_number)) return [];
        const appValue = party?.[column] ?? null;
        const status = blank(appValue) ? 'NOT_IN_APPLICATION' : sameId(row.id_number, appValue) ? 'MATCH' : 'DIFFERS';
        return [{ type: column === 'tin' ? 'TIN' : 'SSS', number: row.id_number, appValue, status }];
    });

    const flags = [
        isYes(header.bcc_never_paid) && 'Never-paid flag: linked to a delinquent account with no payments',
        (isYes(header.bcc_fraud_address) || toNumber(header.bcc_fraud_address) > 0) && 'Inquiry address linked to an account blocked for fraud',
        (isYes(header.bcc_fraud_phone) || toNumber(header.bcc_fraud_phone) > 0) && 'Inquiry phone number linked to an account blocked for fraud',
        toNumber(header.revolving_past_due) > 0 && `Past due on revolving accounts: ${displayValue(header.revolving_past_due, 'AMOUNT')}`,
        toNumber(header.terms_past_due) > 0 && `Past due on loans: ${displayValue(header.terms_past_due, 'AMOUNT')}`,
    ].filter(Boolean);

    return {
        open, openCards, openLoans, declaredLoans, declaredCards, undeclaredLoans, idChecks, flags,
        adverse: accounts.map((row) => ({ row, flags: accountFlags(row) })).filter((a) => a.flags.length > 0),
        reportInstallments: sum(openLoans, (r) => r.acct_installment),
        declaredInstallments: sum(declaredLoans, (l) => l.monthly_payment),
        recentInquiries: toNumber(header.bcc_applications_6m),
    };
};
