// Step-by-step housing loan application. Each step saves to Supabase as a DRAFT;
// the next step only unlocks once the current one is complete.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserAuth } from '../context/authContext';
import { getOrCreateDraft, refreshApplication } from './applicationForm/api';
import ApplicationSummary from './applicationForm/applicationSummary';
import { buildSteps } from './applicationForm/steps';

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
    const [visited, setVisited] = useState([]);
    const [currentKey, setCurrentKey] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
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

    if (loading) return <p>Loading application...</p>;
    if (error) return <p className="text-red-600">{error}</p>;
    if (!app) return null;

    if (app.status !== 'DRAFT') {
        return (
            <div className="max-w-3xl m-auto p-4">
                <h2>Application {app.application_no}</h2>
                <p>Status: <strong>{app.status}</strong></p>
                {app.submitted_at && <p>Submitted: {new Date(app.submitted_at).toLocaleString()}</p>}
                <p className="py-2"><Link to="/applicantHomePage" className="underline">Back to home</Link></p>
                <ApplicationSummary app={app} />
            </div>
        );
    }

    const steps = buildSteps(app);
    const openIndex = firstOpenIndex(steps, visited);
    const requestedIndex = steps.findIndex((s) => s.key === currentKey);
    // If an earlier step became incomplete (e.g. civil status changed to Married), fall back to it
    const currentIndex = requestedIndex === -1 ? openIndex : Math.min(requestedIndex, openIndex);
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

    return (
        <div className="flex gap-6 p-4 text-left">
            <nav className="w-56 shrink-0">
                <p className="font-semibold pb-2">Housing Loan Application</p>
                <ol>
                    {steps.map((s, i) => (
                        <li key={s.key}>
                            <button type="button" disabled={i > openIndex}
                                className={`py-1 text-left ${i === currentIndex ? 'font-bold underline' : ''} ${i > openIndex ? 'opacity-40' : ''}`}
                                onClick={() => setCurrentKey(s.key)}>
                                {i + 1}. {s.title} {s.complete && visited.includes(s.key) ? '✓' : ''}
                            </button>
                        </li>
                    ))}
                </ol>
                <p className="pt-4"><Link to="/applicantHomePage" className="underline">Save & exit</Link></p>
            </nav>

            <main className="flex-1">
                <h2>{currentIndex + 1}. {step.title}</h2>
                <Component
                    key={step.key}
                    {...step.props}
                    app={app}
                    session={session}
                    complete={step.complete}
                    onSaved={handleSaved}
                    onRefresh={refresh}
                    onBack={currentIndex > 0 ? () => setCurrentKey(steps[currentIndex - 1].key) : null}
                />
            </main>
        </div>
    );
};

export default ApplicationFormPage;
