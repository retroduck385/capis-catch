// Loan folder: staff view of one submitted application, opened from the work tray.
// The assigned AO (while in Intake or Credit Investigation) edits each section with the same forms the applicant
// used and records a KYC check per section. Everyone else with access gets a read-only view.
// The assigned AO's header shows their work as numbered steps (aoSteps.jsx): document check, KYC, Request CI.
// For any AO, Decision support and the Financial Package sit apart under "Optional view": they are read-only to an AO.
import { LoanFolderSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Circle, LayoutList, Lock, Scale, ScanText, Send } from 'lucide-react';
import { DSS_ROLES } from '../../roles';
import Breadcrumbs from '../../components/breadcrumbs';
import OptionalView from '../../components/optionalView';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getDocumentUrl, getParties, refreshApplication } from '../applicationForm/api';
import ApplicationSummary from '../applicationForm/applicationSummary';
import { buildSteps } from '../applicationForm/steps';
import { fetchCiRequests } from '../ciRequest/api';
import { fetchDocumentProgress } from '../documentCheck/api';
import RequestCiPanel from '../ciRequest/requestCiPanel';
import { fetchAuditLog, fetchCanEdit, fetchKycChecks, fetchStaffNames } from './api';
import AoSteps from './aoSteps';
import ChangeHistory from './changeHistory';
import KycCheckPanel, { CheckChip, CheckSummary } from './kycCheckPanel';
import { RESULT_LABELS, whenOf } from './options';
import MessagesPanel from '../messages/messagesPanel';
import CommentButton from '../messages/commentButton';
import SendNoticePanel from '../applicantNotices/sendNoticePanel';
import RequestPanel from '../documentRequests/requestPanel';
import AskApplicantButton from '../documentRequests/ask';
import './loanFolder.css';
import { Term } from '../../components/term';
import { useTermTitle } from '../../components/useTermTitle';

const TONES = { VERIFIED: 'ok', NEEDS_CLARIFICATION: 'warn' };
const OVERVIEW = 'overview';
const REQUEST_CI = 'request-ci';

// Form sections the AO verifies (the wizard's steps without Review & Submit)
const sectionsFor = (app) => buildSteps(app).filter((s) => s.key !== 'review');
// Every uploaded document of every party (step 1 counts the ones the AI reads)
const documentsOf = (app) => getParties(app).flatMap((p) => (p.application_requirements ?? []).flatMap((r) => r.documents ?? []));

const LoanFolderPage = () => {
    const { session, role } = UserAuth();
    const tt = useTermTitle();
    const [searchParams] = useSearchParams();
    const { hash } = useLocation();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [checks, setChecks] = useState([]);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [ciRequest, setCiRequest] = useState(null);
    const [docProgress, setDocProgress] = useState(null); // assigned AO only: step 1's { total, confirmed }
    const [currentKey, setCurrentKey] = useState(OVERVIEW);
    const [openedHash, setOpenedHash] = useState('');
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Checks + history + latest CI request (+ the names of whoever made them)
    const loadTrail = useCallback(async () => {
        const [nextChecks, nextAudit, ciRequests] = await Promise.all([
            fetchKycChecks(applicationId), fetchAuditLog(applicationId), fetchCiRequests(applicationId)]);
        const latestCi = ciRequests.at(-1) ?? null;
        setChecks(nextChecks);
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

    // A message's topic chip (#kyc-<section>) opens that section for the editing AO: once per link, when the file
    // has loaded (state adjusted while rendering, not in an effect)
    if (app && canEdit && hash !== openedHash) {
        setOpenedHash(hash);
        const key = hash.startsWith('#kyc-') ? hash.slice(5) : null;
        if (key && sectionsFor(app).some((s) => s.key === key)) { setCurrentKey(key); setSaved(false); }
    }

    if (loading) return <LoanFolderSkeleton />;
    if (error && !app) return <p className="text-red-600">{error}</p>;
    if (!app) return null;

    const sections = sectionsFor(app);
    const latestCheck = (key) => checks.findLast((c) => c.section === key) ?? null;
    const verifiedCount = sections.filter((s) => latestCheck(s.key)?.result === 'VERIFIED').length;
    const section = sections.find((s) => s.key === currentKey) ?? null;

    // "Ask the applicant" on a section marked Needs clarification: the AO's remark becomes the note and that
    // borrower's still-missing documents are ticked (everyone's, for a section that isn't about one borrower)
    const borrowerOf = (key) => {
        const coBorrower = key.match(/^coBorrower-([0-9]+)$/);
        if (key.startsWith('principal')) return getParties(app, ['PRINCIPAL'])[0]?.id ?? null;
        if (key === 'spouse') return getParties(app, ['SPOUSE'])[0]?.id ?? null;
        if (coBorrower) return getParties(app, ['CO_BORROWER']).find((p) => p.party_no === Number(coBorrower[1]))?.id ?? null;
        return null;
    };
    const askFor = (s, check) => (check?.result === 'NEEDS_CLARIFICATION' ? (
        <p className="lf-kyc-meta">
            <AskApplicantButton applicationId={app.id}
                ask={{ missingFor: borrowerOf(s.key), note: check.remarks ?? '', from: `the KYC check of "${s.title}" (Needs clarification)` }} />
        </p>
    ) : null);

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

    const open = (key) => {
        setCurrentKey(key);
        setSaved(false);
    };

    // After a KYC check is recorded: reload the trail, then go to the next section (after the last one, Request CI)
    const handleRecorded = async () => {
        await loadTrail();
        const at = sections.findIndex((s) => s.key === currentKey);
        open(sections[at + 1]?.key ?? REQUEST_CI);
    };

    // The AO keeps editing after the request (Intake -> Credit Investigation); just reload
    const handleCiRequested = async () => {
        await refresh();
    };

    const handleViewDocument = async (doc) => {
        try {
            window.open(await getDocumentUrl(doc), '_blank', 'noopener');
        } catch (err) {
            setError(err.message);
        }
    };

    const progressPct = sections.length ? Math.round((verifiedCount / sections.length) * 100) : 0;
    const isAo = role === 'ACCOUNT_OFFICER';
    // Step 2 opens the first section that isn't verified yet
    const openKyc = () => open((sections.find((s) => latestCheck(s.key)?.result !== 'VERIFIED') ?? sections[0])?.key ?? OVERVIEW);

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
        <header className="lf-card">
            <div className="lf-titlerow">
                <div>
                    <h1>Application {app.application_no}</h1>
                    <ul className="lf-meta">
                        <li>Submitted {app.submitted_at ? whenOf(app.submitted_at) : '—'}</li>
                        {ciRequest && (
                            <li><Term k="CI" /> requested {whenOf(ciRequest.requested_at)} by {names[ciRequest.requested_by] ?? 'Account Officer'}</li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                    {/* The assigned AO reaches the document check from step 1 below */}
                    {!canEdit && (
                        <Link to={`/documentCheckPage?id=${app.id}`} className="lf-btn">
                            <ScanText size={16} aria-hidden="true" />Document check (AI)
                        </Link>
                    )}
                    {!isAo && decisionLink}
                    {!isAo && packageLink}
                </div>
            </div>

            {canEdit ? (
                <AoSteps
                    appId={app.id}
                    docProgress={docProgress}
                    verifiedCount={verifiedCount}
                    sectionCount={sections.length}
                    ciRequest={ciRequest}
                    openStep={currentKey === REQUEST_CI ? 'ci' : section ? 'kyc' : null}
                    onOpenKyc={openKyc}
                    onOpenCi={() => open(REQUEST_CI)} />
            ) : (
            <div className="lf-progress">
                <div className="lf-progress-top">
                    <span><Term k="KYC" /> verification</span>
                    <span><b>{verifiedCount}</b> of {sections.length} sections verified</span>
                </div>
                <div className="lf-meter" role="img" aria-label={`${progressPct}% of sections verified`}>
                    <span style={{ width: `${progressPct}%` }} />
                </div>
            </div>
            )}

            {isAo && (
                <OptionalView who="Account Officers">
                    {decisionLink}
                    {packageLink}
                </OptionalView>
            )}

            {!canEdit && (
                <p className="lf-note">
                    <Lock size={16} aria-hidden="true" />
                    <span>
                        Read-only. Only the assigned Account Officer can edit, while the application is in Intake or Credit Investigation.
                        {role === 'ACCOUNT_OFFICER' && ' Assign yourself in the work tray to edit.'}
                    </span>
                </p>
            )}
        </header>
        </>
    );

    const overview = (
        <>
            <section className="lf-card" aria-label="KYC verification by section">
                <div className="lf-cardhead">
                    <h2><Term k="KYC" /> verification</h2>
                    <span>{verifiedCount} of {sections.length} verified</span>
                </div>
                <ul className="lf-kyc">
                    {sections.map((s) => {
                        const check = latestCheck(s.key);
                        return (
                            <li key={s.key} id={canEdit ? undefined : `kyc-${s.key}`} className={`lf-kyc-item ${check ? TONES[check.result] : 'none'}`}>
                                <div className="lf-kyc-top">
                                    <b>{s.title}<CommentButton topic={`kyc-${s.key}`} /></b>
                                    <CheckChip check={check} />
                                </div>
                                <CheckSummary check={check} names={names} />
                                {askFor(s, check)}
                            </li>
                        );
                    })}
                </ul>
            </section>
            <ApplicationSummary app={app} onViewDocument={handleViewDocument} />
            {/* Collapsed until opened: the history gets long and pushes everything else down */}
            <details className="lf-card lf-history">
                <summary>
                    <h2>Change history</h2>
                    <span className="lf-history-count">{audit.length} {audit.length === 1 ? 'entry' : 'entries'}</span>
                    <ChevronDown size={18} className="lf-history-chevron" aria-hidden="true" />
                </summary>
                <ChangeHistory app={app} entries={audit} names={names} />
            </details>
        </>
    );

    if (!canEdit) {
        return (
            <div className="lf">
                {header}
                <SendNoticePanel applicationId={app.id} />
                <RequestPanel applicationId={app.id} />
                {error && <p className="lf-err">{error}</p>}
                <div className="lf-body"><div className="lf-main">{overview}</div></div>
            </div>
        );
    }

    const Component = section?.Component;

    const statusIcon = (check) => {
        if (check?.result === 'VERIFIED') return <CheckCircle2 size={18} className="lf-ico ok" aria-hidden="true" />;
        if (check) return <AlertTriangle size={18} className="lf-ico warn" aria-hidden="true" />;
        return <Circle size={18} className="lf-ico none" aria-hidden="true" />;
    };

    return (
        <div className="lf">
            {header}
            <SendNoticePanel applicationId={app.id} />
            {/* New KYC checks change the suggestions */}
            <RequestPanel applicationId={app.id} reloadKey={checks} />
            <div className="lf-body edit">
                <nav className="lf-card lf-nav" aria-label="Loan folder sections">
                    <ol>
                        <li>
                            <button type="button" onClick={() => open(OVERVIEW)} aria-current={currentKey === OVERVIEW}>
                                <LayoutList size={18} className="lf-ico none" aria-hidden="true" />
                                <span className="label">Overview & history</span>
                            </button>
                        </li>
                        <li className="lf-nav-grp">1 · Documents</li>
                        <li>
                            <Link to={`/documentCheckPage?id=${app.id}`}>
                                <ScanText size={18} aria-hidden="true" />
                                <span className="label">Document check (AI)</span>
                                {docProgress?.total > 0 && (
                                    <span className={`lf-chip ${docProgress.confirmed === docProgress.total ? 'ok' : 'none'}`}>
                                        {docProgress.confirmed}/{docProgress.total}
                                    </span>
                                )}
                            </Link>
                        </li>
                        <li className="lf-nav-grp">2 · <Term k="KYC" /> verification</li>
                        {sections.map((s) => {
                            const check = latestCheck(s.key);
                            return (
                                <li key={s.key}>
                                    <button type="button" onClick={() => open(s.key)} aria-current={s.key === section?.key}>
                                        {statusIcon(check)}
                                        <span className="label">
                                            {s.title}
                                            <span className="sr-only">: {check ? RESULT_LABELS[check.result] : 'not checked'}</span>
                                        </span>
                                        {!s.complete && <span className="lf-tag">Incomplete</span>}
                                    </button>
                                </li>
                            );
                        })}
                        <li className="lf-nav-grp">3 · Credit investigation</li>
                        <li>
                            <button type="button" title={tt('Request CI (NFIS & TU)')} onClick={() => open(REQUEST_CI)} aria-current={currentKey === REQUEST_CI}>
                                <Send size={18} aria-hidden="true" />
                                <span className="label">Request CI (NFIS & TU)</span>
                                {ciRequest && <span className="lf-chip ok">Sent</span>}
                            </button>
                        </li>
                    </ol>
                </nav>

                <main className="lf-main">
                    {error && <p className="lf-err">{error}</p>}
                    {currentKey === REQUEST_CI ? (
                        <RequestCiPanel
                            app={app}
                            ciRequest={ciRequest}
                            requesterName={names[ciRequest?.requested_by]}
                            verifiedCount={verifiedCount}
                            sectionCount={sections.length}
                            onRequested={handleCiRequested} />
                    ) : !section ? overview : (
                        <>
                            <h2>{section.title}</h2>
                            <KycCheckPanel
                                key={`check-${section.key}`}
                                applicationId={app.id}
                                section={section.key}
                                complete={section.complete}
                                latest={latestCheck(section.key)}
                                names={names}
                                extra={askFor(section, latestCheck(section.key))}
                                onRecorded={handleRecorded} />
                            {saved && <p className="lf-ok-note" role="status">Changes saved.</p>}
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
                            />
                        </>
                    )}
                </main>
            </div>
        </div>
    );
};

export default LoanFolderPage;
