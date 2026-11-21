// The policy recommender's findings for one check run (mrac-service recommender.py -> result.recommendations), grouped
// for the Credit Officer: exceptions needed, documents / information to obtain, conditions for the T&Cs, then what is
// met. Every finding is a PROPOSAL with the clause it comes from; the assigned CO accepts, edits or dismisses each one
// (review_mrac_finding, logged in audit_log). Accepting an exception or a condition also adds it to this page's
// V. Exception/s or terms and conditions; the CO still saves the Financial Package.
// Without canEdit (Decision Support, other roles) it is read only and shows what the CO decided.
// Sits inside the FP <form>: every button is type="button".
import { useState } from 'react';
import { formatWhen, fullWhen, personName } from '../../components/people';
import { Terms } from '../../components/term';
import { APPROVAL_TIERS, suggestApprovalTier } from '../review/approval';
import { reviewFinding } from './api';
import Excerpt from './excerpt';

const GROUPS = [
    { key: 'exception', title: 'Exceptions needed', tone: 'bad',
        note: 'The file does not meet these. Each needs an exception approved by the approving authority, or a change to the file.' },
    { key: 'obtain', title: 'Documents and information to obtain', tone: 'warn',
        note: 'The policy applies, but the file cannot show yet whether it is met.' },
    { key: 'condition', title: 'Conditions for the terms and conditions', tone: 'plain',
        note: 'Things the policy requires at approval or release.' },
];
const DECISIONS = { ACCEPTED: ['Accepted', 'ok'], EDITED: ['Edited and accepted', 'ok'], DISMISSED: ['Dismissed', 'plain'] };

const pages = (f) => (f.manual_pages?.length ? `p. ${f.manual_pages.join(', ')}` : null);

const Clause = ({ f }) => (
    <details className="mrac-rec-clause">
        <summary>Read the clause</summary>
        <div className="mrac-cite">
            <div className="head">
                <span>{f.heading_path || f.chunk_key}</span>
                <span className="meta">{[f.document, pages(f), f.revision_date && `rev. ${f.revision_date}`].filter(Boolean).join(' · ')}</span>
                {f.chunk_status === 'draft' && <span className="mrac-chip warn">Unreviewed draft</span>}
            </div>
            <Excerpt text={f.excerpt} preview={600} />
        </div>
    </details>
);

// What the CO decided, with who and when
const Decision = ({ review, names }) => {
    const [label, tone] = DECISIONS[review.decision] ?? [review.decision, 'plain'];
    const who = personName(names?.[review.reviewed_by]);
    return (
        <p className="mrac-rec-decision">
            <span className={`mrac-chip ${tone}`}>{label}</span>
            <span className="meta">
                {who && `${who} · `}
                <time dateTime={review.reviewed_at} title={fullWhen(review.reviewed_at)}>{formatWhen(review.reviewed_at)}</time>
            </span>
            {review.reason && <span className="why">{review.reason}</span>}
        </p>
    );
};

// The editor for "Edit, then add": the exception row's three fields, or one line for a condition
const Editor = ({ group, initial, onSave, onCancel, busy }) => {
    const [value, setValue] = useState(initial);
    const set = (k) => (e) => setValue({ ...value, [k]: e.target.value });
    const fields = group === 'exception'
        ? [['policy', 'Policy'], ['recommendation', 'Exception / recommendation'], ['mitigant', 'Mitigant']]
        : [['text', 'Term or condition']];
    return (
        <div className="mrac-rec-edit">
            {fields.map(([k, label]) => (
                <label key={k}>
                    <span>{label}</span>
                    <textarea rows={2} value={value[k] ?? ''} onChange={set(k)} maxLength={1500} />
                </label>
            ))}
            <div className="mrac-rec-buttons">
                <button type="button" className="fp-btn" disabled={busy} onClick={() => onSave(value)}>Save and add</button>
                <button type="button" className="fp-btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
};

const Finding = ({ f, group, run, review, names, canEdit, onAddException, onAddTerm, onReviewed }) => {
    const [mode, setMode] = useState(null);          // null | 'edit' | 'dismiss'
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const termText = f.suggested_action || f.requirement;
    const decide = async (decision, extra = {}, apply = null) => {
        setBusy(true);
        setError(null);
        try {
            await reviewFinding(run.id, f.chunk_key, decision, extra);
            apply?.();
            setMode(null);
            onReviewed?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };
    const accept = () => decide('ACCEPTED', {}, () => {
        if (group === 'exception') onAddException?.({ policy: f.exception?.policy || f.requirement,
            exception_recommendation: f.exception?.recommendation ?? '', mitigant: f.exception?.mitigant ?? '' });
        if (group === 'condition') onAddTerm?.(termText);
    });
    const saveEdit = (edited) => decide('EDITED', { edited }, () => {
        if (group === 'exception') onAddException?.({ policy: edited.policy, exception_recommendation: edited.recommendation,
            mitigant: edited.mitigant });
        if (group === 'condition') onAddTerm?.(edited.text);
    });
    const acceptLabel = { exception: '+ Add to V. Exception/s', condition: '+ Add to terms and conditions', obtain: 'Noted, will follow up' }[group];

    return (
        <li className="mrac-rec">
            <div className="mrac-rec-head">
                <strong><Terms text={f.requirement || f.heading_path} /></strong>
                {f.rule_codes?.length > 0 && <span className="mrac-chip plain" title="A deterministic rule checked this too">Rule {f.rule_codes.join(', ')}</span>}
            </div>
            <p className="mrac-rec-text"><Terms text={f.finding} /></p>
            {f.suggested_action && <p className="mrac-rec-next"><span>Next:</span> <Terms text={f.suggested_action} /></p>}
            {f.exception && (f.exception.recommendation || f.exception.mitigant) && (
                <dl className="mrac-rec-exc">
                    {f.exception.recommendation && <div><dt>Exception to request</dt><dd>{f.exception.recommendation}</dd></div>}
                    {f.exception.mitigant && <div><dt>Mitigant in the file</dt><dd>{f.exception.mitigant}</dd></div>}
                </dl>
            )}
            {f.quote && <blockquote className="mrac-rec-quote">“{f.quote}”</blockquote>}
            <p className="mrac-rec-meta">
                {[f.document, pages(f)].filter(Boolean).join(' · ')}
                {f.brought_in_by?.length > 0 && <> · Checked because: {f.brought_in_by.join('; ')}</>}
            </p>
            {f.notes?.map((n) => <p key={n} className="mrac-rec-note">{n}</p>)}
            <Clause f={f} />

            {review && <Decision review={review} names={names} />}
            {canEdit && !review && mode === null && (
                <div className="mrac-rec-buttons">
                    <button type="button" className="fp-btn" disabled={busy} onClick={accept}>{acceptLabel}</button>
                    {group !== 'obtain' && (
                        <button type="button" className="fp-btn secondary" disabled={busy} onClick={() => setMode('edit')}>Edit, then add</button>
                    )}
                    <button type="button" className="fp-btn secondary" disabled={busy} onClick={() => setMode('dismiss')}>Dismiss</button>
                </div>
            )}
            {canEdit && !review && mode === 'edit' && (
                <Editor group={group} busy={busy} onCancel={() => setMode(null)} onSave={saveEdit}
                    initial={group === 'exception'
                        ? { policy: f.exception?.policy || f.requirement, recommendation: f.exception?.recommendation ?? '',
                            mitigant: f.exception?.mitigant ?? '' }
                        : { text: termText }} />
            )}
            {canEdit && !review && mode === 'dismiss' && (
                <div className="mrac-rec-edit">
                    <label>
                        <span>Why does this not apply? (kept in the change history)</span>
                        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                    </label>
                    <div className="mrac-rec-buttons">
                        <button type="button" className="fp-btn" disabled={busy || !reason.trim()}
                            onClick={() => decide('DISMISSED', { reason: reason.trim() })}>Dismiss</button>
                        <button type="button" className="fp-btn secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
                    </div>
                </div>
            )}
            {canEdit && review && (
                <button type="button" className="mrac-more" disabled={busy}
                    title="Takes back the decision. Anything already added to the page stays: remove it there if needed."
                    onClick={() => decide('UNDO')}>Undo decision</button>
            )}
            {error && <p className="mrac-err" role="alert">{error}</p>}
        </li>
    );
};

const Approval = ({ run, rec }) => {
    const amount = run.facts?.loan_amount;
    const tier = suggestApprovalTier(amount, rec.approval?.with_exception);
    const t = APPROVAL_TIERS.find((x) => x.value === tier);
    if (!t) return null;
    return (
        <div className="mrac-rec-approval">
            <h3>Approving authority</h3>
            <p>
                <strong>{t.label}</strong> <span className="meta">({t.rule})</span>
                <br />
                {rec.approval?.with_exception
                    ? 'With exception, because: ' + rec.approval.reasons.join('; ')
                    : 'Without exception: no policy exception was found.'}
            </p>
            <p className="fp-note">From the loan amount and the bank&apos;s approval ladder (VII. Approval). The CO picks the tier.</p>
        </div>
    );
};

const Recommendations = ({ run, reviews = {}, names = {}, canEdit = false, onAddException, onAddTerm, onReviewed }) => {
    const rec = run?.result?.recommendations;
    if (!rec) return null;
    if (rec.status !== 'DONE') {
        return (
            <div className="mrac-banner plain">
                <div className="top"><b>Policy recommendations not available</b></div>
                <p>{rec.reason}</p>
            </div>
        );
    }
    const counts = rec.counts ?? {};
    const open = (g) => (rec.groups[g] ?? []).filter((f) => !reviews[f.chunk_key]).length;
    const props = { run, names, canEdit, onAddException, onAddTerm, onReviewed };

    return (
        <div className="mrac-recs" aria-live="polite">
            <div className={`mrac-banner ${counts.exception ? 'bad' : counts.obtain ? 'warn' : 'ok'}`}>
                <div className="top">
                    <b>{rec.checked} policy clauses checked against this file</b>
                    {run.finished_at && <time dateTime={run.finished_at} title={fullWhen(run.finished_at)}>{formatWhen(run.finished_at)}</time>}
                </div>
                <p>
                    {rec.summary || `${counts.exception ?? 0} exception(s) needed, ${counts.obtain ?? 0} item(s) to obtain, `
                        + `${counts.condition ?? 0} condition(s), ${counts.met ?? 0} met.`}
                </p>
                <p className="fp-note">
                    Proposals from {rec.model || 'the recommender'}, each checked by CATCH against its clause and the figures.
                    You decide: accept, edit or dismiss each one. Nothing is added to the Financial Package until you do and save.
                </p>
            </div>

            <Approval run={run} rec={rec} />

            {GROUPS.map((g) => (rec.groups[g.key] ?? []).length > 0 && (
                <section key={g.key} className={`mrac-block mrac-rec-group ${g.tone}`}>
                    <h3>
                        {g.title} <span className={`mrac-chip ${g.tone}`}>{rec.groups[g.key].length}</span>
                        {canEdit && open(g.key) > 0 && <span className="meta"> {open(g.key)} to decide</span>}
                    </h3>
                    <p className="fp-note">{g.note}</p>
                    <ul className="mrac-rec-list">
                        {rec.groups[g.key].map((f) => (
                            <Finding key={f.chunk_key} f={f} group={g.key} review={reviews[f.chunk_key]} {...props} />
                        ))}
                    </ul>
                </section>
            ))}

            {(rec.groups.met ?? []).length > 0 && (
                <details className="mrac-facts">
                    <summary>Met ({rec.groups.met.length})</summary>
                    <ul className="mrac-rec-list">
                        {rec.groups.met.map((f) => (
                            <li key={f.chunk_key} className="mrac-rec compact">
                                <strong><Terms text={f.requirement || f.heading_path} /></strong>
                                <p className="mrac-rec-text"><Terms text={f.finding} /></p>
                                <Clause f={f} />
                            </li>
                        ))}
                    </ul>
                </details>
            )}
            {(rec.not_applicable ?? []).length > 0 && (
                <details className="mrac-facts">
                    <summary>Checked, not applicable ({rec.not_applicable.length})</summary>
                    <ul className="mrac-list">
                        {rec.not_applicable.map((x) => <li key={x.chunk_key}>{x.heading_path || x.chunk_key} <span className="ref">{x.document}</span></li>)}
                    </ul>
                </details>
            )}
            {(rec.unverified ?? []).length > 0 && (
                <details className="mrac-facts">
                    <summary>Held back by CATCH&apos;s checks ({rec.unverified.length})</summary>
                    <p className="fp-note">These findings failed a check (the quote is not in the clause, a figure is not in the file, …), so they are not shown above. Read them only as leads.</p>
                    <ul className="mrac-list">
                        {rec.unverified.map((u) => (
                            <li key={`${u.chunk_key}-${u.problems?.[0]}`}>
                                <strong>{u.requirement || u.heading_path || u.chunk_key}</strong>: {u.finding}
                                <div className="ref">{(u.problems ?? []).join('; ')}</div>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
            <p className="mrac-disclaimer">
                Civil status is used only to find document requirements, never as a reason. These findings are a reading of
                the bank&apos;s written policy, not a credit decision: only the approving authority approves or declines.
            </p>
        </div>
    );
};

export default Recommendations;
