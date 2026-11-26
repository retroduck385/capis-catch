// Loan folder: staff view of one submitted application, opened from the work tray.
// The assigned AO (while in Intake or Credit Investigation) edits each section with the same forms the applicant
// used and records a KYC check per section. Everyone else with access gets a read-only view.
// The assigned AO's header shows their work as numbered steps (aoSteps.jsx): document check, KYC, Request CI.
// For any AO, Decision support and the Financial Package sit apart under "Optional view": they are read-only to an AO.
//
// Layout (DESIGN.md, "Loan folder"): one glass page panel (.lf-folder) holding the breadcrumb, a title header and
// a dashboard row (the AO's steps, or a KYC ring with Credit investigation / Change history tiles), then the body.
// Read-only: KYC board (filterable), application details, change history. Editing AO: a sticky section navigator
// beside the open section, whose form sits next to a sticky "Record KYC check" rail on wide screens.
import { LoanFolderSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowRight, CalendarDays, ChevronDown, FolderOpen, History, LayoutList, Lock,
    PencilLine, Scale, ScanText, Send,
} from 'lucide-react';
import { DSS_ROLES } from '../../roles';
import Breadcrumbs from '../../components/breadcrumbs';
import OptionalView from '../../components/optionalView';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getDocumentUrl, getParties, refreshApplication } from '../applicationForm/api';
import ApplicationDetails from './applicationDetails';
import { buildSteps } from '../applicationForm/steps';
import { fetchCiRequests } from '../ciRequest/api';
import { fetchDocumentProgress } from '../documentCheck/api';
import RequestCiPanel from '../ciRequest/requestCiPanel';
import { fetchAuditLog, fetchCanEdit, fetchKycChecks, fetchStaffNames } from './api';
import AoSteps from './aoSteps';
import ChangeHistory from './changeHistory';
import KycCheckPanel from './kycCheckPanel';
import SectionDocuments from './sectionDocuments';
import { StepSaveLabel } from '../applicationForm/stepSaveLabel';
import { KycBoard, KycProgress, StatusIcon } from './kycOverview';
import { RESULT_LABELS, kycCounts, statusOf } from './options';
import Byline from '../../components/byline';
import { formatDay, formatWhen, fullWhen } from '../../components/people';
import MessagesPanel from '../messages/messagesPanel';
import SendNoticePanel from '../applicantNotices/sendNoticePanel';
import RequestPanel from '../documentRequests/requestPanel';
import { fetchThreads } from '../kycClarify/api';
import AoThread from '../kycClarify/aoThread';
import AoQuestionCard from '../kycClarify/aoQuestionCard';
import { openSectionsText, stageBlockNote } from '../kycClarify/sections';
import { PanelHide, PanelRail } from '../../components/sidePanel';
import { useSidePanel } from '../../components/useSidePanel';
import './loanFolder.css';
import { Term } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const OVERVIEW = 'overview';
const REQUEST_CI = 'request-ci';

// Form sections the AO verifies (the wizard's steps without Review & Submit)
const sectionsFor = (app) => buildSteps(app).filter((s) => s.key !== 'review');
// Every uploaded document of every party (step 1 counts the ones the AI reads)
const documentsOf = (app) => getParties(app).flatMap((p) => (p.application_requirements ?? []).flatMap((r) => r.documents ?? []));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Opens the change history card, scrolls its top into view (below the sticky top bar: html scroll-padding-top) and
// puts keyboard focus on its heading
const revealHistory = (el) => {
    el.open = true;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    el.querySelector('summary')?.focus({ preventScroll: true });
};

const LoanFolderPage = () => {
    const sidePanel = useSidePanel('folder-nav');   // the side panel can be hidden (item 38)
    const { session, role } = UserAuth();
    const tt = useTermTitle();
    const [searchParams] = useSearchParams();
    const { hash } = useLocation();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [checks, setChecks] = useState([]);
    const [threads, setThreads] = useState([]);   // KYC clarification threads, open and closed (20261203)
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [ciRequest, setCiRequest] = useState(null);
    const [docProgress, setDocProgress] = useState(null); // assigned AO only: step 1's { total, confirmed }
    const [currentKey, setCurrentKey] = useState(OVERVIEW);
    const [openedHash, setOpenedHash] = useState('');
    const [pendingField, setPendingField] = useState(null); // { ids }: the Document check's arrow, field to flash
    const [saved, setSaved] = useState(false);
    const [kycFilter, setKycFilter] = useState('ALL'); // shared by the KYC ring's legend and the section board
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const historyRef = useRef(null);
    const mainRef = useRef(null);
    const scrollOnOpen = useRef(false);
    const wantHistory = useRef(false);

    // Checks + history + latest CI request (+ the names of whoever made them)
    const loadTrail = useCallback(async () => {
        const [nextChecks, nextAudit, ciRequests, nextThreads] = await Promise.all([
            fetchKycChecks(applicationId), fetchAuditLog(applicationId), fetchCiRequests(applicationId),
            // the threads are extra: if they can't load (migration not run yet), the page still opens
            fetchThreads(applicationId).catch(() => [])]);
        const latestCi = ciRequests.at(-1) ?? null;
        setChecks(nextChecks);
        setThreads(nextThreads);
        setAudit(nextAudit);
        setCiRequest(latestCi);
        setNames(await fetchStaffNames([...nextChecks.map((c) => c.checked_by), ...nextAudit.map((a) => a.changed_by),
            ...nextAudit.map((a) => (a.new_data ?? a.old_data)?.user_id),
            ...nextAudit.map((a) => a.new_data?.confirmed_by), latestCi?.requested_by]));
    }, [applicationId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const editable = await fetchCanEdit(applicationId);
                // Only the editing AO re-derives the document checklist; others just read
                const data = editable ? await refreshApplication(applicationId) : await fetchApplication(applicationId);
                if (cancelled) return;
                setCanEdit(editable);
                setApp(data);
                // Step 1's count is only a hint: if it fails, the step still opens, just without a count
                if (editable) {
                    fetchDocumentProgress(documentsOf(data))
                        .then((p) => { if (!cancelled) setDocProgress(p); }, () => {});
                }
                await loadTrail();
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applicationId, loadTrail]);

    // A reply notification (#kyc-<section>) clicked while the folder is already open: load the threads again
    useEffect(() => {
        if (hash.startsWith('#kyc-') && app) fetchThreads(applicationId).then(setThreads, () => {});
    }, [hash, applicationId, app]);

    // History (header button / dashboard tile) asked while the history wasn't on screen (the editing AO was in a
    // section): the page switched to the overview first, so finish once it has rendered
    useEffect(() => {
        if (wantHistory.current && historyRef.current) {
            wantHistory.current = false;
            revealHistory(historyRef.current);
        }
    });

    // A section just opened (open() below): bring its top into view when it's scrolled off above, e.g. after pressing
    // Next at the bottom of a long form. Lands below the sticky top bar (html scroll-padding-top).
    useEffect(() => {
        if (!scrollOnOpen.current) return;
        scrollOnOpen.current = false;
        const el = mainRef.current;
        if (!el) return;
        const barOffset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        if (el.getBoundingClientRect().top < barOffset) {
            el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        }
    }, [currentKey]);

    // The Document check's arrow (&field=<id>[,<fallback>]#kyc-<section>, kycTargets.js): once the section has
    // rendered, scroll to the first of those form fields that exists, flash it and put the cursor in it
    useEffect(() => {
        if (!pendingField) return undefined;
        const timer = setTimeout(() => {
            setPendingField(null);
            // fields.jsx gives a dropdown the id with every "s" run turned into "_", so try that spelling too
            const el = pendingField.ids.flatMap((id) => [id, id.replace(/s+/g, '_')])
                .map((id) => document.getElementById(id)).find(Boolean);
            const box = el?.closest('.ct-field, .ct-check') ?? el?.closest('fieldset') ?? null;
            if (!box) return;
            box.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
            box.classList.remove('lf-flash');
            void box.offsetWidth;   // restart the animation if the same field is flashed twice
            box.classList.add('lf-flash');
            (el.matches('input, textarea, button') ? el : el.querySelector('input, textarea, button'))?.focus({ preventScroll: true });
        }, 120);
        return () => clearTimeout(timer);
    }, [pendingField, currentKey]);

    // A message's topic chip (#kyc-<section>) opens that section for the editing AO: once per link, when the file
    // has loaded (state adjusted while rendering, not in an effect)
    if (app && canEdit && hash !== openedHash) {
        setOpenedHash(hash);
        const key = hash.startsWith('#kyc-') ? hash.slice(5) : null;
        if (key && sectionsFor(app).some((s) => s.key === key)) {
            setCurrentKey(key);
            setSaved(false);
            const field = searchParams.get('field');
            if (field) setPendingField({ ids: field.split(',').filter(Boolean) });
        }
    }

    if (loading) return <LoanFolderSkeleton />;
    if (error && !app) {
        return (
            <div className="lf lf-folder">
                <p className="lf-err" role="alert">{error}</p>
            </div>
        );
    }
    if (!app) return null;

    const sections = sectionsFor(app);
    const latestCheck = (key) => checks.findLast((c) => c.section === key) ?? null;
    const counts = kycCounts(sections, latestCheck);
    const verifiedCount = counts.VERIFIED;
    const section = sections.find((s) => s.key === currentKey) ?? null;

    // KYC clarification threads (kycClarify/): per section, open and closed
    const threadsFor = (key) => threads.filter((t) => t.section === key);
    const openThreadFor = (key) => threadsFor(key).find((t) => t.status === 'OPEN') ?? null;
    // A Needs clarification recorded before the threads existed (or by staff tooling) has no question sent
    const unsent = (check) => check?.result === 'NEEDS_CLARIFICATION' && !threads.some((t) => t.opened_check_id === check.id);
    // The board's line for a section: the editing AO opens the section to answer; anyone else reads the thread here
    const askFor = (s, check) => {
        const sectionThreads = threadsFor(s.key);
        const open = sectionThreads.find((t) => t.status === 'OPEN');
        if (!canEdit && sectionThreads.length > 0) return <AoThread threads={sectionThreads} canAnswer={false} onChanged={loadTrail} />;
        if (open) {
            const replies = open.messages.filter((m) => m.from === 'APPLICANT').length;
            return <p className="lf-kyc-meta">Question open: {replies ? `the applicant replied (${replies})` : 'waiting for the applicant'}</p>;
        }
        if (unsent(check)) return <p className="lf-kyc-meta">No question was sent. Mark it again to ask the applicant.</p>;
        return null;
    };

    const refresh = async () => {
        const data = await refreshApplication(app.id);
        setApp(data);
        await loadTrail();
        return data;
    };

    const handleSaved = async () => {
        await refresh();
        setSaved(true);
    };

    // Opening a section (nav, pager, the check panel's Next / Request CI) brings its top into view (effect above)
    const open = (key) => {
        scrollOnOpen.current = true;
        setCurrentKey(key);
        setSaved(false);
    };

    // After a KYC check is recorded: reload the trail and stay on the section; the Next button in the check panel moves on
    const handleRecorded = async () => {
        await loadTrail();
    };

    // The AO keeps editing after the request (Intake -> Credit Investigation); just reload
    const handleCiRequested = async () => {
        await refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleViewDocument = async (doc) => {
        try {
            window.open(await getDocumentUrl(doc), '_blank', 'noopener');
        } catch (err) {
            setError(err.message);
        }
    };

    const scrollTo = (el) => el?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    // A ring legend key filters the section board just below it
    const filterBoard = (key) => {
        setKycFilter(key);
        scrollTo(document.getElementById('lf-kyc-board'));
    };
    // History button / tile: the history lives in the overview, so the editing AO is taken there first
    const openHistory = () => {
        if (historyRef.current) {
            revealHistory(historyRef.current);
            return;
        }
        wantHistory.current = true;
        open(OVERVIEW);
    };

    const isAo = role === 'ACCOUNT_OFFICER';
    // Step 2 opens the first section that isn't verified yet
    const openKyc = () => open((sections.find((s) => statusOf(latestCheck(s.key)) !== 'VERIFIED') ?? sections[0])?.key ?? OVERVIEW);

    const decisionLink = DSS_ROLES.includes(role) && (
        <Link to={`/decisionSupportPage?id=${app.id}`} className={`lf-btn${isAo ? ' quiet' : ''}`}>
            <Scale size={16} aria-hidden="true" />Decision support
        </Link>
    );
    const packageLink = (
        <Link to={`/financialPackagePage?id=${app.id}`} className={`lf-btn${isAo ? ' quiet' : ''}`}>
            Financial package<ArrowRight size={16} aria-hidden="true" />
        </Link>
    );

    const header = (
        <>
            <Breadcrumbs current="folder" appId={app.id} appNo={app.application_no} />
            <header className="lf-hero">
                <div className="lf-hero-main">
                    <p className="lf-eyebrow">
                        <FolderOpen size={15} aria-hidden="true" />Loan folder
                        <span className={`lf-mode ${canEdit ? 'edit' : 'read'}`}>
                            {canEdit
                                ? <><PencilLine size={13} aria-hidden="true" />You can edit</>
                                : <><Lock size={13} aria-hidden="true" />Read-only</>}
                        </span>
                    </p>
                    <h1>Application <span className="lf-appno">{app.application_no}</span></h1>
                    <ul className="lf-meta">
                        {/* facts: a quiet label, then the value (DESIGN.md 11.10) */}
                        <li>
                            <CalendarDays size={15} aria-hidden="true" /><span className="k">Submitted</span>
                            {app.submitted_at
                                ? <time className="v" dateTime={app.submitted_at} title={fullWhen(app.submitted_at)}>{formatDay(app.submitted_at)}</time>
                                : <span className="v">—</span>}
                        </li>
                        {ciRequest && (
                            <li>
                                <Send size={15} aria-hidden="true" />
                                <span className="k"><Term k="CI" /> requested</span>
                                <Byline layout="inline" name={names[ciRequest.requested_by]} fallback="Account Officer" at={ciRequest.requested_at} />
                            </li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <button type="button" className="lf-btn" onClick={openHistory}>
                        <History size={16} aria-hidden="true" />History
                        {audit.length > 0 && (
                            <>
                                <span className="lf-btn-n" aria-hidden="true">{audit.length}</span>
                                <span className="sr-only"> ({audit.length} {audit.length === 1 ? 'change' : 'changes'})</span>
                            </>
                        )}
                    </button>
                    <MessagesPanel applicationId={app.id} inline />
                    {/* The assigned AO reaches the document check from step 1 below */}
                    {!canEdit && (
                        <Link to={`/documentCheckPage?id=${app.id}`} className="lf-btn">
                            <ScanText size={16} aria-hidden="true" />Document check
                        </Link>
                    )}
                    {!isAo && decisionLink}
                    {!isAo && packageLink}
                </div>
            </header>
            {!canEdit && (
                <p className="lf-note">
                    <Lock size={16} aria-hidden="true" />
                    <span>
                        Read-only. Only the assigned Account Officer can edit, while the application is in Intake or Credit Investigation.
                        {isAo && ' Your Manager can reassign it to you.'}
                    </span>
                </p>
            )}
        </>
    );

    // Dashboard row: the AO's steps, or (read-only) the KYC ring and two tiles
    const dashboard = canEdit ? (
        <section className="lf-card lf-stepcard" aria-label="Your steps">
            <AoSteps
                appId={app.id}
                docProgress={docProgress}
                verifiedCount={verifiedCount}
                sectionCount={sections.length}
                ciRequest={ciRequest}
                openStep={currentKey === REQUEST_CI ? 'ci' : section ? 'kyc' : null}
                onOpenKyc={openKyc}
                onOpenCi={() => open(REQUEST_CI)} />
            {isAo && (
                <OptionalView who="Account Officers">
                    {decisionLink}
                    {packageLink}
                </OptionalView>
            )}
        </section>
    ) : (
        <>
            <section className="lf-dash" aria-label="Overview">
                <KycProgress counts={counts} filter={kycFilter} onFilter={filterBoard} />
                <div className={`lf-tile${ciRequest ? ' done' : ''}`}>
                    <span className="ic"><Send size={18} aria-hidden="true" /></span>
                    <span className="lbl">Credit investigation</span>
                    <span className="val">{ciRequest ? 'Requested' : 'Not requested'}</span>
                    <span className="sub">
                        {ciRequest
                            ? <time dateTime={ciRequest.requested_at} title={fullWhen(ciRequest.requested_at)}>{formatWhen(ciRequest.requested_at)}</time>
                            : 'Sent by the Account Officer after KYC'}
                    </span>
                </div>
                <button type="button" className="lf-tile action" onClick={openHistory}>
                    <span className="ic"><History size={18} aria-hidden="true" /></span>
                    <span className="lbl">Change history</span>
                    <span className="val">{audit.length}</span>
                    <span className="sub">
                        {audit.length === 1 ? 'change' : 'changes'} since submission
                        <ArrowRight size={14} className="go" aria-hidden="true" />
                    </span>
                </button>
            </section>
            {isAo && (
                <OptionalView who="Account Officers">
                    {decisionLink}
                    {packageLink}
                </OptionalView>
            )}
        </>
    );

    const overview = (
        <>
            <KycBoard
                sections={sections} latestCheck={latestCheck} names={names} counts={counts}
                filter={kycFilter} onFilter={setKycFilter} canEdit={canEdit} onOpen={open} askFor={askFor} />
            <ApplicationDetails app={app} onViewDocument={handleViewDocument} />
            {/* Collapsed until opened: the history gets long and pushes everything else down */}
            <details ref={historyRef} id="lf-history" className="lf-card lf-history">
                <summary>
                    <span className="lf-history-ic"><History size={18} aria-hidden="true" /></span>
                    <h2>Change history</h2>
                    <span className="lf-history-count">{audit.length} {audit.length === 1 ? 'entry' : 'entries'}</span>
                    <ChevronDown size={18} className="lf-history-chevron" aria-hidden="true" />
                </summary>
                <div className="lf-history-body">
                    <ChangeHistory app={app} entries={audit} names={names} tools />
                </div>
            </details>
        </>
    );

    // Notices and document requests, shown when they apply. Both are in the staff look (dr-* in requestPanel.css)
    // and follow dark mode
    const panels = (reloadKey) => (
        <div className="lf-panels">
            <SendNoticePanel applicationId={app.id} />
            {/* New KYC checks change the suggestions */}
            <RequestPanel applicationId={app.id} reloadKey={reloadKey} />
        </div>
    );

    if (!canEdit) {
        return (
            <div className="lf lf-folder">
                {header}
                {dashboard}
                {panels(undefined)}
                {error && <p className="lf-err" role="alert">{error}</p>}
                <div className="lf-body"><div className="lf-main">{overview}</div></div>
            </div>
        );
    }

    const Component = section?.Component;
    const at = section ? sections.indexOf(section) : -1;
    const next = sections[at + 1];

    const sectionView = section && (
        <div className="lf-secview" key={section.key}>
            <header className="lf-card lf-sechead">
                <div className="lf-sechead-main">
                    <p className="lf-eyebrow">
                        <StatusIcon status={statusOf(latestCheck(section.key))} size={15} />
                        Section {at + 1} of {sections.length}
                        {!section.complete && <span className="lf-tag">Incomplete</span>}
                    </p>
                    <h2>{section.title}</h2>
                </div>
                {/* the files of the person this section is about, in a popup (none for loan, references ...) */}
                <SectionDocuments app={app} sectionKey={section.key} sectionTitle={section.title} />
            </header>
            <div className="lf-secgrid">
                <aside className="lf-rail" aria-label="KYC check">
                    <KycCheckPanel
                        key={`check-${section.key}`}
                        applicationId={app.id}
                        section={section.key}
                        complete={section.complete}
                        latest={latestCheck(section.key)}
                        names={names}
                        extra={unsent(latestCheck(section.key))
                            ? <p className="lf-kyc-meta">No question was sent. Mark it again to ask the applicant.</p> : null}
                        openThread={Boolean(openThreadFor(section.key))}
                        onRecorded={handleRecorded}
                        onNext={() => open(next?.key ?? REQUEST_CI)}
                        nextLabel={next ? 'Next' : 'Request CI'} />
                    {threadsFor(section.key).length > 0 && (
                        <AoQuestionCard key={`thread-${section.key}`} section={section.key} sectionLabel={section.title}
                            threads={threadsFor(section.key)} canWithdraw={canEdit} complete={section.complete} onChanged={loadTrail} />
                    )}
                </aside>
                <div className="lf-card lf-formcard lf-paper">
                    <p className="lf-formcard-head">
                        <PencilLine size={15} aria-hidden="true" />
                        <span>The applicant&apos;s answers. Correct anything the documents show differently, then record the check.</span>
                    </p>
                    {saved && <p className="lf-ok-note" role="status">Changes saved.</p>}
                    <StepSaveLabel.Provider value="Save">
                        <Component
                            key={section.key}
                            {...section.props}
                            app={app}
                            session={session}
                            profile={null}
                            complete={section.complete}
                            onSaved={handleSaved}
                            onRefresh={refresh}
                            onBack={null}
                            viewOnly={section.key === 'documents'}
                        />
                    </StepSaveLabel.Provider>
                </div>
            </div>
        </div>
    );

    return (
        <div className="lf lf-folder">
            {header}
            {dashboard}
            {panels(checks)}
            <div className={`lf-body edit${sidePanel.hidden ? ' side-hidden' : ''}`}>
                {sidePanel.hidden ? <PanelRail panel={sidePanel} label="sections" /> : (
                <nav className="lf-card lf-nav" aria-label="Loan folder sections">
                    <PanelHide panel={sidePanel} label="sections" />
                    <ol>
                        <li>
                            <button type="button" onClick={() => open(OVERVIEW)} aria-current={currentKey === OVERVIEW}>
                                <LayoutList size={18} className="lf-ico none" aria-hidden="true" />
                                <span className="label">Overview & history</span>
                            </button>
                        </li>
                        <li className="lf-nav-grp"><span className="n" aria-hidden="true">1</span>Documents</li>
                        <li>
                            <Link to={`/documentCheckPage?id=${app.id}`}>
                                <ScanText size={18} aria-hidden="true" />
                                <span className="label">Document check</span>
                                {docProgress?.total > 0 && (
                                    <span className={`lf-nav-cnt${docProgress.confirmed === docProgress.total ? ' all' : ''}`}>
                                        {docProgress.confirmed}/{docProgress.total}<span className="sr-only"> confirmed</span>
                                    </span>
                                )}
                            </Link>
                        </li>
                        <li className="lf-nav-grp">
                            <span className="n" aria-hidden="true">2</span><Term k="KYC" /> verification
                            <span className={`lf-nav-cnt${verifiedCount === sections.length ? ' all' : ''}`}>
                                {verifiedCount}/{sections.length}<span className="sr-only"> verified</span>
                            </span>
                        </li>
                        {sections.map((s) => {
                            const check = latestCheck(s.key);
                            return (
                                <li key={s.key}>
                                    <button type="button" onClick={() => open(s.key)} aria-current={s.key === section?.key}>
                                        <StatusIcon status={statusOf(check)} />
                                        <span className="label">
                                            {s.title}
                                            <span className="sr-only">: {check ? RESULT_LABELS[check.result] : 'not checked'}</span>
                                        </span>
                                        {!s.complete && <span className="lf-tag">Incomplete</span>}
                                    </button>
                                </li>
                            );
                        })}
                        <li className="lf-nav-grp"><span className="n" aria-hidden="true">3</span>Credit investigation</li>
                        <li>
                            <button type="button" title={tt('Request CI (NFIS & TU)')} onClick={() => open(REQUEST_CI)} aria-current={currentKey === REQUEST_CI}>
                                <Send size={18} aria-hidden="true" />
                                <span className="label">Request CI (NFIS & TU)</span>
                                {ciRequest && <span className="lf-chip ok">Sent</span>}
                            </button>
                        </li>
                    </ol>
                </nav>
                )}

                <main className="lf-main" ref={mainRef}>
                    {error && <p className="lf-err" role="alert">{error}</p>}
                    {currentKey === REQUEST_CI ? (
                        <div className="lf-secview lf-ciview" key="ci">
                            <RequestCiPanel
                                app={app}
                                ciRequest={ciRequest}
                                requesterName={names[ciRequest?.requested_by]}
                                verifiedCount={verifiedCount}
                                sectionCount={sections.length}
                                blockedNote={stageBlockNote(openSectionsText(threads))}
                                onRequested={handleCiRequested} />
                        </div>
                    ) : section ? sectionView : (
                        <div className="lf-secview" key="overview">{overview}</div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default LoanFolderPage;
