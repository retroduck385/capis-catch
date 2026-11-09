// Credit Officer side of a reviewer's return (20261108_reviewer_signoff.sql):
//   ReturnNotice — banner on the Financial Package while a return is open (what to fix, link to VII. Approval)
//   ResendPanel  — on VII. Approval: the return(s), and for the assigned CO "what you changed" + send it back
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Section } from '../applicationForm/fields';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchReviewAssignments, fetchReviewCheckItems, fetchReviewDecisions, resendForReview } from './api';
import { reviewState } from './reviewChecks';
import { ReturnCard } from './reviewParts';

// Returns + who's who, or null while loading
const useReturns = (applicationId, version = 0) => {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [rows, decisions, checkItems] = await Promise.all([
                    fetchReviewAssignments(applicationId), fetchReviewDecisions(applicationId), fetchReviewCheckItems()]);
                const names = await fetchStaffNames([...rows.map((r) => r.user_id), ...decisions.map((d) => d.responded_by)]);
                if (!cancelled) setData({ rows, decisions, checkItems, names, state: reviewState(rows, decisions) });
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        })();
        return () => { cancelled = true; };
    }, [applicationId, version]);
    return { data, error };
};

export const ReturnNotice = ({ applicationId, link, onOpen }) => {
    const { data, error } = useReturns(applicationId);
    if (error) return <p className="ct-error">{error}</p>;
    const open = data?.state.openReturn;
    if (!open) return null;
    return (
        <div className="my-3">
            <p className="font-semibold text-red-700">A reviewer returned this for revision.</p>
            <ReturnCard decision={open} rows={data.rows} names={data.names} checkItems={data.checkItems}
                round={data.state.roundOf(open)} />
            <p>Fix it here and save, then{' '}
                <Link to={link} onClick={onOpen} className="underline">open VII. Approval</Link> to send it back to the reviewer.</p>
        </div>
    );
};

// canResend = assigned CO while in Credit Evaluation; onSent reloads the page's own data
export const ResendPanel = ({ applicationId, canResend, onSent }) => {
    const [version, setVersion] = useState(0);
    const { data, error: loadError } = useReturns(applicationId, version);
    const [response, setResponse] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [sent, setSent] = useState(false);

    const handleSend = async () => {
        const reviewer = data.state.current;
        if (!window.confirm(`Send it back to reviewer ${reviewer?.seq ?? ''} (${data.names[reviewer?.user_id] ?? 'Reviewer'})? `
            + 'Save the Financial Package first: the reviewer sees what is saved.')) return;
        setBusy(true);
        setError(null);
        try {
            await resendForReview(applicationId, response.trim());
            setResponse('');
            setSent(true);
            setVersion((v) => v + 1);
            onSent?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (loadError) return <p className="ct-error">{loadError}</p>;
    if (!data || data.state.returns.length === 0) return null;
    const { state, rows, names, checkItems } = data;
    const open = state.openReturn;

    return (
        <Section id="ar-returns" title="Returns from the reviewers">
            {sent && <p className="lf-ok-note" role="status">Sent back to the reviewer.</p>}
            {[...state.returns].reverse().map((d) => (
                <ReturnCard key={d.id} decision={d} rows={rows} names={names} checkItems={checkItems} round={state.roundOf(d)} />
            ))}
            {open && canResend && (
                <div className="rv-block">
                    <label className="ct-field rv-remarks">
                        What you changed (the reviewer sees this)
                        <textarea rows={3} value={response} disabled={busy} onChange={(e) => setResponse(e.target.value)} />
                    </label>
                    <p className="fp-note">
                        Review continues from reviewer {state.current?.seq ?? '?'} ({names[state.current?.user_id] ?? 'Reviewer'}).
                        Earlier reviewers' sign-offs stand. If you added an exception, the approval authority may go up.
                    </p>
                    <div>
                        <button type="button" disabled={busy || !response.trim()} onClick={handleSend}>
                            {busy ? 'Sending...' : 'Send back to the reviewer'}
                        </button>
                    </div>
                    {error && <p className="ct-error">{error}</p>}
                </div>
            )}
            {open && !canResend && (
                <p className="lf-note">Only the assigned Credit Officer sends it back, from Credit Evaluation.</p>
            )}
        </Section>
    );
};
