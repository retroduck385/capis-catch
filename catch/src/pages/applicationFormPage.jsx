// Step-by-step housing loan application. Each step saves to Supabase as a DRAFT;
// the next step only unlocks once the current one is complete.
import { ApplicationFormSkeleton } from '../components/skeleton';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchProfile, getOrCreateDraft, refreshApplication } from './applicationForm/api';
import ApplicationSummary from './applicationForm/applicationSummary';
import { formatPeso } from './applicationForm/options';
import { buildSteps } from './applicationForm/steps';
import { Check } from 'lucide-react';
import ApplicantShell from '../components/applicantShell';
import { isProfileComplete } from './applicationForm/validators';
import ApplicantStatusLabel from './notifications/applicantStatusLabel';
import ApplicantRequestCard from './documentRequests/applicantRequestCard';

// Which steps the applicant has saved at least once (so optional steps can't be skipped unseen)
const visitedKey = (applicationId) => `catch:visitedSteps:${applicationId}`;

const readVisited = (applicationId) => {
    try {
        return JSON.parse(localStorage.getItem(visitedKey(applicationId))) ?? [];
    } catch {
        return [];
    }
};

const writeVisited = (applicationId, keys) => {
    try {
        localStorage.setItem(visitedKey(applicationId), JSON.stringify(keys));
    } catch {
        // storage blocked; the applicant just re-confirms optional steps next time
    }
};

// Index of the furthest step the applicant may open
const firstOpenIndex = (steps, visited) => {
    const i = steps.findIndex((s) => !(s.complete && visited.includes(s.key)));
    return i === -1 ? steps.length - 1 : i;
};

const ApplicationFormPage = () => {
    const { session } = UserAuth();
    const [searchParams] = useSearchParams();
    const requestedId = searchParams.get('id');
    const userId = session?.user?.id;

    const [app, setApp] = useState(null);
    const [profile, setProfile] = useState(null);
    const [needsProfile, setNeedsProfile] = useState(false);
    const [visited, setVisited] = useState([]);
    const [currentKey, setCurrentKey] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const myProfile = await fetchProfile(userId);
                // Starting or continuing a draft needs a complete profile; viewing a specific one doesn't
                if (!requestedId && !isProfileComplete(myProfile)) {
                    if (!cancelled) setNeedsProfile(true);
                    return;
                }
                if (!cancelled) setProfile(myProfile);
                const id = requestedId ? Number(requestedId) : await getOrCreateDraft(userId);
                const data = await refreshApplication(id);
                if (cancelled) return;
                const seen = readVisited(id);
                const steps = buildSteps(data);
                setApp(data);
                setVisited(seen);
                setCurrentKey(steps[firstOpenIndex(steps, seen)].key);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [requestedId, userId]);

    if (needsProfile) return <Navigate to="/profilePage?next=apply" replace />;
    if (loading) return <ApplicationFormSkeleton />;
    if (error) return <ApplicantShell><p className="ct-error" role="alert">{error}</p></ApplicantShell>;
    if (!app) return null;

    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || session?.user?.email;
    const initials = (fullName ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    const loanAmount = app.loan_amount ? formatPeso(app.loan_amount) : 'Not set yet';

    if (app.status !== 'DRAFT') {
        return (
            <ApplicantShell wide={false}>
                <div className="ct-pagehead">
                    <div>
                        <h1>Application <span className="ct-mono">{app.application_no}</span></h1>
                        <p>{app.submitted_at ? `Submitted ${new Date(app.submitted_at).toLocaleDateString()}` : 'Not submitted'}</p>
                    </div>
                    <span className="ct-badge"><ApplicantStatusLabel application={app} /></span>
                </div>
                <ApplicantRequestCard applicationId={app.id} />
                <div className="ct-card">
                    <div className="ct-sheet-body">
                        <ApplicationSummary app={app} />
                    </div>
                </div>
                <p style={{ marginTop: '1rem' }}><Link to="/applicantHomePage" className="ct-link">Back to your applications</Link></p>
            </ApplicantShell>
        );
    }

    const steps = buildSteps(app);
    const openIndex = firstOpenIndex(steps, visited);
    const requestedIndex = steps.findIndex((s) => s.key === currentKey);
    // If an earlier step became incomplete (e.g. civil status changed to Married), fall back to it
    // Design preview: `npm run dev` only, never in a production build. Lets every step be opened without filling the ones before it.
    const previewAll = import.meta.env.DEV;
    const currentIndex = requestedIndex === -1 ? openIndex : (previewAll ? requestedIndex : Math.min(requestedIndex, openIndex));
    const step = steps[currentIndex];

    const refresh = async () => {
        const data = await refreshApplication(app.id);
        setApp(data);
        return data;
    };

    const handleSaved = async () => {
        const nextVisited = [...new Set([...visited, step.key])];
        writeVisited(app.id, nextVisited);
        setVisited(nextVisited);
        const nextSteps = buildSteps(await refresh());
        const i = nextSteps.findIndex((s) => s.key === step.key);
        setCurrentKey(nextSteps[Math.min(i + 1, nextSteps.length - 1)].key);
    };

    const { Component } = step;

    const GROUPS = [
        ['Your loan', ['loan']],
        ['About you', ['principalInfo', 'principalAddress', 'principalEmployment', 'spouse', 'coBorrowers', 'mortgagor']],
        ['Your finances and references', ['obligations', 'references', 'collateral']],
        ['Finish', ['documents', 'review']],
    ];
    const groupStart = Object.fromEntries(GROUPS.map(([label, keys]) => [keys[0], label]));
    const doneCount = steps.filter((s) => s.complete && visited.includes(s.key)).length;
    const progress = doneCount / (steps.length - 1); // the review step can't be "done" until submitted

    return (
        <div className="ct-shell">
            <aside className="ct-aside" aria-label="Application progress">
                <div className="ct-aside-inner">
                    <div className="ct-prog-head">
                        <div className="ct-profile">
                            <span className="ct-avatar lg" aria-hidden="true">{initials}</span>
                            <div>
                                <h2>{fullName}</h2>
                                <p className="id ct-mono">{app.application_no ?? 'DRAFT APPLICATION'}</p>
                                <span className="ct-badge warm">Draft</span>
                            </div>
                        </div>

                        <div className="ct-prog-meter">
                            <span className="ct-label">Application progress</span>
                            <p className="ct-meter-label"><span><strong>{doneCount}</strong> of {steps.length - 1} steps done</span><span>{Math.round(progress * 100)}%</span></p>
                            <div className="ct-meter" role="progressbar" aria-label="Application progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                                <span style={{ width: `${progress * 100}%` }} />
                            </div>
                        </div>

                        <div className="ct-box">
                            <span className="ct-label">Loan summary</span>
                            <div className="ct-kv"><span>Type</span><span>Housing loan</span></div>
                            <div className="ct-kv"><span>Amount</span><span className="ct-mono">{loanAmount}</span></div>
                            <div className="ct-kv"><span>Status</span><span>Draft</span></div>
                        </div>

                    </div>

                    <ol className="ct-steps">
                        {steps.map((s, i) => (
                            <li key={s.key} data-group={groupStart[s.key]} className={s.complete && visited.includes(s.key) ? 'is-done' : ''}>
                                <button type="button" disabled={i > openIndex && !previewAll}
                                    aria-current={i === currentIndex ? 'step' : undefined}
                                    onClick={() => setCurrentKey(s.key)}>
                                    <span className="n">{s.complete && visited.includes(s.key) ? <Check size={11} aria-label="done" /> : i + 1}</span>
                                    <span>{s.title}</span>
                                </button>
                            </li>
                        ))}
                    </ol>
                </div>
            </aside>
            <p className="ct-prog-exit"><Link to="/applicantHomePage" className="ct-link">Save and exit</Link></p>

            <section className="ct-content">
                <div className="inner">
                    <div className="ct-pagehead">
                        <div>
                            <h1>{step.title}</h1>
                            <p>Step {currentIndex + 1} of {steps.length}. Your answers save when you continue.</p>
                        </div>
                    </div>
                    <div className="ct-card">
                        <div className="ct-sheet-body">
                            <Component
                                key={step.key}
                                {...step.props}
                                app={app}
                                session={session}
                                profile={profile}
                                complete={step.complete}
                                onSaved={handleSaved}
                                onRefresh={refresh}
                                onBack={currentIndex > 0 ? () => setCurrentKey(steps[currentIndex - 1].key) : null}
                            />
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default ApplicationFormPage;
