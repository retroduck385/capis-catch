// Credit Officer side of a reviewer's return (20261108_reviewer_signoff.sql):
//   ReturnNotice — banner on the Financial Package (and the credit scoring page) while a return is open: what to fix,
//                  a "Go to" button per item marked Needs revision (returnTargets.js), link to VII. Approval.
//                  here: the page it is on ('/financialPackagePage' or '/creditScorePage'); onGoTo(hash): the FP jumps
//                  to one of its own sections (other pages open by link, guarded by onOpen)
//   ResendPanel  — on VII. Approval: the return(s), and for the assigned CO "what you changed" + send it back
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Section } from '../applicationForm/fields';
import { fetchStaffNames } from '../loanFolder/api';
import { fetchReviewAssignments, fetchReviewCheckItems, fetchReviewDecisions, resendForReview } from './api';
import { CHECK_SOURCES, reviewState } from './reviewChecks';
import { returnTargets } from './returnTargets';
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

export const ReturnNotice = ({ applicationId, link, onOpen, here = '/financialPackagePage', onGoTo }) => {
    const { data, error } = useReturns(applicationId);
    if (error) return <p className="ct-error">{error}</p>;
    const open = data?.state.openReturn;
    if (!open) return null;
    const targets = returnTargets(open, data.checkItems, CHECK_SOURCES);
    const hrefOf = (t) => `${t.path}?id=${applicationId}${t.hash ? `#${t.hash}` : ''}`;
    return (
        <div className="my-3">
            <p className="font-semibold text-red-700">A reviewer returned this for revision.</p>
            <ReturnCard decision={open} rows={data.rows} names={data.names} checkItems={data.checkItems}
                round={data.state.roundOf(open)} />
            {targets.length > 0 && (
                <div className="rv-fixlist">
                    <p className="rv-fixlist-h">Where to fix it</p>
                    <ul>
                        {targets.map((t) => (
                            <li key={t.code}>
                                <span className="rv-fixlist-what"><b>{t.label}</b>{t.remark && <>: {t.remark}</>}</span>
                                {!t.path ? null : t.path === here && !t.hash ? (
                                    <span className="rv-fixlist-here">On this page</span>
                                ) : t.path === here && onGoTo ? (
                                    <button type="button" className="rv-fixlist-go" onClick={() => onGoTo(t.hash)}>Go to {t.place}</button>
                                ) : (
                                    <Link to={hrefOf(t)} onClick={onOpen} className="rv-fixlist-go">
                                        {t.canFix ? `Go to ${t.place}` : `Open the ${t.place} (the Account Officer fixes this)`}
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
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
                        <button type="button" className="lf-primary" disabled={busy || !response.trim()} onClick={handleSend}>
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
