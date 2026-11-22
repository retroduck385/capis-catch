// Step-by-step housing loan application. Each step saves to Supabase as a DRAFT;
// the next step only unlocks once the current one is complete.
// Layout (applicationForm/applicantPages.css, .ap): a sticky glass sidebar (who, progress, loan summary, the steps in
// their groups, Save and exit) beside the step, whose form sits on a paper card that stays light in dark mode.
// A submitted application shows the same summary tiles as the staff loan folder (SummaryContext stacked).
import { ApplicationFormSkeleton } from '../components/skeleton';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { fetchProfile, getOrCreateDraft, getParty, refreshMyApplication } from './applicationForm/api';
import ApplicationSummary from './applicationForm/applicationSummary';
import { formatPeso } from './applicationForm/options';
import { buildSteps } from './applicationForm/steps';
import { ArrowLeft, Check, FileText } from 'lucide-react';
import ApplicantShell from '../components/applicantShell';
import { isProfileComplete } from './applicationForm/validators';
import ApplicantStatusLabel from './notifications/applicantStatusLabel';
import ApplicantStageTracker from './notifications/applicantStageTracker';
import ApplicantRequestCard from './documentRequests/applicantRequestCard';
import { SummaryContext } from './applicationForm/summaryContext';
import { formatDay } from '../components/people';
import './applicationForm/applicantPages.css';

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
                const data = await refreshMyApplication(id);
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

    // Moving to another step (Next, Back or the step list) keeps the same address, so the router's scroll-to-top
    // (components/scrollToTop.jsx, on a path change) doesn't run: start each step at the top of the page.
    useEffect(() => {
        if (currentKey) window.scrollTo(0, 0);
    }, [currentKey]);

    if (needsProfile) return <Navigate to="/profilePage?next=apply" replace />;
    if (loading) return <ApplicationFormSkeleton />;
    if (error) return <ApplicantShell><p className="ct-error" role="alert">{error}</p></ApplicantShell>;
    if (!app) return null;

    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || session?.user?.email;
    const initials = (fullName ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    const loanAmount = app.loan_amount ? formatPeso(app.loan_amount) : 'Not set yet';

    if (app.status !== 'DRAFT') {
        return (
            <div className="ap ap-view">
                <p className="ap-back">
                    <Link to="/applicantHomePage"><ArrowLeft size={16} aria-hidden="true" />Back to your applications</Link>
                </p>
                <header className="ap-viewhead">
                    <span className="ap-viewhead-icon" aria-hidden="true"><FileText size={22} /></span>
                    <div>
                        <p className="ap-eyebrow">Housing loan application</p>
                        <h1><span className="ct-mono">{app.application_no}</span></h1>
                        <p className="ap-facts">
                            {app.submitted_at
                                ? <span>Submitted <b>{formatDay(app.submitted_at)}</b></span>
                                : <span>Not submitted</span>}
                            {app.loan_amount && <span>Amount <b>{loanAmount}</b></span>}
                        </p>
                    </div>
                    <span className="ct-badge plain"><ApplicantStatusLabel application={app} /></span>
                </header>
                <ApplicantStageTracker application={app} />
                <ApplicantRequestCard applicationId={app.id} />
                <section className="ct-card ap-summary" aria-label="Your application">
                    <div className="ct-sheet-body">
                        <SummaryContext.Provider value={{ stacked: true, hideEmpty: false }}>
                            <ApplicationSummary app={app} />
                        </SummaryContext.Provider>
                    </div>
                </section>
            </div>
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
        const data = await refreshMyApplication(app.id);
        setApp(data);
        return data;
    };

    const handleSaved = async () => {
        let nextVisited = [...new Set([...visited, step.key])];
        const data = await refresh();
        // A married applicant whose spouse has no obligation rows must answer the spouse's part of Financial
        // Obligations (rows, or "has none") after the spouse step is saved: that step counts as not saved yet
        if (step.key === 'spouse') {
            const principal = getParty(data, 'PRINCIPAL');
            const spouse = getParty(data, 'SPOUSE');
            const spouseRows = ['bank_accounts', 'existing_loans', 'credit_cards'].reduce((n, k) => n + (spouse?.[k] ?? []).length, 0);
            if (principal?.civil_status === 'MARRIED' && spouse && spouseRows === 0) {
                nextVisited = nextVisited.filter((k) => k !== 'obligations');
            }
        }
        writeVisited(app.id, nextVisited);
        setVisited(nextVisited);
        const nextSteps = buildSteps(data);
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
    const groupOf = (key) => GROUPS.find(([, keys]) => keys.includes(key))?.[0];
    const doneCount = steps.filter((s) => s.complete && visited.includes(s.key)).length;
    const progress = doneCount / (steps.length - 1); // the review step can't be "done" until submitted

    return (
        <div className="ap ap-wizard ct-shell">
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
                    <Link to="/applicantHomePage" className="ap-exit">
                        <ArrowLeft size={16} aria-hidden="true" />Save and exit
                    </Link>
                </div>
            </aside>

            <section className="ct-content">
                <div className="inner">
                    <div className="ct-pagehead">
                        <div>
                            <p className="ap-eyebrow">
                                Step {currentIndex + 1} of {steps.length}
                                {groupOf(step.key) && <span>{groupOf(step.key)}</span>}
                            </p>
                            <h1>{step.title}</h1>
                            <p>Your answers save when you continue.</p>
                        </div>
                    </div>
                    <div className="ct-card ap-paper" key={step.key}>
                        <div className="ct-sheet-body">
                            <Component
                                key={step.key}
                                {...step.props}
                                app={app}
                                session={session}
                                profile={profile}
                                complete={step.complete}
                                saved={visited.includes(step.key)}
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
