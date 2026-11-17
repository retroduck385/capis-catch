// Pieces of the approver decision (20261110_approver_decision.sql): who decided what, what the authority still
// needs, and the approver's Approve / Approve with conditions / Disapprove form. Shown on the review summary page.
// RoutingPeople: the routing as rows (reviewers in order, approvers with their position), on VII. Approval and the
// review summary. Who and when are bylines (components/byline.jsx).
import { useEffect, useState } from 'react';
import Byline from '../../components/byline';
import { approvalProgress, positionLabel, splitRouting, tierLabel } from './approval';

// tier; rows = review_assignments rows; names = { [user_id]: name }; positions = { [user_id]: approval_position }
// showReviewers = false when the reviewers are already listed next to it (Decision support's sign-off timeline)
export const RoutingPeople = ({ tier, rows, names, positions = {}, myId, showReviewers = true }) => {
    const { reviewers, approvers } = splitRouting(rows);
    if (reviewers.length === 0 && approvers.length === 0) return <p className="fp-empty">Not sent for review yet.</p>;
    const you = (r) => r.user_id === myId && <span className="lf-chip none">You</span>;
    return (
        <>
            <dl className="fp-info">
                <div className="fp-info-row"><dt>Approval authority</dt><dd>{tierLabel(tier) ?? '—'}</dd></div>
            </dl>
            {showReviewers && <div className="rv-block">
                <h3 className="fp-subhead">Reviewed by (in review order)</h3>
                <ol className="ar-people">
                    {reviewers.map((r, i) => (
                        <li key={r.id ?? r.user_id}>
                            <span className="rv-seq" aria-hidden="true">{r.seq ?? i + 1}</span>
                            <span className="sr-only">Reviewer {r.seq ?? i + 1}: </span>
                            <Byline layout="inline" name={names[r.user_id]} fallback="Unknown" />
                            {you(r)}
                        </li>
                    ))}
                </ol>
            </div>}
            <div className="rv-block">
                <h3 className="fp-subhead">Approved by</h3>
                {approvers.length === 0 ? <p className="fp-empty">No approvers yet.</p> : (
                    <ul className="ar-people">
                        {approvers.map((r) => (
                            <li key={r.id ?? r.user_id}>
                                <Byline layout="inline" name={names[r.user_id]} fallback="Unknown" />
                                {you(r)}
                                {positionLabel(positions[r.user_id]) && <span className="lf-chip none">{positionLabel(positions[r.user_id])}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
};

// Form choices. "With conditions" is stored as APPROVED + conditions.
const CHOICES = [
    { value: 'APPROVE', label: 'Approve', tone: 'ok' },
    { value: 'CONDITIONS', label: 'Approve with conditions', tone: 'ok' },
    { value: 'DISAPPROVE', label: 'Disapprove', tone: 'warn' },
];

const decisionLabel = (d) => (d.action === 'DISAPPROVED' ? 'Disapproved'
    : d.conditions ? 'Approved with conditions' : 'Approved');

// tier = financial_packages.approval_tier; approvers = active APPROVER rows; positions = { [user_id]: position }
export const ApprovalProgress = ({ tier, approvers, decisions, names, positions, myId, stage }) => {
    if (approvers.length === 0) return <p className="fp-empty">No approvers routed yet.</p>;
    const progress = approvalProgress(tier, approvers, decisions, positions);
    const decided = stage === 'DECIDED';
    return (
        <div className="rv-block">
            <p><b>Approval authority:</b> {tierLabel(tier) ?? '—'}</p>
            {progress.groups.length > 0 && (
                <ul className="rv-items">
                    {progress.groups.map((g) => (
                        <li key={g.label}>
                            <span className={`lf-chip ${g.met ? 'ok' : g.possible ? 'none' : 'warn'}`}>
                                {g.met ? 'Approved' : g.possible ? 'Needed' : "Can't be met"}
                            </span>
                            <span>{g.label}</span>
                        </li>
                    ))}
                </ul>
            )}
            <ol className="rv-timeline">
                {approvers.map((r) => {
                    const d = progress.decisionOf(r);
                    const tone = d ? (d.action === 'APPROVED' ? 'ok' : 'warn') : 'none';
                    const position = positionLabel(d?.approval_position ?? positions[r.user_id]);
                    return (
                        <li key={r.id} className={`rv-step ${tone}`}>
                            <div className="rv-step-top">
                                <span className="rv-who">
                                    <Byline layout="inline" name={names[r.user_id]} fallback="Unknown" at={d?.decided_at} />
                                    {r.user_id === myId && <span className="lf-chip none">You</span>}
                                    {position && <span className="fp-note">{position}</span>}
                                </span>
                                <span className="lf-chip">
                                    {d ? decisionLabel(d) : decided ? 'Not needed' : stage === 'APPROVAL' ? 'Waiting for decision' : 'After review'}
                                </span>
                            </div>
                            {d && (
                                <>
                                    {d.conditions && (
                                        <p className="lf-kyc-remark whitespace-pre-wrap"><b>Conditions:</b> {d.conditions}</p>
                                    )}
                                    {d.remarks && <p className="lf-kyc-remark whitespace-pre-wrap">{d.remarks}</p>}
                                </>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};

// The approver's decision. onSubmit({ action, remarks, conditions }); afterText(choice) = what happens next (confirm)
// onProgress({ kind: 'approval', choiceLabel, ready }): for the progress bar in the page header
export const ApprovalForm = ({ onSubmit, afterText, busy, error, onProgress }) => {
    const [choice, setChoice] = useState('');
    const [conditions, setConditions] = useState('');
    const [remarks, setRemarks] = useState('');
    const isNo = choice === 'DISAPPROVE';
    const withConditions = choice === 'CONDITIONS';

    const dirty = choice !== '' || remarks.trim() !== '' || conditions.trim() !== '';
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const blockers = [
        !choice && 'Pick Approve, Approve with conditions or Disapprove.',
        withConditions && !conditions.trim() && 'Write the conditions.',
        isNo && !remarks.trim() && 'Give the reason for disapproving.',
    ].filter(Boolean);
    const ready = blockers.length === 0;
    const choiceLabel = CHOICES.find((c) => c.value === choice)?.label ?? null;
    useEffect(() => {
        onProgress?.({ kind: 'approval', choiceLabel, ready });
    }, [onProgress, choiceLabel, ready]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const label = CHOICES.find((c) => c.value === choice)?.label;
        if (!window.confirm(`${label}? ${afterText(choice)} This can't be undone.`)) return;
        onSubmit({
            action: isNo ? 'DISAPPROVED' : 'APPROVED',
            remarks: remarks.trim(),
            conditions: withConditions ? conditions.trim() : null,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="rv-form">
            <div className="rv-decision">
                <div className="rv-approve-choices" role="radiogroup" aria-label="Your decision">
                    {CHOICES.map((c) => (
                        <label key={c.value} className={`rv-radio ${c.tone}`}>
                            <input type="radio" name="approval-action" checked={choice === c.value}
                                onChange={() => setChoice(c.value)} disabled={busy} />
                            {c.label}
                        </label>
                    ))}
                </div>
                {withConditions && (
                    <label className="ct-field rv-remarks">
                        Conditions (required)
                        <textarea rows={3} value={conditions} disabled={busy}
                            placeholder="e.g. Submit the latest ITR before loan release"
                            onChange={(e) => setConditions(e.target.value)} />
                    </label>
                )}
                <label className="ct-field rv-remarks">
                    {isNo ? 'Reason for disapproving (required)' : 'Remarks (optional)'}
                    <textarea rows={3} value={remarks} disabled={busy} onChange={(e) => setRemarks(e.target.value)} />
                </label>
            </div>
            <div className="fp-savebar">
                <div className="state">
                    {error && <p className="ct-error">{error}</p>}
                    {blockers.length > 0
                        ? <ul className="rv-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                        : <span className="lf-chip ok">Ready to submit</span>}
                </div>
                <button type="submit" className="lf-primary" disabled={busy || blockers.length > 0}>
                    {busy ? 'Submitting...' : 'Submit decision'}
                </button>
            </div>
        </form>
    );
};
