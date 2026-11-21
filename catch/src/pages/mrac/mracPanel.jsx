// MRAC check inside the Financial Package. Queues a check for the mrac-service worker and shows the result next to the
// credit score. Everything here is a SUGGESTION: the CO adds a suggested exception to V. Exception/s with one click
// and edits it. The panel sits inside the FP <form>, so every button is type="button".
// The result itself is drawn by MracResult (shared with the Decision Support page).
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchFindingReviews, fetchLatestMracCheck, fetchProfileInputs, requestMracCheck, waitForMracRun } from './api';
import { buildMracFacts } from './facts';
import { buildPolicyProfile } from './profile';
import MracResult from './mracResult';
import './mrac.css';
import { Term } from '../../components/term';

// Kept for older imports; the components now live in mracResult.jsx
export { Citation, Citations } from './mracResult';

const MracPanel = ({ app, computed, score, pricing, exceptions, canEdit, onAddException, onAddTerm }) => {
    const [run, setRun] = useState(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [reviews, setReviews] = useState({});
    const [names, setNames] = useState({});

    useEffect(() => {
        let cancelled = false;
        fetchLatestMracCheck(app.id)
            .then((latest) => { if (!cancelled) setRun(latest); })
            .catch(() => {}); // a missing history shouldn't block the page
        return () => { cancelled = true; };
    }, [app.id]);

    // The CO's decisions on the findings of the shown run, and who made them (same pattern as useFileMarks)
    const [reviewVersion, setReviewVersion] = useState(0);
    const doneRunId = run?.status === 'DONE' ? run.id : null;
    useEffect(() => {
        if (!doneRunId) return undefined;
        let cancelled = false;
        (async () => {
            const rows = await fetchFindingReviews(doneRunId);
            const who = await fetchStaffNames(Object.values(rows).map((r) => r.reviewed_by)).catch(() => ({}));
            if (!cancelled) {
                setReviews(rows);
                setNames(who);
            }
        })();
        return () => { cancelled = true; };
    }, [doneRunId, reviewVersion]);
    const reloadReviews = () => setReviewVersion((v) => v + 1);

    const handleCheck = async () => {
        setBusy(true);
        setError(null);
        setProgress('Sending the figures and the file profile');
        try {
            // Uses the figures on screen now, including unsaved edits (the run stores the facts and profile it was run on)
            const facts = buildMracFacts({ app, computed, score, pricing, exceptions });
            const profile = buildPolicyProfile({ app, computed, score, exceptions, facts, ...await fetchProfileInputs(app) });
            const id = await requestMracCheck(app.id, facts, profile);
            setProgress('Waiting for the policy worker');
            setRun(await waitForMracRun(id, { onProgress: (r) => r.progress && setProgress(r.progress) }));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const result = run?.status === 'DONE' ? run.result : null;

    return (
        <Section id="fp-mrac" title="Policy check (MRAC)" className="mrac fp-key">
            <p className="fp-note">
                Checks this file against the enabled <Term k="MRAC" /> criteria and reads the bank&apos;s policy clauses that apply
                to it: exceptions needed, documents to obtain, conditions for the terms. These are proposals: you accept, edit or
                dismiss each one, and nothing is saved to the Financial Package until you add it and save.
            </p>
            <div className="mrac-actions">
                <button type="button" className="mrac-btn" onClick={handleCheck} disabled={!canEdit || busy}>
                    <ShieldCheck size={18} aria-hidden="true" />
                    {busy ? 'Checking...' : result ? 'Check again' : 'Check against policy'}
                </button>
                {!canEdit && <small>Only the assigned Credit Officer can run a check.</small>}
                {canEdit && !busy && <small>Uses the figures on screen, including unsaved changes. Takes a minute or two.</small>}
                {busy && progress && <small role="status">{progress}…</small>}
            </div>
            {error && <p className="mrac-err" role="alert">{error}</p>}
            {run?.status === 'FAILED' && !error && <p className="mrac-err">The last check failed: {run.error}</p>}
            {!run && !busy && <p className="fp-empty">No check has been run for this application yet.</p>}

            {result && (
                <MracResult key={run.id} run={run} onAddException={canEdit ? onAddException : undefined}
                    onAddTerm={canEdit ? onAddTerm : undefined} canEdit={canEdit} reviews={reviews} names={names}
                    onReviewed={reloadReviews} />
            )}
        </Section>
    );
};

export default MracPanel;
