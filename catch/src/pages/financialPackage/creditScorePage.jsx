// Housing Loan Credit Scoring Sheet (KYC-FP "Credit_Score" tab), opened from the Financial Package.
// Suggestions are worked out from the record and the SAVED Financial Package (income basis, rate, appraised
// value, loan / deposit checks); the CO accepts, changes or leaves each one and saves with save_credit_score().
// Same edit rule as the FP: only the assigned CO, any stage before Decided; everyone else with access reads.
// The assigned CO's header shows step 2 of their three steps (coSteps.jsx): FP -> this score -> Approval routing.
// Look (DESIGN.md, "Credit score and VII. Approval"): the Financial Package's .lf-fp look (root lf-cs): header with a
// mode tag and fact chips, the steps card, the figures as tiles, criterion cards. Styles: creditScore.css (.lf-cs).
import { CreditScoreSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowRight, BadgeCheck, ChevronDown, Gauge, History, Info, ListChecks, Lock, PenLine, Save, ShieldCheck, Users, Wallet, X,
} from 'lucide-react';
import { fetchCiFindingFlagCount, fetchCiResults } from '../ciRequest/api';
import { needsAttention } from '../ciRequest/options';
import Breadcrumbs from '../../components/breadcrumbs';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getParties, toRow } from '../applicationForm/api';
import { FormError } from '../applicationForm/fields';
import { BORROWER_ROLES, formatMoney } from '../applicationForm/options';
import { fetchAuditLog, fetchStaffNames } from '../loanFolder/api';
import { fetchReviewAssignments } from '../review/api';
import { splitRouting } from '../review/approval';
import CoSteps, { CoOptionalView } from './coSteps';
import Byline from '../../components/byline';
import CommentButton from '../messages/commentButton';
import { scoreHistory } from './scoreHistory';
import { ReturnNotice } from '../review/returnNotice';
import { PanelHide, PanelRail } from '../../components/sidePanel';
import { useSidePanel } from '../../components/useSidePanel';
import { addToFinancialPackage, fetchCoCanEdit, fetchCreditScoreRules, fetchFinancialPackage, saveCreditScore } from './api';
import { computeFp } from './compute';
import { suggestCreditScore, totalCreditScore } from './creditScore';
import { CreditScoreSection } from './creditScoreSection';
import { scrollToSection, useActiveSection } from '../review/useActiveSection';
import MessagesPanel from '../messages/messagesPanel';
import MracPanel from '../mrac/mracPanel';
import { useMracStale } from '../mrac/useMracStale';
import '../loanFolder/loanFolder.css';
import './financialPackage.css';
import '../review/review.css';
import './creditScore.css';
import { Term, Terms } from '../../components/term';

const SCORE_KEYS = ['band', 'suggested_band', 'remarks'];
const formOf = (row) => Object.fromEntries(SCORE_KEYS.map((k) => [k, row?.[k] ?? '']));
const money = (v) => (v ? `₱${formatMoney(v)}` : '—');

// Section navigator: [element id, label]; the category ids match creditScoreSection.jsx
const TOC = [
    ['cs-CAPACITY', '1. Capacity'], ['cs-CHARACTER', '2. Character'], ['cs-COLLATERAL', '3. Collateral'],
    ['cs-CONDITION', '4. Condition'], ['cs-total', 'Total score'], ['cs-history', 'Change History'],
];
const TOC_IDS = TOC.map(([id]) => id);
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

const CreditScorePage = () => {
    const sidePanel = useSidePanel('credit-score');   // the side panel can be hidden (item 38)
    const { role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [rules, setRules] = useState(null);
    const [fp, setFp] = useState(null);
    const [scores, setScores] = useState(null); // { [criterion]: { band, suggested_band, remarks } }
    const [canEdit, setCanEdit] = useState(false);
    const [sent, setSent] = useState(false); // sent for review (the CO's step 3)
    const [audit, setAudit] = useState([]);
    const [fullLog, setFullLog] = useState([]); // the whole audit log (the policy check's "changed since" mark)
    const [scoreRows, setScoreRows] = useState([]);   // saved credit_score_entries (ids -> criterion for the history)
    const [names, setNames] = useState({});
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [ciFindings, setCiFindings] = useState(false); // a CI result is "With findings" or a CI flagged findings
    const [ci, setCi] = useState(null);                 // the CI results (Character suggestions: ciFacts.js)
    const [activeId, pickSection] = useActiveSection(TOC_IDS, Boolean(app && scores && rules));
    const mracRef = useRef(null);            // the policy check modal (stays mounted, so its result survives closing)
    const fpQueue = useRef(Promise.resolve()); // adds to the FP one at a time, so a quick second click can't drop the first
    const [fpNote, setFpNote] = useState(null); // { tone, text } after adding to the FP from the policy check

    // CI results: the findings note, and the NFIS / loan history / returned checks suggestions. A failed load just
    // leaves them out (the Character items then wait for the CI)
    useEffect(() => {
        if (!app) return undefined;
        let cancelled = false;
        const ids = getParties(app, BORROWER_ROLES).map((p) => p.id);
        Promise.all([fetchCiResults(ids), fetchCiFindingFlagCount(app.id)])
            .then(([ci, flags]) => {
                if (cancelled) return;
                setCi(ci);
                setCiFindings(flags > 0 || ci.checks.some((c) => needsAttention(c.result)));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app]);

    // Saved FP + score + the score's change history (+ the staff names in it)
    const loadScore = useCallback(async (record) => {
        const ids = getParties(record, BORROWER_ROLES).map((p) => p.id);
        const [savedFp, log, reviewRows] = await Promise.all([
            fetchFinancialPackage(record.id, ids), fetchAuditLog(record.id), fetchReviewAssignments(record.id)]);
        setSent(splitRouting(reviewRows).reviewers.length > 0);
        const scoreLog = log.filter((e) => e.table_name === 'credit_score_entries');
        setFp(savedFp);
        setScores(Object.fromEntries(savedFp.creditScore.map((r) => [r.criterion, formOf(r)])));
        setAudit(scoreLog);
        setFullLog(log);
        setScoreRows(savedFp.creditScore);
        setNames(await fetchStaffNames(scoreLog.map((e) => e.changed_by)));
        setDirty(false);
        return log;
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [record, editable, scoreRules] = await Promise.all([
                    fetchApplication(applicationId), fetchCoCanEdit(applicationId), fetchCreditScoreRules()]);
                if (cancelled) return;
                setApp(record);
                setCanEdit(editable);
                setRules(scoreRules);
                await loadScore(record);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadScore]);

    // FP figures (DBR, gross income, LCR, ...) from what's saved in the FP
    const pricing = useMemo(() => (app ? { interest_rate: app.interest_rate, fixing_period: app.fixing_period } : null), [app]);
    const computed = useMemo(() => {
        if (!app || !fp) return null;
        const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
        return computeFp(app, details, fp.pkg ?? {}, pricing);
    }, [app, fp, pricing]);
    const suggestions = useMemo(() => {
        if (!app || !fp || !rules || !computed) return null;
        return suggestCreditScore(app, computed, { loan_checks: fp.loanChecks, deposit_checks: fp.depositChecks }, rules.criteria, ci);
    }, [app, fp, rules, ci, computed]);
    const totals = useMemo(() => (rules && scores ? totalCreditScore(rules, scores) : null), [rules, scores]);
    // The orange "!" on the Policy check button: FP / score data changed after the last check
    const mrac = useMracStale({ appId: applicationId, log: fullLog, dirty, current: scores });

    if (loading) return <CreditScoreSkeleton />;
    if (error && !scores) {
        return (
            <div className="lf lf-folder lf-fp lf-cs">
                <p className="lf-err" role="alert">{error}</p>
            </div>
        );
    }
    if (!app || !scores || !suggestions) return null;

    const change = (next) => {
        setScores(next);
        setDirty(true);
        setSaved(false);
    };
    // Picking a band keeps what the page suggested at that moment, so overrides show in the audit trail
    const entry = (criterion, band) => ({ remarks: '', ...scores[criterion], band, suggested_band: suggestions[criterion].band ?? '' });
    const onScore = (criterion, band) => change({ ...scores, [criterion]: entry(criterion, band) });
    const onRemarks = (criterion, remarks) => change({ ...scores, [criterion]: { ...formOf(null), ...scores[criterion], remarks } });
    const acceptAll = () => change({ ...scores, ...Object.fromEntries(rules.criteria
        .filter((c) => !scores[c.code]?.band && suggestions[c.code].band)
        .map((c) => [c.code, entry(c.code, suggestions[c.code].band)])) });

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        const wasFresh = !mrac.stale;
        try {
            setError(null);
            await saveCreditScore(app.id, Object.entries(scores)
                .filter(([, s]) => s.band)
                .map(([criterion, s]) => ({ criterion, ...toRow(s) })));
            mrac.covered(wasFresh, await loadScore(app));
            setSaved(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const leaveOk = () => !dirty || window.confirm('The credit score has unsaved changes. Leave without saving?');
    const leave = (e) => {
        if (!leaveOk()) e.preventDefault();
    };
    const borrowers = getParties(app, BORROWER_ROLES).map(fullName).filter(Boolean).join(', ');

    const unconfirmed = rules.criteria.filter((c) => !scores[c.code]?.band && suggestions[c.code].band).length;
    // The figures as tiles (tone 'warn': still waiting on the CO; 'done': complete)
    const metrics = [
        {
            key: 'total', Icon: Gauge, label: 'Total score', value: `${totals.total} / 100`,
            sub: totals.complete ? (totals.description ?? 'Scored') : `${totals.scored} of ${totals.count} criteria scored`,
            tone: totals.complete ? 'done' : 'warn',
        },
        {
            key: 'risk', Icon: ShieldCheck, label: 'Credit risk rating', value: totals.riskRating ?? 'Not scored',
            sub: totals.riskRating ? 'From the score' : 'When every criterion is scored', tone: totals.riskRating ? 'done' : 'warn',
        },
        { key: 'rec', Icon: BadgeCheck, label: 'Recommendation', value: totals.recommendation ?? '—', sub: 'A guide, not the decision', tone: '' },
        { key: 'loan', Icon: Wallet, label: 'Loan amount', value: money(app.loan_amount), sub: 'Requested', tone: '' },
        {
            key: 'sugg', Icon: ListChecks, label: 'Suggestions to confirm', value: String(unconfirmed),
            sub: unconfirmed === 0 ? 'Nothing waiting' : 'Not counted until picked', tone: unconfirmed === 0 ? '' : 'warn',
        },
    ];

    const historyLines = scoreHistory(audit, rules, scoreRows);

    // The policy check, as on the Financial Package. It runs on the score on screen (unsaved picks too) and the saved FP.
    // "+ Add" saves straight into the saved FP (V. Exception/s, the terms); only the FP is touched, not the score.
    const openMrac = () => { const d = mracRef.current; if (d && !d.open) d.showModal(); };
    const addToFp = (change, done) => {
        const wasFresh = !mrac.stale;   // the check's own suggestion doesn't put it out of date
        fpQueue.current = fpQueue.current.then(async () => {
            try {
                setFp(await addToFinancialPackage(app, change));
                const log = await fetchAuditLog(app.id);
                setFullLog(log);
                mrac.covered(wasFresh, log);
                setFpNote({ tone: 'ok', text: `${done} Saved to the Financial Package.` });
            } catch (err) {
                setFpNote({ tone: 'err', text: `Couldn't add it to the Financial Package: ${err.message}` });
            }
        });
    };
    const fpSaved = Boolean(fp.pkg);

    const goTo = (id) => (e) => {
        e.preventDefault();
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) target.open = true; // the change history is a dropdown
        pickSection(id);
        scrollToSection(id);
    };

    return (
        <form onSubmit={handleSave} className="lf lf-folder lf-fp lf-cs fp rv">
            <Breadcrumbs current="score" appId={app.id} appNo={app.application_no} onNavigate={leave} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <Gauge size={15} aria-hidden="true" />
                        <span>Housing Loan Credit Scoring</span>
                        <span className={`lf-mode ${canEdit ? 'edit' : 'read'}`}>
                            {canEdit
                                ? <><PenLine size={13} aria-hidden="true" />You can edit</>
                                : <><Lock size={13} aria-hidden="true" />Read-only</>}
                        </span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    <ul className="lf-meta">
                        <li>
                            <Users size={15} aria-hidden="true" />
                            <span className="k">Borrower/s</span>
                            <span className="v cs-names">{borrowers || '—'}</span>
                        </li>
                        <li>
                            <Wallet size={15} aria-hidden="true" />
                            <span className="k">Loan amount</span>
                            <span className="v">{money(app.loan_amount)}</span>
                        </li>
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                    {/* The assigned CO gets these as steps / optional view below */}
                    {!canEdit && (
                        <>
                            <Link to="/adminHomePage" onClick={leave} className="lf-btn">Work tray</Link>
                            <Link to={`/loanFolderPage?id=${app.id}`} onClick={leave} className="lf-btn">
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
                        Read-only. Only the assigned Credit Officer can edit the credit score.
                        {role === 'CREDIT_OFFICER' && ' Your Manager can reassign it to you.'}
                    </span>
                </p>
            )}

            {ciFindings && (
                <p className="lf-note warn" role="note">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                        <Term k="CI" /> findings exist on this file and may lower the score. See{' '}
                        <Link to={`/financialPackagePage?id=${app.id}#fp-iv`} onClick={leave}>IV. Credit Checking</Link>{' '}
                        on the Financial Package.
                    </span>
                </p>
            )}

            {canEdit && (
                <section className="lf-card lf-stepcard" aria-label="Your steps">
                    <CoSteps appId={app.id} current="score" pkg={fp.pkg ?? null} sent={sent} guard={leaveOk}
                        score={totalCreditScore(rules, Object.fromEntries(fp.creditScore.map((r) => [r.criterion, r])))} />
                    <CoOptionalView appId={app.id} guard={leaveOk} />
                </section>
            )}

            {canEdit && (
                <ReturnNotice applicationId={app.id} link={`/approvalRoutingPage?id=${app.id}`} here="/creditScorePage"
                    onOpen={(e) => { if (!leaveOk()) e.preventDefault(); }} />
            )}

            <section className="fp-tiles" aria-label="Score figures">
                {metrics.map(({ key, Icon, label, value, sub, tone }) => (
                    <div key={key} className={`lf-tile fp-tile ${tone}`}>
                        <span className="ic" aria-hidden="true"><Icon size={18} /></span>
                        <span className="lbl">{label}</span>
                        <span className="val">{value}</span>
                        <span className="sub"><Terms text={sub} /></span>
                    </div>
                ))}
            </section>

            <p className="lf-note">
                <Info size={16} aria-hidden="true" />
                <span>
                    Suggestions use the saved Financial Package (income basis, interest rate, appraised value, loan and
                    deposit checks). Save the <Term k="FP" /> first if you changed any of those.
                </span>
            </p>

            <div className={`lf-body edit${sidePanel.hidden ? ' side-hidden' : ''}`}>
                {sidePanel.hidden ? (
                    <PanelRail panel={sidePanel} label="sections">
                        <button type="button" className="sp-rail-btn" aria-haspopup="dialog" onClick={openMrac}
                            title={mrac.stale ? 'Policy check (MRAC): changed since the last check' : 'Policy check (MRAC)'}>
                            <ShieldCheck size={18} aria-hidden="true" />
                            <span className="sr-only">Policy check (MRAC){mrac.stale && ', changed since the last check'}</span>
                            {mrac.stale && <span className="fp-stale" title="Changed since the last check" aria-hidden="true">!</span>}
                        </button>
                    </PanelRail>
                ) : (
                <nav className="lf-card lf-nav fp-nav" aria-label="Credit score sections">
                    <PanelHide panel={sidePanel} label="sections" />
                    <div><p className="fp-navgroup fp-navstep">Step 2: Credit score</p></div>
                    <ul>
                        {TOC.map(([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} onClick={goTo(id)} aria-current={activeId === id ? 'true' : undefined}>{label}</a>
                            </li>
                        ))}
                    </ul>
                    {/* Same box as the Financial Package's navigator: the policy check opens as a modal */}
                    <div className="fp-navkey" role="group" aria-labelledby="cs-navkey-title">
                        <p id="cs-navkey-title" className="fp-navkey-title">Key to the decision</p>
                        <button type="button" className="fp-navkey-btn" aria-haspopup="dialog" onClick={openMrac}>
                            <ShieldCheck size={16} aria-hidden="true" />
                            <span>Policy check (MRAC)</span>
                            {mrac.stale && <span className="sr-only">, changed since the last check</span>}
                            {mrac.stale && <span className="fp-stale" title="Changed since the last check" aria-hidden="true">!</span>}
                        </button>
                    </div>
                </nav>
                )}

                <dialog ref={mracRef} className="fp-dialog" aria-label="Policy check (MRAC)"
                    onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
                    <button type="button" className="fp-dialogclose" aria-label="Close the policy check"
                        onClick={() => mracRef.current?.close()}>
                        <X size={18} aria-hidden="true" />
                    </button>
                    <div className="fp-dialogbody">
                        {canEdit && !fpSaved && (
                            <p className="lf-note warn cs-mracnote" role="note">
                                <AlertTriangle size={16} aria-hidden="true" />
                                <span>Save the Financial Package first to add exceptions or terms from here.</span>
                            </p>
                        )}
                        {fpNote && (
                            <p className={`lf-note cs-mracnote${fpNote.tone === 'err' ? ' warn' : ''}`}
                                role={fpNote.tone === 'err' ? 'alert' : 'status'}>
                                {fpNote.tone === 'err' ? <AlertTriangle size={16} aria-hidden="true" /> : <BadgeCheck size={16} aria-hidden="true" />}
                                <span>{fpNote.text}</span>
                            </p>
                        )}
                        <MracPanel app={app} computed={computed} score={totals} pricing={pricing}
                            onRequest={mrac.onRequest} onRun={mrac.onRun} stale={mrac.stale}
                            exceptions={fp.exceptions} canEdit={canEdit}
                            onAddException={fpSaved ? (row) => addToFp({ exception: row }, 'Added to V. Exception/s.') : undefined}
                            onAddTerm={fpSaved ? (text) => addToFp({ term: text }, 'Added to VI. Terms and conditions.') : undefined} />
                    </div>
                </dialog>

                <div className="lf-main fp-main">
                    <CreditScoreSection rules={rules} suggestions={suggestions} scores={scores} totals={totals}
                        onScore={onScore} onRemarks={onRemarks} onUseAll={acceptAll} disabled={!canEdit || saving} />

                    {/* Collapsed until opened, like the loan folder's change history (loanFolder.css .lf-history) */}
                    <details id="cs-history" className="lf-card lf-history">
                        <summary>
                            <span className="lf-history-ic"><History size={18} aria-hidden="true" /></span>
                            <h2>Change History</h2>
                            <span className="lf-history-count">{historyLines.length} {historyLines.length === 1 ? 'entry' : 'entries'}</span>
                            <CommentButton topic="cs-history" />
                            <ChevronDown size={18} className="lf-history-chevron" aria-hidden="true" />
                        </summary>
                        <div className="lf-history-body">
                            {historyLines.length === 0 ? <p className="fp-empty">No changes yet.</p> : (
                                <ol className="cs-hist">
                                    {historyLines.map((l) => (
                                        <li key={l.id} className={`cs-hist-item ${l.kind.toLowerCase()}`}>
                                            <p className="cs-hist-text"><Terms text={l.text} /></p>
                                            <Byline layout="inline" name={names[l.by]} fallback="unknown" at={l.at} />
                                            {l.remarks && <p className="cs-hist-remarks">{l.remarks}</p>}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    </details>

                    {/* The assigned CO's next step (coSteps.jsx): Step 3 reads the saved score, so leave warns about unsaved edits */}
                    {canEdit && (
                        <div className="fp-pagenav">
                            <Link to={`/financialPackagePage?id=${app.id}&page=3`} onClick={leave} className="fp-next">
                                Next: Step 3, Credit result<ArrowRight size={16} aria-hidden="true" />
                            </Link>
                        </div>
                    )}

                    {canEdit && (
                        <div className="fp-savebar">
                            <div className="state">
                                {dirty && <span className="lf-chip warn">Unsaved changes</span>}
                                {saved && !dirty && <span className="lf-chip ok" role="status">Saved</span>}
                                <FormError error={error} />
                            </div>
                            <button type="submit" className="lf-primary" disabled={saving || !dirty}>
                                <Save size={16} aria-hidden="true" />{saving ? 'Saving...' : 'Save Credit Score'}
                            </button>
                        </div>
                    )}
                    {!canEdit && <FormError error={error} />}
                </div>
            </div>
        </form>
    );
};

export default CreditScorePage;
