// Loan folder: staff view of one submitted application, opened from the work tray.
// The assigned AO (while in Intake or Credit Investigation) edits each section with the same forms the applicant
// used and records a KYC check per section. Everyone else with access gets a read-only view.
import { LoanFolderSkeleton } from '../../components/skeleton';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, LayoutList, Lock, ScanText, Send } from 'lucide-react';
import Breadcrumbs from '../../components/breadcrumbs';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getDocumentUrl, refreshApplication } from '../applicationForm/api';
import ApplicationSummary from '../applicationForm/applicationSummary';
import { buildSteps } from '../applicationForm/steps';
import { fetchCiRequests } from '../ciRequest/api';
import RequestCiPanel from '../ciRequest/requestCiPanel';
import { fetchAuditLog, fetchCanEdit, fetchKycChecks, fetchStaffNames } from './api';
import ChangeHistory from './changeHistory';
import KycCheckPanel, { CheckChip, CheckSummary } from './kycCheckPanel';
import { RESULT_LABELS, whenOf } from './options';
import MessagesPanel from '../messages/messagesPanel';
import SendNoticePanel from '../applicantNotices/sendNoticePanel';
import RequestPanel from '../documentRequests/requestPanel';
import './loanFolder.css';

const TONES = { VERIFIED: 'ok', NEEDS_CLARIFICATION: 'warn' };
const OVERVIEW = 'overview';
const REQUEST_CI = 'request-ci';

// Form sections the AO verifies (the wizard's steps without Review & Submit)
const sectionsFor = (app) => buildSteps(app).filter((s) => s.key !== 'review');

const LoanFolderPage = () => {
    const { session, role } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [checks, setChecks] = useState([]);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [ciRequest, setCiRequest] = useState(null);
    const [currentKey, setCurrentKey] = useState(OVERVIEW);
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

    if (loading) return <LoanFolderSkeleton />;
    if (error && !app) return <p className="text-red-600">{error}</p>;
    if (!app) return null;

    const sections = sectionsFor(app);
    const latestCheck = (key) => checks.findLast((c) => c.section === key) ?? null;
    const verifiedCount = sections.filter((s) => latestCheck(s.key)?.result === 'VERIFIED').length;
    const section = sections.find((s) => s.key === currentKey) ?? null;

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
                            <li>CI requested {whenOf(ciRequest.requested_at)} by {names[ciRequest.requested_by] ?? 'Account Officer'}</li>
                        )}
                    </ul>
                </div>
                <div className="lf-actions">
                    <MessagesPanel applicationId={app.id} inline />
                    <Link to={`/documentCheckPage?id=${app.id}`} className="lf-btn">
                        <ScanText size={16} aria-hidden="true" />Document check (AI)
                    </Link>
                    <Link to={`/financialPackagePage?id=${app.id}`} className="lf-btn">
                        Financial package<ArrowRight size={16} aria-hidden="true" />
                    </Link>
                </div>
            </div>

            <div className="lf-progress">
                <div className="lf-progress-top">
                    <span>KYC verification</span>
                    <span><b>{verifiedCount}</b> of {sections.length} sections verified</span>
                </div>
                <div className="lf-meter" role="img" aria-label={`${progressPct}% of sections verified`}>
                    <span style={{ width: `${progressPct}%` }} />
                </div>
            </div>

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
                    <h2>KYC verification</h2>
                    <span>{verifiedCount} of {sections.length} verified</span>
                </div>
                <ul className="lf-kyc">
                    {sections.map((s) => {
                        const check = latestCheck(s.key);
                        return (
                            <li key={s.key} className={`lf-kyc-item ${check ? TONES[check.result] : 'none'}`}>
                                <div className="lf-kyc-top">
                                    <b>{s.title}</b>
                                    <CheckChip check={check} />
                                </div>
                                <CheckSummary check={check} names={names} />
                            </li>
                        );
                    })}
                </ul>
            </section>
            <ApplicationSummary app={app} onViewDocument={handleViewDocument} />
            <section className="lf-card" aria-label="Change history">
                <div className="lf-cardhead"><h2>Change history</h2></div>
                <ChangeHistory app={app} entries={audit} names={names} />
            </section>
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
                        <li className="sep">
                            <button type="button" onClick={() => open(REQUEST_CI)} aria-current={currentKey === REQUEST_CI}>
                                <Send size={18} aria-hidden="true" />
                                <span className="label">Request CI (NFIS & TU)</span>
                                {ciRequest && <span className="lf-chip ok">Sent</span>}
                            </button>
                        </li>
                        <li>
                            <Link to={`/documentCheckPage?id=${app.id}`}>
                                <ScanText size={18} aria-hidden="true" />
                                <span className="label">Document check (AI)</span>
                            </Link>
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
                                onRecorded={loadTrail} />
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
