// Changes made to the application after submission (audit_log), newest first, as a timeline.
// The first "from" value of a field is what the applicant originally submitted.
// Also used by the Financial Package, Credit score and Review summary pages. Styles: .lf-tl in loanFolder.css
// tools (the loan folder): a search box (every word must appear in the change: what, who, when, field names or
// values; matches are highlighted), Action / Area / Changed by filters (the work tray's FilterSelect), a result count,
// and paging (25 at a time) so a long history doesn't fill the page.
import { useDeferredValue, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { formatPeso, partyLabel } from '../applicationForm/options';
import { Terms } from '../../components/term';
import FilterSelect from '../workTray/filterSelect';
import Byline from '../../components/byline';
import { formatWhen, fullWhen, personName } from '../../components/people';
import '../workTray/workTray.css'; // the dropdown's menu styles (.wt-fsel)

const TABLE_LABELS = {
    loan_applications: 'Loan details',
    applicants: 'Borrower',
    addresses: 'Address',
    employment_info: 'Employment',
    dependents: 'Dependent',
    bank_accounts: 'Bank account',
    existing_loans: 'Existing loan',
    credit_cards: 'Credit card',
    character_references: 'Character reference',
    collateral_details: 'Collateral',
    referral_details: 'Referral',
    documents: 'Document',
    application_requirements: 'Document requirement',
    financial_packages: 'Financial Package',
    fp_party_details: 'FP borrower details',
    fp_exceptions: 'FP exception',
    fp_deposit_checks: 'FP deposit check',
    fp_loan_checks: 'FP loan verification',
    fp_trade_checks: 'FP trade check',
    fp_title_verifications: 'FP title verification',
    credit_score_entries: 'Credit score',
    review_assignments: 'Reviewer / approver',
    review_decisions: 'Review sign-off / return',
    approval_decisions: 'Approver decision',
    ci_requests: 'CI request',
    ci_checks: 'CI result',
    ci_documents: 'CI report file',
    extraction_runs: 'AI document extraction',
    ci_finding_flags: 'CI findings flag',
    document_file_marks: 'Staff check of a file',
};

const ACTION_LABELS = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };
const ACTION_CLASS = { INSERT: 'add', UPDATE: 'chg', DELETE: 'del' };
const ACTION_OPTIONS = [
    { value: 'ALL', label: 'All actions' },
    { value: 'INSERT', label: 'Added' },
    { value: 'UPDATE', label: 'Changed' },
    { value: 'DELETE', label: 'Removed' },
];
const PAGE = 25;

// Keys and bookkeeping columns aren't useful to show
const HIDDEN = new Set(['id', 'application_id', 'applicant_id', 'requirement_id', 'file_path', 'uploaded_by',
    'assigned_by', 'assigned_at', 'unassigned_by', 'assignment_id', 'responded_by']);
// Columns holding a staff user id: shown by name (`names` must include them)
const STAFF_FIELDS = new Set(['user_id', 'confirmed_by']);
// Money columns (numeric(12/14,2)): shown with ₱ and cents
const MONEY_FIELDS = new Set(['loan_amount', 'gross_monthly_income', 'monthly_rent', 'selling_price', 'monthly_payment',
    'credit_limit', 'appraised_value', 'other_income', 'amd', 'adb', 'original_loan', 'outstanding_balance', 'amortization']);

const fieldLabel = (key) => (key === 'confirmed_by' ? 'Confirmed by' : STAFF_FIELDS.has(key) ? 'Staff'
    : key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()));
const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));
const showMoney = (value) => (value === null || value === undefined || value === '' || Number.isNaN(Number(value))
    ? show(value) : formatPeso(value));

// Whose record a row belongs to (principal, spouse, co-borrower n, ...), when it still exists
const ownerLabel = (entry, app) => {
    const data = entry.new_data ?? entry.old_data ?? {};
    if (entry.table_name === 'applicants' && data.role) return partyLabel(data);
    const party = app.applicants?.find((a) => a.id === data.applicant_id);
    return party ? partyLabel(party) : null;
};

// One entry ready to show and to search
const describe = (e, app, names) => {
    const data = e.action === 'DELETE' ? e.old_data : e.new_data;
    // Rows written by functions (e.g. AI extraction runs) carry only new values
    const diff = e.action === 'UPDATE' && e.old_data;
    const fields = Object.keys(data ?? {}).filter((k) => !HIDDEN.has(k)
        && (diff || (data[k] !== null && data[k] !== '')));
    const value = (k, v) => (MONEY_FIELDS.has(k) ? showMoney(v) : show(STAFF_FIELDS.has(k) ? names[v] ?? v : v));
    const area = TABLE_LABELS[e.table_name] ?? e.table_name;
    const what = [ownerLabel(e, app), area].filter(Boolean).join(' · ');
    const who = personName(names[e.changed_by]) || 'unknown';
    // searchable as shown and as the full date ("Today, 2:07 PM" and "Monday, November 16, 2026 at 2:07 PM")
    const when = `${formatWhen(e.changed_at)} ${fullWhen(e.changed_at)}`;
    const lines = fields.map((k) => ({
        k, label: fieldLabel(k),
        old: diff ? value(k, e.old_data[k]) : null,
        now: diff ? value(k, e.new_data[k]) : value(k, data[k]),
    }));
    const text = [ACTION_LABELS[e.action], what, who, when, ...lines.flatMap((l) => [l.label, l.old, l.now])]
        .filter(Boolean).join(' ').toLowerCase();
    return { e, diff, area, what, who, when, lines, text };
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Wraps each search word found in the text in <mark>
const Hi = ({ text, terms }) => {
    if (!terms.length) return text;
    const parts = String(text).split(new RegExp(`(${terms.map(escape).join('|')})`, 'gi'));
    return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
};

const ChangeHistory = ({ app, entries, names, tools = false }) => {
    const [query, setQuery] = useState('');
    const [action, setAction] = useState('ALL');
    const [area, setArea] = useState('ALL');
    const [person, setPerson] = useState('ALL');
    const [limit, setLimit] = useState(PAGE);
    const typed = useDeferredValue(query);

    if (entries.length === 0) return <p className="lf-empty">No changes since the applicant submitted.</p>;

    const rows = entries.map((e) => describe(e, app, names));
    const terms = tools ? typed.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
    const shown = tools ? rows.filter((r) => (action === 'ALL' || r.e.action === action)
        && (area === 'ALL' || r.area === area)
        && (person === 'ALL' || (r.e.changed_by ?? 'NONE') === person)
        && terms.every((t) => r.text.includes(t))) : rows;
    const visible = tools ? shown.slice(0, limit) : shown;
    const filtered = tools && (terms.length > 0 || action !== 'ALL' || area !== 'ALL' || person !== 'ALL');

    const areaOptions = [{ value: 'ALL', label: 'All areas' },
        ...[...new Set(rows.map((r) => r.area))].sort().map((a) => ({ value: a, label: a }))];
    const personOptions = [{ value: 'ALL', label: 'Anyone' },
        ...[...new Set(entries.map((e) => e.changed_by ?? 'NONE'))].map((id) => ({ value: id, label: names[id] ?? 'unknown' }))];
    // Any change of search or filter starts the list again from the top
    const set = (setter) => (v) => { setter(v); setLimit(PAGE); };
    const clear = () => { setQuery(''); setAction('ALL'); setArea('ALL'); setPerson('ALL'); setLimit(PAGE); };
    const plural = (n) => `${n} ${n === 1 ? 'change' : 'changes'}`;

    return (
        <>
            {tools && (
                <div className="lf-tl-tools">
                    <div className="lf-tl-search">
                        <Search size={16} aria-hidden="true" />
                        <input type="search" aria-label="Search changes" placeholder="Search fields, values or people"
                            value={query} onChange={(e) => set(setQuery)(e.target.value)} />
                    </div>
                    <div className="lf-tl-filters">
                        <FilterSelect label="Action" value={action} options={ACTION_OPTIONS} onChange={set(setAction)} active={action !== 'ALL'} />
                        <FilterSelect label="Area" value={area} options={areaOptions} onChange={set(setArea)} active={area !== 'ALL'} />
                        <FilterSelect label="Changed by" value={person} options={personOptions} onChange={set(setPerson)} active={person !== 'ALL'} />
                        {filtered && <button type="button" className="lf-tl-clear" onClick={clear}>Clear</button>}
                    </div>
                    <p className="lf-tl-count" role="status">
                        {filtered ? <><b>{shown.length}</b> of {plural(rows.length)}</> : plural(rows.length)}
                    </p>
                </div>
            )}

            {shown.length === 0 ? (
                <p className="lf-empty">
                    No changes match.{' '}
                    <button type="button" className="lf-linkbtn" onClick={clear}>Clear search and filters</button>
                </p>
            ) : (
                <ol className="lf-tl">
                    {visible.map((r) => (
                        <li key={r.e.id} className={`lf-tl-item ${ACTION_CLASS[r.e.action] ?? 'chg'}`}>
                            <span className="lf-tl-dot" aria-hidden="true" />
                            <p className="lf-tl-head">
                                <span className="lf-tl-act">{ACTION_LABELS[r.e.action]}</span>{' '}
                                <span className="lf-tl-what">
                                    {terms.length ? <Hi text={r.what} terms={terms} /> : <Terms text={r.what} />}
                                </span>
                            </p>
                            <Byline layout="inline" name={names[r.e.changed_by]} fallback="unknown" at={r.e.changed_at} className="lf-tl-by" />
                            {r.lines.length > 0 && (
                                <dl className="lf-tl-fields">
                                    {r.lines.map((l) => (
                                        <div key={l.k}>
                                            <dt><Hi text={l.label} terms={terms} /></dt>
                                            <dd>
                                                {r.diff ? (
                                                    <>
                                                        <span className="old"><Hi text={l.old} terms={terms} /></span>
                                                        <ArrowRight size={13} className="to" aria-hidden="true" />
                                                        <span className="sr-only"> changed to </span>
                                                        <span className="new"><Hi text={l.now} terms={terms} /></span>
                                                    </>
                                                ) : <Hi text={l.now} terms={terms} />}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </li>
                    ))}
                </ol>
            )}

            {tools && shown.length > visible.length && (
                <button type="button" className="lf-tl-more" onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, shown.length - visible.length)} more
                    <span className="rest">({shown.length - visible.length} left)</span>
                </button>
            )}
        </>
    );
};

export default ChangeHistory;
