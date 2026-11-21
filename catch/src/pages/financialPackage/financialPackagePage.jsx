// Financial Package & Credit Recommendation (KYC-FP "FP" tab), opened from the Credit Officer's work tray.
// Fields copied from the KYC are read live from the AO's record; the CO's own inputs are saved with
// save_financial_package(). Only the assigned CO edits (any stage before Decided); everyone else with access reads.
// IV. Credit checking shows the Credit Investigator's results (NFIS / TU), read-only.
// Two pages in the tabs: 1 = the recommendation (I to VI), 2 = the application information (VIII onwards). A third,
// unlisted page (?page=3) holds the credit result and the approval: it comes strictly after the credit score, so it
// is reached only from step 3 of "Your steps". The change history is a modal from the header's button (#fp-history). All three stay mounted inside ONE form (the inactive
// ones hidden), so switching keeps every edit and the single Save button; the page is kept in ?page=2 / ?page=3. The policy check (MRAC) is a modal opened from
// the navigator's "Key to the decision" box on either page (#fp-mrac opens it too).
// The assigned CO's header shows their work as three steps across pages (coSteps.jsx): this FP -> Credit score ->
// Approval routing, and the read-only pages (loan folder, Decision support) under "Optional view".
// Look (DESIGN.md, "Financial Package"): an .lf-folder page (root lf-fp; the .fp classes stay for the structure the
// credit score, approval routing, review and decision support pages share). Header with a mode tag and fact chips, the
// CO's steps card, the key figures as glass tiles, the two pages as big tabs, glass section cards, a floating save bar.
// Styles: financialPackage.css (.lf-fp block).
import { FinancialPackageSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, Gauge, House, Landmark, Lock, PenLine, Percent, Save, ScanText,
    History, ShieldCheck, UserRound, Wallet, X,
} from 'lucide-react';
import Byline from '../../components/byline';
import Breadcrumbs from '../../components/breadcrumbs';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, one, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney, partyLabel } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import ChangeHistory from '../loanFolder/changeHistory';
import { fetchReviewAssignments } from '../review/api';
import { splitRouting } from '../review/approval';
import CoSteps, { CoOptionalView } from './coSteps';
import { ReturnNotice } from '../review/returnNotice';
import { fetchAssignedAo, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveFinancialPackage } from './api';
import MessagesPanel from '../messages/messagesPanel';
import MracPanel from '../mrac/mracPanel';
import { useActiveSection } from '../review/useActiveSection';
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
import { Term, Terms } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';
import FinalReportButton from '../finalReport/finalReportButton';
import SuggestionPanel from '../aiSuggestion/suggestionPanel';
import { withHiddenCleared } from './creditResultFields';

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
    { n: 1, title: 'Recommendation', sub: 'Sections I to VI' },
    { n: 2, title: 'Application information', sub: 'Section VIII onwards' },
];

// Section navigator for the page being shown: [group, page, [[element id, label], ...]]; the ids are set in fpSections.jsx
const TOC = [
    {
        page: 1, group: 'Page 1: Recommendation',
        items: [['fp-general', 'General information'], ['fp-i', 'I. Borrower/s highlight'], ['fp-ii', 'II. Facility'],
            ['fp-iii', 'III. Collateral'], ['fp-iv', 'IV. Credit checking'], ['fp-v', 'V. Exceptions'],
            ['fp-vi', 'VI. Terms and conditions']],
    },
    {
        page: 2, group: 'Page 2: Application information',
        items: [['fp-viii', 'VIII. Employment'], ['fp-ix', 'IX. Cash flow'], ['fp-x', 'X. Deposit checking'],
            ['fp-xi', 'XI. Loan verification'], ['fp-xii', 'XII. Trade checking'], ['fp-xiii', 'XIII. Title'],
            ['fp-xiv', 'XIV. Customer information']],
    },
    {
        page: 3, group: null, // the step heading ("Step 3: Credit result") is its only label
        items: [['fp-result', 'Credit result'], ['fp-vii', 'Approval']],
    },
];

const idsOfPage = (page) => TOC.filter((g) => g.page === page).flatMap((g) => g.items.map(([id]) => id));
const PAGE_IDS = { 1: idsOfPage(1), 2: idsOfPage(2), 3: idsOfPage(3) }; // stable arrays for useActiveSection

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const FinancialPackagePage = () => {
    const { role } = UserAuth();
    const tt = useTermTitle();
    const [searchParams, setSearchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));
    const page = { 2: 2, 3: 3 }[searchParams.get('page')] ?? 1;
    const formRef = useRef(null);
    const tabsRef = useRef(null);
    const bodyRef = useRef(null);       // page 3 hides the tabs: a switch there scrolls to the body instead
    const scrollToTabs = useRef(false); // set by a page switch: bring the tabs into view once the new page is showing
    const revalidate = useRef(false);   // set when Save found a missing field on the other page
    const mracRef = useRef(null);       // the policy check modal (stays mounted, so its result survives closing)
    const openMrac = () => { const d = mracRef.current; if (d && !d.open) d.showModal(); };
    const historyRef = useRef(null);    // the change history modal (header button, #fp-history)
    const openHistory = () => { const d = historyRef.current; if (d && !d.open) d.showModal(); };

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [savedScore, setSavedScore] = useState({}); // { [criterion]: { band } }, for the header's risk rating
    const [routing, setRouting] = useState({ tier: null, rows: [], names: {} }); // VII. Approval
    const [form, setForm] = useState(null);
    const [savedPkg, setSavedPkg] = useState(null); // the saved FP row (null = never saved), for the CO's steps
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
        setSavedPkg(savedFp.pkg ?? null);
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
    // The navigator's highlight; a click keeps its section lit even when the page can't scroll it to the top
    const pageIds = PAGE_IDS[page];
    const [activeRaw, pickSection] = useActiveSection(pageIds, Boolean(app && form && rules));
    const activeId = pageIds.includes(activeRaw) ? activeRaw : pageIds[0];

    // After a switch: show the new page from its tabs (not jumped to the very top), or, when Save sent us here because a
    // required field on this page is empty, let the browser point at that field now that it is visible
    useEffect(() => {
        if (revalidate.current) {
            revalidate.current = false;
            formRef.current?.reportValidity();
        } else if (scrollToTabs.current) {
            (page === 3 ? bodyRef : tabsRef).current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
        scrollToTabs.current = false;
    }, [page]);

    // A link to a section (#fp-iv from the credit score note or the bell's "CI findings flagged"): once the page has
    // loaded, show the tab that holds it and scroll there. Once per link, so later tab switches don't jump back.
    // (Switching the tab rewrites the query string and drops the hash, so the section id is kept in a ref.)
    const { hash } = useLocation();
    const pendingId = useRef(null);
    const [jump, setJump] = useState(0);   // bumped by jumpTo(): the effect below runs again even for the same section
    const jumpTo = (id) => { pendingId.current = id; setJump((n) => n + 1); };
    useEffect(() => {
        if (hash) pendingId.current = decodeURIComponent(hash.slice(1));
    }, [hash]);
    const ready = Boolean(app && form && rules);
    useEffect(() => {
        const id = pendingId.current;
        if (!ready || !id) return;
        const modal = { 'fp-mrac': mracRef, 'fp-history': historyRef }[id]?.current;
        if (modal) {
            pendingId.current = null;
            if (!modal.open) modal.showModal();
            return;
        }
        const target = document.getElementById(id);
        if (!target) {
            pendingId.current = null;
            return;
        }
        const onPage = Number(target.closest('[data-fp-page]')?.dataset.fpPage ?? page);
        if (onPage !== page) {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (onPage === 1) next.delete('page'); else next.set('page', String(onPage));
                return next;
            }, { replace: true });
            return; // runs again once the other tab shows
        }
        pendingId.current = null;
        if (target instanceof HTMLDetailsElement) target.open = true;
        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        // a short amber outline on the section reached (not for reduced motion)
        if (!prefersReducedMotion()) {
            target.classList.remove('fp-flash');
            void target.offsetWidth; // restart the animation when the same section is reached again
            target.classList.add('fp-flash');
            setTimeout(() => target.classList.remove('fp-flash'), 2200);
        }
    }, [hash, ready, page, setSearchParams, jump]);

    if (loading) return <FinancialPackageSkeleton />;
    if (error && !form) {
        return (
            <div className="lf lf-folder lf-fp">
                <p className="lf-err" role="alert">{error}</p>
            </div>
        );
    }
    if (!app || !form || !rules) return null;

    const disabled = !canEdit || saving;
    const change = (next) => {
        setForm(next);
        setDirty(true);
        setSaved(false);
    };
    const onPkg = (field, value) => change({ ...form, pkg: { ...form.pkg, [field]: value } });
    const onPricing = (field, value) => change({ ...form, pricing: { ...form.pricing, [field]: value } });
    // onParty(id, field, value), or onParty(id, { field: value, ... }) for several fields in one change
    const onParty = (id, field, value) => {
        const fields = typeof field === 'object' ? field : { [field]: value };
        change({ ...form, parties: { ...form.parties, [id]: { ...form.parties[id], ...fields } } });
    };
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
            // boxes the chosen credit result hides are emptied (creditResultFields.js; the page said so first)
            await saveFinancialPackage(app.id, buildPayload({ ...form, pkg: withHiddenCleared(form.pkg) }));
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
    // The key figures as tiles; the risk rating opens the scoring page. tone 'warn': something is still missing for it
    const metrics = [
        {
            key: 'risk', Icon: Gauge, label: 'Credit risk rating', value: score.riskRating ?? 'Not scored',
            sub: score.riskRating ? `${score.total} / 100` : `${score.scored} of ${score.count} scored`,
            tone: score.riskRating ? 'done' : 'warn', link: [`/creditScorePage?id=${app.id}`, 'Open scoring'],
        },
        { key: 'dbr', Icon: Percent, label: 'Debt burden ratio', value: percent(computed.dbr) ?? '—', sub: 'DBR', tone: computed.dbr === null ? 'warn' : '' },
        { key: 'lcr', Icon: House, label: 'Loan-to-collateral', value: percent(computed.lcr) ?? '—', sub: 'LCR', tone: '' },
        {
            key: 'amort', Icon: CalendarClock, label: 'Monthly amortization', value: pesoOf(computed.amortization),
            sub: computed.amortization === null ? 'Needs the interest rate' : 'New loan', tone: computed.amortization === null ? 'warn' : '',
        },
        {
            key: 'income', Icon: Wallet, label: 'Combined gross income', value: pesoOf(computed.totalGross),
            sub: computed.totalGross === null ? 'Pick every income basis' : 'Per month', tone: computed.totalGross === null ? 'warn' : '',
        },
    ];
    const guard = () => !dirty || window.confirm('The Financial Package has unsaved changes. Leave without saving?');

    const goTo = (id) => (e) => {
        e.preventDefault();
        pickSection(id);
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) target.open = true; // the change history is a dropdown
        target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    };

    // Step 3 of "Your steps": open the unlisted page 3 (credit result, approval, history) from its start
    const openResult = () => {
        pickSection('fp-result');
        if (page === 3) bodyRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        else showPage(3);
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
        <form ref={formRef} onSubmit={handleSave} onInvalidCapture={onInvalid} className="lf lf-folder lf-fp fp">
            <Breadcrumbs current="package" appId={app.id} appNo={app.application_no} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <Landmark size={15} aria-hidden="true" />
                        <span>Financial Package &amp; Credit Recommendation</span>
                        <span className={`lf-mode ${canEdit ? 'edit' : 'read'}`}>
                            {canEdit
                                ? <><PenLine size={13} aria-hidden="true" />You can edit</>
                                : <><Lock size={13} aria-hidden="true" />Read-only</>}
                        </span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    <ul className="lf-meta">
                        <li>
                            <Wallet size={15} aria-hidden="true" />
                            <span className="k">{one(app.loan_purposes)?.label ?? 'Housing loan'}</span>
                            <span className="v">{pesoOf(app.loan_amount)}</span>
                        </li>
                        {aoName && (
                            <li>
                                <UserRound size={15} aria-hidden="true" />
                                <span className="k">Handling Account Officer</span>
                                <Byline layout="inline" name={aoName} fallback="Account Officer" />
                            </li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                    <button type="button" className="lf-btn" aria-haspopup="dialog" onClick={openHistory}>
                        <History size={16} aria-hidden="true" />Change history
                    </button>
                    {/* The assigned CO's draft of the final report (Credit Evaluation only); it reads the saved FP */}
                    <FinalReportButton applicationId={app.id} draft coCanEdit={canEdit} onClick={confirmLeave} />
                    {/* The assigned CO gets these as steps / optional view below */}
                    {!canEdit && (
                        <>
                            {/* The same page as VII. Approval's button: it reads the saved FP, so warn about unsaved edits */}
                            <Link to={`/approvalRoutingPage?id=${app.id}`} onClick={confirmLeave} className="lf-btn">
                                <BadgeCheck size={16} aria-hidden="true" />Approval routing
                            </Link>
                            {/* The applicant's documents beside what the AI read (the Credit Investigator has a CI version) */}
                            {role !== 'CREDIT_INVESTIGATOR' && (
                                <Link to={`/documentCheckPage?id=${app.id}`} onClick={confirmLeave} className="lf-btn">
                                    <ScanText size={16} aria-hidden="true" />Document check
                                </Link>
                            )}
                            <Link to={`/loanFolderPage?id=${app.id}`} className="lf-btn">
                                Loan folder<ArrowRight size={16} aria-hidden="true" />
                            </Link>
                        </>
                    )}
                </div>
            </header>

            {!canEdit && (
                <p className="lf-note">
                    <Lock size={16} aria-hidden="true" />
                    <span>
                        Read-only. Only the assigned Credit Officer can edit the Financial Package.
                        {role === 'CREDIT_OFFICER' && ' Your Manager can reassign it to you.'}
                    </span>
                </p>
            )}

            {canEdit && (
                <section className="lf-card lf-stepcard" aria-label="Your steps">
                    <CoSteps appId={app.id} current={page === 3 ? 'result' : 'package'} pkg={savedPkg} score={score}
                        sent={splitRouting(routing.rows).reviewers.length > 0} guard={guard} onOpenResult={openResult} />
                    <CoOptionalView appId={app.id} documentCheck guard={guard} />
                </section>
            )}

            <div className="fp-return">
                <ReturnNotice applicationId={app.id} link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} onGoTo={jumpTo} />
            </div>

            <section className="fp-tiles" aria-label="Key figures">
                {metrics.map(({ key, Icon, label, value, sub, tone, link }) => {
                    const body = (
                        <>
                            <span className="ic" aria-hidden="true"><Icon size={18} /></span>
                            <span className="lbl">{label}</span>
                            <span className="val">{value}</span>
                            <span className="sub">
                                <Terms text={sub} />
                                {link && <span className="go">{link[1]}<ArrowRight size={14} aria-hidden="true" /></span>}
                            </span>
                        </>
                    );
                    return link
                        ? <Link key={key} to={link[0]} onClick={confirmLeave} className={`lf-tile fp-tile ${tone}`}>{body}</Link>
                        : <div key={key} className={`lf-tile fp-tile ${tone}`}>{body}</div>;
                })}
            </section>

            <div ref={tabsRef} className="fp-pagetabs" role="tablist" hidden={page === 3} aria-label="Financial Package pages" onKeyDown={onTabKey}>
                {PAGES.map((p) => (
                    <button key={p.n} type="button" role="tab" id={`fp-tab-${p.n}`} aria-controls={`fp-page-${p.n}`}
                        aria-selected={page === p.n} tabIndex={page === p.n || (page === 3 && p.n === 1) ? 0 : -1}
                        onClick={() => showPage(p.n)}>
                        <span className="n" aria-hidden="true">{p.n}</span>
                        <span className="txt">
                            <b><span className="sr-only">Page {p.n}: </span>{p.title}</b>
                            <span>{p.sub}</span>
                        </span>
                    </button>
                ))}
            </div>

            <div ref={bodyRef} className="lf-body edit">
                <div className="fp-side">
                    <nav className="lf-card lf-nav fp-nav" aria-label="Financial Package sections">
                        <div>
                            <p className="fp-navgroup fp-navstep">{page === 3 ? 'Step 3: Credit result' : 'Step 1: Financial Package'}</p>
                        </div>
                        {TOC.filter((g) => g.page === page).map(({ group, items }) => (
                            <div key={group ?? page}>
                                {group && <p className="fp-navgroup">{group}</p>}
                                <ul>
                                    {items.map(([id, label]) => (
                                        <li key={id}>
                                            <a href={`#${id}`} onClick={goTo(id)} title={tt(label)}
                                                aria-current={activeId === id ? 'true' : undefined}>
                                                <span>{label}</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        {/* On both pages: the policy check opens as a modal */}
                        <div className="fp-navkey" role="group" aria-labelledby="fp-navkey-title">
                            <p id="fp-navkey-title" className="fp-navkey-title">Key to the decision</p>
                            <button type="button" className="fp-navkey-btn" aria-haspopup="dialog" onClick={openMrac}>
                                <ShieldCheck size={16} aria-hidden="true" />
                                <span>Policy check (MRAC)</span>
                            </button>
                        </div>
                    </nav>
                    {page !== 3 && (
                        <div className="fp-navpages" role="group" aria-label="Switch page">
                            {PAGES.map((p) => (
                                <button key={p.n} type="button" aria-pressed={page === p.n} aria-label={`Page ${p.n}: ${p.title}`}
                                    title={`Page ${p.n}: ${p.title}`} onClick={() => showPage(p.n)}>
                                    {p.n}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <dialog ref={mracRef} className="fp-dialog" aria-label="Policy check (MRAC)"
                    onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
                    <button type="button" className="fp-dialogclose" aria-label="Close the policy check"
                        onClick={() => mracRef.current?.close()}>
                        <X size={18} aria-hidden="true" />
                    </button>
                    <div className="fp-dialogbody">
                        <MracPanel app={app} computed={computed} score={score} pricing={form.pricing}
                            exceptions={form.exceptions} canEdit={canEdit}
                            onAddException={(row) => onList('exceptions')([...form.exceptions, { _key: crypto.randomUUID(), ...row }])}
                            onAddTerm={(text) => onPkg('terms_and_conditions',
                                [form.pkg.terms_and_conditions?.trimEnd(), `- ${text}`].filter(Boolean).join('\n'))} />
                    </div>
                </dialog>

                <dialog ref={historyRef} id="fp-history" className="fp-dialog" aria-labelledby="fp-history-title"
                    onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
                    <button type="button" className="fp-dialogclose" aria-label="Close the change history"
                        onClick={() => historyRef.current?.close()}>
                        <X size={18} aria-hidden="true" />
                    </button>
                    <div className="fp-dialogbody fp-histbody">
                        <header className="fp-dialoghead">
                            <History size={18} aria-hidden="true" />
                            <h2 id="fp-history-title"><Term k="FP" /> change history</h2>
                            <span className="lf-history-count">{audit.length} {audit.length === 1 ? 'entry' : 'entries'}</span>
                        </header>
                        {audit.length === 0 ? <p className="fp-empty">No changes yet.</p> : <ChangeHistory app={app} entries={audit} names={names} />}
                    </div>
                </dialog>

                <div className="lf-main fp-main">
                    {/* Page 1: the recommendation (I to VI) */}
                    <div id="fp-page-1" role="tabpanel" aria-labelledby="fp-tab-1" data-fp-page="1" hidden={page !== 1} className="fp-page">
                        <HeaderSection app={app} aoName={aoName} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                        <HighlightsSection app={app} computed={computed} />
                        <FacilitySection app={app} computed={computed} form={form.pkg} pricing={form.pricing}
                            onPkg={onPkg} onPricing={onPricing} disabled={disabled} />
                        <CollateralSection app={app} form={form.pkg} onPkg={onPkg} disabled={disabled} />
                        <CreditCheckingSection app={app} />
                        <RowsSection id="fp-v" title="V. Exception/s" config={EXCEPTION_FIELDS} rows={form.exceptions}
                            onChange={onList('exceptions')} disabled={disabled}>
                            <p className="fp-note">List each policy this file doesn&apos;t meet, what you recommend, and what
                                lowers the risk. Any exception moves the approval authority one step up.</p>
                        </RowsSection>
                        <TermsSection form={form.pkg} onPkg={onPkg} onReset={resetTerms} disabled={disabled} />
                        <div className="fp-pagenav">
                            <button type="button" className="fp-next" onClick={() => showPage(2)}>
                                Next: Page 2, Application information<ArrowRight size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* Page 2: the application information (VIII onwards) */}
                    <div id="fp-page-2" role="tabpanel" aria-labelledby="fp-tab-2" data-fp-page="2" hidden={page !== 2} className="fp-page">
                        <h2 className="fp-pagehead">Page 2: Credit Application Information</h2>
                        <EmploymentSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
                        <CashFlowSection computed={computed} details={form.parties} onParty={onParty} disabled={disabled} />
                        <RowsSection id="fp-x" title="X. Deposit Checking" config={DEPOSIT_CHECK_FIELDS} rows={form.deposit_checks}
                            onChange={onList('deposit_checks')} disabled={disabled}>
                            <p className="fp-note">Bank accounts declared in the <Term k="KYC" />:{' '}
                                {kycBankAccounts.length === 0 ? 'none.' : kycBankAccounts.map((b) =>
                                    `${partyLabel(b.party)}: ${b.bank_name} ${b.account_type} ${b.account_number}`).join('; ')}
                            </p>
                        </RowsSection>
                        <RowsSection id="fp-xi" title="XI. Loan Verification (Based on Loandex and Disclosure)" config={LOAN_CHECK_FIELDS}
                            rows={form.loan_checks} onChange={onList('loan_checks')} disabled={disabled}>
                            <p className="fp-note">Existing loans declared in the <Term k="KYC" />:{' '}
                                {kycLoans.length === 0 ? 'none.' : kycLoans.map((l) =>
                                    `${partyLabel(l.party)}: ${l.loan_type} with ${l.lending_institution}, ₱${formatMoney(l.monthly_payment)} / month`).join('; ')}
                            </p>
                        </RowsSection>
                        <RowsSection id="fp-xii" title="XII. Trade Checking (if applicable)" config={TRADE_CHECK_FIELDS} rows={form.trade_checks}
                            onChange={onList('trade_checks')} disabled={disabled} />
                        <TitleSection titles={form.titles} onTitle={onTitle} disabled={disabled} />
                        <CustomerSection app={app} details={form.parties} onParty={onParty} disabled={disabled} />
                        <div className="fp-pagenav">
                            <button type="button" className="lf-btn quiet back" onClick={() => showPage(1)}>
                                <ArrowLeft size={16} aria-hidden="true" />Back to Page 1, Recommendation
                            </button>
                            {/* Step 2 reads the saved FP, so confirmLeave warns about unsaved edits */}
                            <Link to={`/creditScorePage?id=${app.id}`} onClick={confirmLeave} className="fp-next">
                                Next: Step 2, Credit score<ArrowRight size={16} aria-hidden="true" />
                            </Link>
                        </div>
                    </div>

                    {/* Page 3 (not in the tabs; step 3 of "Your steps", after the credit score): the credit result and the
                        approval */}
                    <div id="fp-page-3" data-fp-page="3" hidden={page !== 3} className="fp-page" aria-labelledby="fp-page3-head">
                        <div className="fp-page3head">
                            <h2 id="fp-page3-head" className="fp-pagehead">Step 3: Credit result</h2>
                            <p className="fp-note">Set after the credit score. An Endorsed or Not endorsed result, saved, lets you send the
                                application for review in Approval routing.</p>
                        </div>
                        <CreditResultSection form={form.pkg} onPkg={onPkg} disabled={disabled} />
                        {/* AI suggestion for the credit result (suggestion only; the CO may copy the draft justification) */}
                        <SuggestionPanel applicationId={app.id} canEdit={canEdit} dirty={dirty} justification={form.pkg.justification}
                            onUseDraft={(text) => onPkg('justification', text)} />
                        <ApprovalSection tier={routing.tier} rows={routing.rows} names={routing.names}
                            link={`/approvalRoutingPage?id=${app.id}`} onOpen={confirmLeave} />
                    </div>

                    {canEdit ? (
                        <div className="fp-savebar">
                            <div className="state" role="status">
                                {dirty && <span className="lf-chip warn">Unsaved changes</span>}
                                {saved && !dirty && <span className="lf-chip ok">Saved</span>}
                                <FormError error={error} />
                            </div>
                            <button type="submit" className="lf-primary" disabled={saving || !dirty}>
                                <Save size={16} aria-hidden="true" />{saving ? 'Saving...' : 'Save Financial Package'}
                            </button>
                        </div>
                    ) : <FormError error={error} />}
                </div>
            </div>
        </form>
    );
};

export default FinancialPackagePage;
