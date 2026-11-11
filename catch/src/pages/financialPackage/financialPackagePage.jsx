// Financial Package & Credit Recommendation (KYC-FP "FP" tab), opened from the Credit Officer's work tray.
// Fields copied from the KYC are read live from the AO's record; the CO's own inputs are saved with
// save_financial_package(). Only the assigned CO edits (any stage before Decided); everyone else with access reads.
// IV. Credit checking shows the Credit Investigator's results (BRAS / NFIS / TU), read-only.
// Two pages, like the paper FP: 1 = the recommendation (I to VII), 2 = the application information (VIII onwards, the
// credit result and the change history). Both stay mounted inside ONE form (the inactive one is hidden), so switching
// keeps every edit, the policy check result and the single Save button; the page is kept in ?page=2.
import { FinancialPackageSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, ChevronDown, Lock, ScrollText, ShieldCheck } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchReviewAssignments } from '../review/api';
import { ReturnNotice } from '../review/returnNotice';
import { fetchAssignedAo, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveFinancialPackage } from './api';
import MessagesPanel from '../messages/messagesPanel';
import MracPanel from '../mrac/mracPanel';
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

// The two pages (tabs above the form)
const PAGES = [
    { n: 1, title: 'Recommendation', sub: 'Sections I to VII' },
    { n: 2, title: 'Application information', sub: 'Section VIII onwards, credit result' },
];

// Section navigator for the page being shown: [group, page, [[element id, label], ...]]; the ids are set in fpSections.jsx
const TOC = [
    {
        page: 1, group: 'Page 1: Recommendation',
        items: [['fp-general', 'General information'], ['fp-i', 'I. Borrower/s highlight'], ['fp-ii', 'II. Facility'],
            ['fp-iii', 'III. Collateral'], ['fp-iv', 'IV. Credit checking'], ['fp-v', 'V. Exceptions'], ['fp-mrac', 'Policy check (MRAC)'],
            ['fp-vi', 'VI. Terms and conditions'], ['fp-vii', 'VII. Approval']],
    },
    {
        page: 2, group: 'Page 2: Application information',
        items: [['fp-viii', 'VIII. Employment'], ['fp-ix', 'IX. Cash flow'], ['fp-x', 'X. Deposit checking'],
            ['fp-xi', 'XI. Loan verification'], ['fp-xii', 'XII. Trade checking'], ['fp-xiii', 'XIII. Title'],
            ['fp-xiv', 'XIV. Customer information']],
    },
    { page: 2, group: 'Result', items: [['fp-result', 'Credit result'], ['fp-history', 'Change history']] },
];
// The sections the credit decision rests on: set apart in the navigator and marked on the page (.fp-key in fpSections.jsx
// and mracPanel.jsx). The icon doubles as the marker, so the emphasis doesn't rest on colour alone.
const KEY_ICONS = { 'fp-mrac': ShieldCheck, 'fp-vi': ScrollText, 'fp-vii': BadgeCheck };
const NavIcon = ({ id }) => {
    const Icon = KEY_ICONS[id];
    return Icon ? <Icon size={16} aria-hidden="true" /> : null;
};

const idsOfPage = (page) => TOC.filter((g) => g.page === page).flatMap((g) => g.items.map(([id]) => id));

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The section nearest the top of the viewport (of the page being shown), for the navigator's highlight
const useActiveSection = (ids, ready) => {
    const [active, setActive] = useState(ids[0]);
    const key = ids.join(',');
    useEffect(() => {
        if (!ready) return undefined;
        const observer = new IntersectionObserver((entries) => {
            const top = entries.filter((e) => e.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            if (top) setActive(top.target.id);
        }, { rootMargin: '-10% 0px -70% 0px' });
        key.split(',').forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
        return () => observer.disconnect();
    }, [ready, key]);
    // Right after a page switch the highlight still points at the other page: use the first section until a scroll
    return ids.includes(active) ? active : ids[0];
};

const FinancialPackagePage = () => {
    const { role } = UserAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const page = searchParams.get('page') === '2' ? 2 : 1;
    const formRef = useRef(null);
    const tabsRef = useRef(null);
    const scrollToTabs = useRef(false); // set by a page switch: bring the tabs into view once the new page is showing
    const revalidate = useRef(false);   // set when Save found a missing field on the other page

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
    const activeId = useActiveSection(idsOfPage(page), Boolean(app && form && rules));

    // After a switch: show the new page from its tabs (not jumped to the very top), or, when Save sent us here because a
    // required field on this page is empty, let the browser point at that field now that it is visible
    useEffect(() => {
        if (revalidate.current) {
            revalidate.current = false;
            formRef.current?.reportValidity();
        } else if (scrollToTabs.current) {
            tabsRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
        scrollToTabs.current = false;
    }, [page]);

    if (loading) return <FinancialPackageSkeleton />;
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
            // Interest rate / fixing period live on loan_applications, so refetch it or the form reverts to the old values
            const record = await fetchApplication(app.id);
            setApp(record);
            await loadFp(record);
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
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) target.open = true; // the change history is a dropdown
        target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    };

    // Switch page without leaving the form (the page is only a view of the same state). replace: no history entry per tab.
    const showPage = (n, { scroll = true } = {}) => {
        if (n === page) return;
        scrollToTabs.current = scroll;
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (n === 1) next.delete('page'); else next.set('page', String(n));
            return next;
        }, { replace: true });
    };

    // Arrow keys move between the tabs (the tab pattern)
    const onTabKey = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const n = e.key === 'ArrowRight' ? 2 : 1;
        showPage(n, { scroll: false });
        document.getElementById(`fp-tab-${n}`)?.focus();
    };

    // The browser can't point at an empty required field on the hidden page: switch to it, then ask again (effect above)
    const onInvalid = (e) => {
        const target = Number(e.target.closest?.('[data-fp-page]')?.dataset.fpPage ?? page);
        if (target === page) return;
        e.preventDefault();
        revalidate.current = true;
        showPage(target, { scroll: false });
    };

    return (
        <form ref={formRef} onSubmit={handleSave} onInvalidCapture={onInvalid} className="lf fp">
            <Breadcrumbs current="package" appId={app.id} appNo={app.application_no} />
            <header className="lf-card">
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
                        {/* The same page as VII. Approval's button: it reads the saved FP, so warn about unsaved edits */}
                        <Link to={`/approvalRoutingPage?id=${app.id}`} onClick={confirmLeave} className="lf-btn">
                            <BadgeCheck size={16} aria-hidden="true" />Approval routing
                        </Link>
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

            <ReturnNotice applicationId={app.id} link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} />

            <div ref={tabsRef} className="fp-pagetabs" role="tablist" aria-label="Financial Package pages" onKeyDown={onTabKey}>
                {PAGES.map((p) => (
                    <button key={p.n} type="button" role="tab" id={`fp-tab-${p.n}`} aria-controls={`fp-page-${p.n}`}
                        aria-selected={page === p.n} tabIndex={page === p.n ? 0 : -1} onClick={() => showPage(p.n)}>
                        <b>Page {p.n}: {p.title}</b>
                        <span>{p.sub}</span>
                    </button>
                ))}
            </div>

            <div className="lf-body edit">
                <nav className="lf-card lf-nav fp-nav" aria-label="Financial Package sections">
                    {TOC.filter((g) => g.page === page).map(({ group, items }) => {
                        const link = ([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>
                                    <NavIcon id={id} />
                                    <span>{label}</span>
                                </a>
                            </li>
                        );
                        const regular = items.filter(([id]) => !KEY_ICONS[id]);
                        const key = items.filter(([id]) => KEY_ICONS[id]);
                        return (
                            <div key={group}>
                                <p className="fp-navgroup">{group}</p>
                                <ul>{regular.map(link)}</ul>
                                {key.length > 0 && (
                                    <div className="fp-navkey" role="group" aria-labelledby="fp-navkey-title">
                                        <p id="fp-navkey-title" className="fp-navkey-title">Key to the decision</p>
                                        <ul>{key.map(link)}</ul>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                <div className="lf-main fp-main">
                    {/* Page 1: the recommendation (I to VII) */}
                    <div id="fp-page-1" role="tabpanel" aria-labelledby="fp-tab-1" data-fp-page="1" hidden={page !== 1} className="fp-page">
                        <HeaderSection app={app} aoName={aoName} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                        <HighlightsSection app={app} computed={computed} />
                        <FacilitySection app={app} computed={computed} form={form.pkg} pricing={form.pricing}
                            onPkg={onPkg} onPricing={onPricing} disabled={disabled} />
                        <CollateralSection app={app} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                        <CreditCheckingSection app={app} />
                        <RowsSection id="fp-v" title="V. Exception/s" config={EXCEPTION_FIELDS} rows={form.exceptions}
                            onChange={onList('exceptions')} disabled={disabled} />
                        <MracPanel app={app} computed={computed} score={score} pricing={form.pricing}
                            exceptions={form.exceptions} canEdit={canEdit}
                            onAddException={(row) => onList('exceptions')([...form.exceptions, { _key: crypto.randomUUID(), ...row }])} />
                        <TermsSection form={form.pkg} onPkg={onPkg} onReset={resetTerms} disabled={disabled} />
                        <ApprovalSection tier={routing.tier} rows={routing.rows} names={routing.names}
                            link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} />
                        <div className="fp-pagenav">
                            <button type="button" onClick={() => showPage(2)}>
                                Next: Page 2, Application information<ArrowRight size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* Page 2: the application information (VIII onwards), the credit result and the history */}
                    <div id="fp-page-2" role="tabpanel" aria-labelledby="fp-tab-2" data-fp-page="2" hidden={page !== 2} className="fp-page">
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

                        {/* A dropdown, closed until opened (same look as the loan folder's); the navigator link opens it */}
                        <details id="fp-history" className="lf-card lf-history">
                            <summary>
                                <h2>FP change history</h2>
                                <span className="lf-history-count">{audit.length} {audit.length === 1 ? 'entry' : 'entries'}</span>
                                <ChevronDown size={18} className="lf-history-chevron" aria-hidden="true" />
                            </summary>
                            {audit.length === 0 ? <p className="fp-empty">No changes yet.</p> : <ChangeHistory app={app} entries={audit} names={names} />}
                        </details>
                        <div className="fp-pagenav">
                            <button type="button" className="back" onClick={() => showPage(1)}>
                                <ArrowLeft size={16} aria-hidden="true" />Back to Page 1, Recommendation
                            </button>
                        </div>
                    </div>

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
