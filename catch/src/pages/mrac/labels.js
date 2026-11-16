// Labels, tones and value formatting for an MRAC check result (used by mracResult.jsx and the Decision Support page)
import { formatPeso } from '../applicationForm/options';

export const STATUS = { pass: ['Pass', 'ok'], fail: ['Fails', 'bad'], needs_review: ['Needs review', 'warn'] };
export const OVERALL = {
    PASS: ['All enabled criteria pass', 'ok'],
    REVIEW: ['Needs review', 'warn'],
    FAIL: ['One or more criteria fail', 'bad'],
    NO_RULES: ['No automatic MRAC criteria apply yet', 'plain'],
};

export const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

// Money facts (same list as mrac-service reasoning.MONEY_FIELDS): ₱ and cents. A requirement like ">= 40000" from an
// earlier run becomes ">= ₱40,000.00"; anything else is shown as stored.
const MONEY_FIELDS = new Set(['loan_amount', 'total_gross_income', 'amortization', 'collateral_value', 'net_income_after_tax',
    'existing_monthly_debt']);
const isNum = (v) => v !== null && v !== '' && typeof v !== 'boolean' && !Number.isNaN(Number(v));
export const showFact = (field, v) => (MONEY_FIELDS.has(field) && isNum(v) ? formatPeso(v) : show(v));
export const showRequirement = (field, t) => {
    const m = MONEY_FIELDS.has(field) && typeof t === 'string' ? t.match(/^(<=|>=|<|>|==|!=) (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/) : null;
    return m ? `${m[1]} ${formatPeso(m[2])}` : show(t);
};
