// Financial Package & Credit Recommendation (KYC-FP "FP" tab), opened from the Credit Officer's work tray.
// Fields copied from the KYC are read live from the AO's record; the CO's own inputs are saved with
// save_financial_package(). Only the assigned CO edits (any stage before Decided); everyone else with access reads.
// Credit checking (BRAS / NFIS / TU) waits for the Credit Investigator's results, which aren't built yet.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchReviewAssignments } from '../review/api';
import { fetchAssignedAo, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveFinancialPackage } from './api';
import MessagesPanel from '../messages/messagesPanel';
import { computeFp, percent } from './compute';
import '../loanFolder/loanFolder.css';
import './financialPackage.css';
import { totalCreditScore } from './creditScore';
import {
    ApprovalSection, CashFlowSection, CollateralSection, CreditCheckingSection, CreditResultSection, CustomerSection, EmploymentSection,
    FacilitySection, HeaderSection, HighlightsSection, RowsSection, TermsSection, TitleSection,
} from './fpSections';
import {
    DEPOSIT_CHECK_FIELDS, EXCEPTION_FIELDS, FP_TABLES, LOAN_CHECK_FIELDS, OTHER_INFO_TEMPLATE, PACKAGE_DEFAULTS,
    TITLE_FIELDS, TITLE_KINDS, TRADE_CHECK_FIELDS, termsTemplate,
} from './options';

const PACKAGE_KEYS = ['date_prepared', 'dosri_rpt', 'variant', 'manner_of_repayment', 'hgc_eligibility',
    'date_of_enrollment', 'appraised_value', 'date_of_appraisal', 'other_information', 'statement_of_account',
    'terms_and_conditions', 'credit_result', 'justification', 'amendment', 'waiver_and_acceptance', 'deferrals'];
const PARTY_KEYS = ['income_basis', 'other_income', 'employment_remarks', 'cash_flow_remarks', 'other_information'];
const LISTS = {
    exceptions: EXCEPTION_FIELDS,
    deposit_checks: DEPOSIT_CHECK_FIELDS,
    loan_checks: LOAN_CHECK_FIELDS,
    trade_checks: TRADE_CHECK_FIELDS,
};

const formOf = (row, keys) => Object.fromEntries(keys.map((k) => [k, row?.[k] == null ? '' : String(row[k])]));
const isBlank = (row, keys) => keys.every((k) => row[k] === '' || row[k] == null);
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

const templateFor = (app, pricing) => termsTemplate({
    developer: one(app.referral_details)?.developer_name, rate: pricing.interest_rate, fixing: pricing.fixing_period,
});

// DB rows -> form state (strings, '' for nulls). A new FP starts from the sheet's defaults.
const buildForm = (app, saved) => {
    const pricing = formOf(app, ['interest_rate', 'fixing_period']);
    const pkg = saved.pkg ? formOf(saved.pkg, PACKAGE_KEYS)
        : { ...formOf({}, PACKAGE_KEYS), ...PACKAGE_DEFAULTS, date_prepared: today(), terms_and_conditions: templateFor(app, pricing) };
    const parties = Object.fromEntries(getParties(app, BORROWER_ROLES).map((p) => {
        const row = saved.parties.find((r) => r.applicant_id === p.id);
        return [p.id, row ? formOf(row, PARTY_KEYS) : { ...formOf({}, PARTY_KEYS), other_information: OTHER_INFO_TEMPLATE }];
    }));
    const listOf = (rows, config) => rows.map((r) => ({ id: r.id, ...formOf(r, Object.keys(config)) }));
    return {
        pkg,
        pricing,
        parties,
        exceptions: listOf(saved.exceptions, EXCEPTION_FIELDS),
        deposit_checks: listOf(saved.depositChecks, DEPOSIT_CHECK_FIELDS),
        loan_checks: listOf(saved.loanChecks, LOAN_CHECK_FIELDS),
        trade_checks: listOf(saved.tradeChecks, TRADE_CHECK_FIELDS),
        titles: Object.fromEntries(TITLE_KINDS.map((k) => {
            const row = saved.titles.find((t) => t.title_kind === k.value);
            return [k.value, { id: row?.id, ...formOf(row, Object.keys(TITLE_FIELDS)) }];
        })),
    };
};

// Form state -> save_financial_package() payload ('' -> null, blank list rows dropped)
const buildPayload = (form) => {
    const pkg = toRow(form.pkg);
    pkg.dosri_rpt = pkg.dosri_rpt === null ? null : pkg.dosri_rpt === 'true';
    const list = (key) => form[key]
        .filter((r) => !isBlank(r, Object.keys(LISTS[key])))
        .map(({ _key, ...r }) => toRow(r)); // eslint-disable-line no-unused-vars
    return {
        package: pkg,
        pricing: toRow(form.pricing),
        parties: Object.entries(form.parties).map(([id, p]) => ({ applicant_id: Number(id), ...toRow(p) })),
        exceptions: list('exceptions'),
        deposit_checks: list('deposit_checks'),
        loan_checks: list('loan_checks'),
        trade_checks: list('trade_checks'),
        titles: Object.entries(form.titles)
            .filter(([, t]) => t.id || !isBlank(t, Object.keys(TITLE_FIELDS)))
            .map(([kind, { id, ...t }]) => ({ title_kind: kind, ...toRow(t) })), // eslint-disable-line no-unused-vars
    };
};

// Section navigator: [group, [[element id, label], ...]]; the ids are set in fpSections.jsx
const TOC = [
    {
        group: 'Page 1: Recommendation',
        items: [['fp-general', 'General information'], ['fp-i', 'I. Borrower/s highlight'], ['fp-ii', 'II. Facility'],
            ['fp-iii', 'III. Collateral'], ['fp-iv', 'IV. Credit checking'], ['fp-v', 'V. Exceptions'],
            ['fp-vi', 'VI. Terms and conditions'], ['fp-vii', 'VII. Approval']],
    },
    {
        group: 'Page 2: Application information',
        items: [['fp-viii', 'VIII. Employment'], ['fp-ix', 'IX. Cash flow'], ['fp-x', 'X. Deposit checking'],
            ['fp-xi', 'XI. Loan verification'], ['fp-xii', 'XII. Trade checking'], ['fp-xiii', 'XIII. Title'],
            ['fp-xiv', 'XIV. Customer information']],
    },
    { group: 'Result', items: [['fp-result', 'Credit result'], ['fp-history', 'Change history']] },
];
const TOC_IDS = TOC.flatMap((g) => g.items.map(([id]) => id));

// The section nearest the top of the viewport, for the navigator's highlight
const useActiveSection = (ready) => {
    const [active, setActive] = useState(TOC_IDS[0]);
    useEffect(() => {
        if (!ready) return undefined;
        const observer = new IntersectionObserver((entries) => {
            const top = entries.filter((e) => e.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            if (top) setActive(top.target.id);
        }, { rootMargin: '-10% 0px -70% 0px' });
        TOC_IDS.forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
        return () => observer.disconnect();
    }, [ready]);
    return active;
};

const FinancialPackagePage = () => {
    const { role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [savedScore, setSavedScore] = useState({}); // { [criterion]: { band } }, for the header's risk rating
    const [routing, setRouting] = useState({ tier: null, rows: [], names: {} }); // VII. Approval
    const [form, setForm] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [aoName, setAoName] = useState(null);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Saved FP + its change history (+ the staff names in it)
    const loadFp = useCallback(async (record) => {
        const ids = getParties(record, BORROWER_ROLES).map((p) => p.id);
        const [savedFp, log, aoId, reviewRows] = await Promise.all([
            fetchFinancialPackage(record.id, ids), fetchAuditLog(record.id), fetchAssignedAo(record.id),
            fetchReviewAssignments(record.id)]);
        const fpLog = log.filter((e) => FP_TABLES.includes(e.table_name)
            || (e.table_name === 'loan_applications' && ('interest_rate' in (e.new_data ?? {}) || 'fixing_period' in (e.new_data ?? {}))));
        const staff = await fetchStaffNames([aoId, ...fpLog.map((e) => e.changed_by),
            ...reviewRows.filter((r) => !r.unassigned_at).map((r) => r.user_id)]);
        setForm(buildForm(record, savedFp));
        setSavedScore(Object.fromEntries(savedFp.creditScore.map((r) => [r.criterion, r])));
        setRouting({ tier: savedFp.pkg?.approval_tier ?? null, rows: reviewRows, names: staff });
        setAudit(fpLog);
        setNames(staff);
        setAoName(aoId ? staff[aoId] ?? 'Account Officer' : null);
        setDirty(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [record, editable, scoreRules] = await Promise.all([
                    fetchApplication(applicationId), fetchCoCanEdit(applicationId), fetchCreditScoreRules()]);
                if (cancelled) return;
                setApp(record);
                setRules(scoreRules);
                setCanEdit(editable);
                await loadFp(record);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadFp]);

    const computed = useMemo(() => (app && form ? computeFp(app, form.parties, form.pkg, form.pricing) : null),
        [app, form]);
    // Saved credit score (scored on its own page)
    const score = useMemo(() => (rules ? totalCreditScore(rules, savedScore) : null), [rules, savedScore]);
    const activeId = useActiveSection(Boolean(app && form && rules));

    if (loading) return <p>Loading financial package...</p>;
    if (error && !form) return <p className="text-red-600">{error}</p>;
    if (!app || !form || !rules) return null;

    const disabled = !canEdit || saving;
    const change = (next) => {
        setForm(next);
        setDirty(true);
        setSaved(false);
    };
    const onPkg = (field, value) => change({ ...form, pkg: { ...form.pkg, [field]: value } });
    const onPricing = (field, value) => change({ ...form, pricing: { ...form.pricing, [field]: value } });
    const onParty = (id, field, value) =>
        change({ ...form, parties: { ...form.parties, [id]: { ...form.parties[id], [field]: value } } });
    const onList = (key) => (rows) => change({ ...form, [key]: rows });
    const onTitle = (kind, field, value) =>
        change({ ...form, titles: { ...form.titles, [kind]: { ...form.titles[kind], [field]: value } } });
    const resetTerms = () => onPkg('terms_and_conditions', templateFor(app, form.pricing));
    // The score and VII. Approval pages read the saved FP (income basis, rate, appraised value, credit result),
    // so unsaved edits would be lost
    const confirmLeave = (e) => {
        if (dirty && !window.confirm('The Financial Package has unsaved changes. Leave without saving?')) e.preventDefault();
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (form.pkg.credit_result && !form.pkg.justification.trim()) {
            setError('Add a justification for the credit result.');
            return;
        }
        setSaving(true);
        try {
            setError(null);
            await saveFinancialPackage(app.id, buildPayload(form));
            await loadFp(app);
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const kycBankAccounts = getParties(app, BORROWER_ROLES).flatMap((p) => (p.bank_accounts ?? []).map((b) => ({ party: p, ...b })));
    const kycLoans = computed.existingLoans;

    const pesoOf = (v) => (v === null || v === undefined ? '—' : `₱${formatMoney(v)}`);
    const metrics = [
        {
            key: 'risk', label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'info' : 'warn', link: [`/creditScorePage?id=${app.id}`, 'Open scoring'],
        },
        { key: 'dbr', label: 'Debt burden ratio', value: percent(computed.dbr) ?? '—', sub: 'DBR', tone: 'plain' },
        { key: 'lcr', label: 'Loan-to-collateral', value: percent(computed.lcr) ?? '—', sub: 'LCR', tone: 'plain' },
        {
            key: 'amort', label: 'Monthly amortization', value: pesoOf(computed.amortization),
            sub: computed.amortization === null ? 'Needs the interest rate' : 'New loan', tone: 'plain',
        },
        {
            key: 'income', label: 'Combined gross income', value: pesoOf(computed.totalGross),
            sub: computed.totalGross === null ? 'Pick every income basis' : 'Per month', tone: 'plain',
        },
    ];

    const goTo = (id) => (e) => {
        e.preventDefault();
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    };

    return (
        <form onSubmit={handleSave} className="lf fp">
            <header className="lf-card">
                <Link to="/adminHomePage" className="lf-back"><ArrowLeft size={16} aria-hidden="true" />Work tray</Link>
                <div className="lf-titlerow">
                    <div>
                        <h1>Financial Package {app.application_no}</h1>
                        <ul className="lf-meta">
                            <li>Financial Package and Credit Recommendation, Housing Loans</li>
                            {aoName && <li>Handling Account Officer: {aoName}</li>}
                        </ul>
                    </div>
                    <div className="lf-actions">
                        <MessagesPanel applicationId={app.id} inline />
                        <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn">
                            Loan folder<ArrowRight size={16} aria-hidden="true" />
                        </Link>
                    </div>
                </div>

                <div className="fp-metrics">
                    {metrics.map((m) => (
                        <div key={m.key} className={`fp-metric ${m.tone}`}>
                            <span className="lbl">{m.label}</span>
                            <span className="val">{m.value}</span>
                            <span className="sub">{m.sub}</span>
                            {m.link && <Link to={m.link[0]} onClick={confirmLeave} className="more">{m.link[1]}</Link>}
                        </div>
                    ))}
                </div>

                {!canEdit && (
                    <p className="lf-note">
                        <Lock size={16} aria-hidden="true" />
                        <span>
                            Read-only. Only the assigned Credit Officer can edit the Financial Package.
                            {role === 'CREDIT_OFFICER' && ' Assign yourself in the work tray to edit.'}
                        </span>
                    </p>
                )}
            </header>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Financial Package sections">
                    {TOC.map(({ group, items }) => (
                        <div key={group}>
                            <p className="fp-navgroup">{group}</p>
                            <ul>
                                {items.map(([id, label]) => (
                                    <li key={id}>
                                        <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>
                                            {label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>

                <div className="lf-main fp-main">
                    <HeaderSection app={app} aoName={aoName} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                    <HighlightsSection app={app} computed={computed} />
                    <FacilitySection app={app} computed={computed} form={form.pkg} pricing={form.pricing}
                        onPkg={onPkg} onPricing={onPricing} disabled={disabled} />
                    <CollateralSection app={app} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                    <CreditCheckingSection app={app} />
                    <RowsSection id="fp-v" title="V. Exception/s" config={EXCEPTION_FIELDS} rows={form.exceptions}
                        onChange={onList('exceptions')} disabled={disabled} />
                    <TermsSection form={form.pkg} onPkg={onPkg} onReset={resetTerms} disabled={disabled} />
                    <ApprovalSection tier={routing.tier} rows={routing.rows} names={routing.names}
                        link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} />

                    <h2 className="fp-pagehead">Page 2: Credit Application Information</h2>
                    <EmploymentSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
                    <CashFlowSection computed={computed} details={form.parties} onParty={onParty} disabled={disabled} />
                    <RowsSection id="fp-x" title="X. Deposit Checking" config={DEPOSIT_CHECK_FIELDS} rows={form.deposit_checks}
                        onChange={onList('deposit_checks')} disabled={disabled}>
                        <p className="fp-note">Bank accounts declared in the KYC:{' '}
                            {kycBankAccounts.length === 0 ? 'none.' : kycBankAccounts.map((b) =>
                                `${partyLabel(b.party)}: ${b.bank_name} ${b.account_type} ${b.account_number}`).join('; ')}
                        </p>
                    </RowsSection>
                    <RowsSection id="fp-xi" title="XI. Loan Verification (Based on Loandex and Disclosure)" config={LOAN_CHECK_FIELDS}
                        rows={form.loan_checks} onChange={onList('loan_checks')} disabled={disabled}>
                        <p className="fp-note">Existing loans declared in the KYC:{' '}
                            {kycLoans.length === 0 ? 'none.' : kycLoans.map((l) =>
                                `${partyLabel(l.party)}: ${l.loan_type} with ${l.lending_institution}, ₱${formatMoney(l.monthly_payment)} / month`).join('; ')}
                        </p>
                    </RowsSection>
                    <RowsSection id="fp-xii" title="XII. Trade Checking (if applicable)" config={TRADE_CHECK_FIELDS} rows={form.trade_checks}
                        onChange={onList('trade_checks')} disabled={disabled} />
                    <TitleSection titles={form.titles} onTitle={onTitle} disabled={disabled} />
                    <CustomerSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
                    <CreditResultSection form={form.pkg} onPkg={onPkg} disabled={disabled} />

                    <section id="fp-history" className="lf-card">
                        <div className="lf-cardhead"><h2>FP change history</h2></div>
                        {audit.length === 0 ? <p className="fp-empty">No changes yet.</p> : <ChangeHistory app={app} entries={audit} names={names} />}
                    </section>

                    {canEdit ? (
                        <div className="fp-savebar">
                            <div className="state" role="status">
                                {dirty && <span className="fp-chip warn">Unsaved changes</span>}
                                {saved && !dirty && <span className="fp-chip ok">Saved</span>}
                                <FormError error={error} />
                            </div>
                            <button type="submit" disabled={saving || !dirty}>
                                {saving ? 'Saving...' : 'Save Financial Package'}
                            </button>
                        </div>
                    ) : <FormError error={error} />}
                </div>
            </div>
        </form>
    );
};

export default FinancialPackagePage;
