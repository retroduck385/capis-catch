// MRAC check inside the Financial Package. Queues a check for the mrac-service worker and shows the result next to the
// credit score. Everything here is a SUGGESTION: the CO adds a suggested exception to V. Exception/s with one click
// and edits it. The panel sits inside the FP <form>, so every button is type="button".
// The result itself is drawn by MracResult (shared with the Decision Support page).
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import { fetchLatestMracCheck, requestMracCheck, waitForMracRun } from './api';
import { buildMracFacts } from './facts';
import MracResult from './mracResult';
import './mrac.css';

// Kept for older imports; the components now live in mracResult.jsx
export { Citation, Citations } from './mracResult';

const MracPanel = ({ app, computed, score, pricing, exceptions, canEdit, onAddException }) => {
    const [run, setRun] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetchLatestMracCheck(app.id)
            .then((latest) => { if (!cancelled) setRun(latest); })
            .catch(() => {}); // a missing history shouldn't block the page
        return () => { cancelled = true; };
    }, [app.id]);

    const handleCheck = async () => {
        setBusy(true);
        setError(null);
        try {
            // Uses the figures on screen now, including unsaved edits (the result stores the facts it was run on)
            const id = await requestMracCheck(app.id, buildMracFacts({ app, computed, score, pricing, exceptions }));
            setRun(await waitForMracRun(id));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const result = run?.status === 'DONE' ? run.result : null;

    return (
        <Section id="fp-mrac" title="Policy check (MRAC)" className="mrac">
            <p className="fp-note">
                Checks the figures on this page against the enabled MRAC criteria and finds the policy clauses that apply.
                These are suggestions: nothing is saved to the Financial Package until you add it and save.
            </p>
            <div className="mrac-actions">
                <button type="button" className="mrac-btn" onClick={handleCheck} disabled={!canEdit || busy}>
                    <ShieldCheck size={18} aria-hidden="true" />
                    {busy ? 'Checking...' : result ? 'Check again' : 'Check against policy'}
                </button>
                {!canEdit && <small>Only the assigned Credit Officer can run a check.</small>}
                {canEdit && <small>Uses the figures on screen, including unsaved changes.</small>}
            </div>
            {error && <p className="mrac-err" role="alert">{error}</p>}
            {run?.status === 'FAILED' && !error && <p className="mrac-err">The last check failed: {run.error}</p>}
            {!run && !busy && <p className="fp-empty">No check has been run for this application yet.</p>}

            {result && <MracResult key={run.id} run={run} onAddException={canEdit ? onAddException : undefined} />}
        </Section>
    );
};

export default MracPanel;
