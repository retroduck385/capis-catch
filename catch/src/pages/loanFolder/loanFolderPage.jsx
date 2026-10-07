// Loan folder: staff view of one submitted application, opened from the work tray.
// The assigned AO (while in Intake) edits each section with the same forms the applicant
// used and records a KYC check per section. Everyone else with access gets a read-only view.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../../context/authContext';
import { fetchApplication, getDocumentUrl, refreshApplication } from '../applicationForm/api';
import ApplicationSummary from '../applicationForm/applicationSummary';
import { buildSteps } from '../applicationForm/steps';
import { fetchAuditLog, fetchCanEdit, fetchKycChecks, fetchStaffNames } from './api';
import ChangeHistory from './changeHistory';
import KycCheckPanel, { CheckSummary } from './kycCheckPanel';
import { RESULT_LABELS } from './options';

const OVERVIEW = 'overview';

// Form sections the AO verifies (the wizard's steps without Review & Submit)
const sectionsFor = (app) => buildSteps(app).filter((s) => s.key !== 'review');

const LoanFolderPage = () => {
    const { session } = UserAuth();
    const [searchParams] = useSearchParams();
    const applicationId = Number(searchParams.get('id'));

    const [app, setApp] = useState(null);
    const [canEdit, setCanEdit] = useState(false);
    const [checks, setChecks] = useState([]);
    const [audit, setAudit] = useState([]);
    const [names, setNames] = useState({});
    const [currentKey, setCurrentKey] = useState(OVERVIEW);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Checks + history (+ the names of whoever made them)
    const loadTrail = useCallback(async () => {
        const [nextChecks, nextAudit] = await Promise.all([fetchKycChecks(applicationId), fetchAuditLog(applicationId)]);
        setChecks(nextChecks);
        setAudit(nextAudit);
        setNames(await fetchStaffNames([...nextChecks.map((c) => c.checked_by), ...nextAudit.map((a) => a.changed_by)]));
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

    if (loading) return <p>Loading loan folder...</p>;
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

    const handleViewDocument = async (doc) => {
        try {
            window.open(await getDocumentUrl(doc), '_blank', 'noopener');
        } catch (err) {
            setError(err.message);
        }
    };

    const header = (
        <div className="pb-2">
            <p><Link to="/adminHomePage" className="underline">Back to work tray</Link></p>
            <h2>Application {app.application_no}</h2>
            <p>Submitted: {app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</p>
            <p>KYC: {verifiedCount} of {sections.length} sections verified</p>
            {!canEdit && (
                <p className="italic">Read-only. Only the assigned Account Officer can edit, while the application is in Intake.</p>
            )}
        </div>
    );

    const overview = (
        <div>
            <div className="border p-3 my-3 text-left">
                <h3 className="font-semibold pb-1">KYC verification</h3>
                <ul>
                    {sections.map((s) => (
                        <li key={s.key} className="py-1">
                            <span className="font-semibold">{s.title}:</span>{' '}
                            <CheckSummary check={latestCheck(s.key)} names={names} />
                        </li>
                    ))}
                </ul>
            </div>
            <ApplicationSummary app={app} onViewDocument={handleViewDocument} />
            <div className="border p-3 my-3 text-left">
                <h3 className="font-semibold pb-1">Change history</h3>
                <ChangeHistory app={app} entries={audit} names={names} />
            </div>
        </div>
    );

    if (!canEdit) {
        return (
            <div className="max-w-3xl m-auto p-4 text-left">
                {header}
                {error && <p className="text-red-600">{error}</p>}
                {overview}
            </div>
        );
    }

    const Component = section?.Component;

    return (
        <div className="p-4 text-left">
            {header}
            <div className="flex gap-6">
                <nav className="w-64 shrink-0">
                    <ol>
                        <li>
                            <button type="button" onClick={() => open(OVERVIEW)}
                                className={`py-1 text-left ${!section ? 'font-bold underline' : ''}`}>
                                Overview & history
                            </button>
                        </li>
                        {sections.map((s, i) => {
                            const check = latestCheck(s.key);
                            return (
                                <li key={s.key}>
                                    <button type="button" onClick={() => open(s.key)}
                                        className={`py-1 text-left ${s.key === section?.key ? 'font-bold underline' : ''}`}>
                                        {i + 1}. {s.title}
                                        {' '}({check ? RESULT_LABELS[check.result] : 'not checked'}{s.complete ? '' : ', incomplete'})
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </nav>

                <main className="flex-1">
                    {error && <p className="text-red-600">{error}</p>}
                    {!section ? overview : (
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
                            {saved && <p className="text-green-700">Changes saved.</p>}
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
