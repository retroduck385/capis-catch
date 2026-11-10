// Pieces of the approver decision (20261110_approver_decision.sql): who decided what, what the authority still
// needs, and the approver's Approve / Approve with conditions / Disapprove form. Shown on the review summary page.
import { useEffect, useState } from 'react';
import { approvalProgress, positionLabel, tierLabel } from './approval';

const when = (t) => new Date(t).toLocaleString();

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
                                    <b>{names[r.user_id] ?? 'Unknown'}{r.user_id === myId ? ' (you)' : ''}</b>
                                    {position && <span className="fp-note">{position}</span>}
                                </span>
                                <span className="lf-chip">
                                    {d ? decisionLabel(d) : decided ? 'Not needed' : stage === 'APPROVAL' ? 'Waiting for decision' : 'After review'}
                                </span>
                            </div>
                            {d && (
                                <>
                                    <p className="lf-kyc-meta">{when(d.decided_at)}</p>
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
export const ApprovalForm = ({ onSubmit, afterText, busy, error }) => {
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
                <div className="rv-approve-choices">
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
                        : <span className="fp-chip ok">Ready to submit</span>}
                </div>
                <button type="submit" disabled={busy || blockers.length > 0}>
                    {busy ? 'Submitting...' : 'Submit decision'}
                </button>
            </div>
        </form>
    );
};
