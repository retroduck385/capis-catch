// Pieces of the reviewer sign-off (review summary page, VII. Approval page, FP banner).
import { useEffect, useState } from 'react';
import { getDocumentUrl, getParties } from '../applicationForm/api';
import { BORROWER_ROLES, EMPLOYMENT_TYPES, REQUIREMENT_LABELS, formatMoney, labelFor, partyLabel } from '../applicationForm/options';
import {
    DECISION_LABELS, INCOME_DOCUMENT_TYPES, REVIEW_ACTIONS, SEVERITIES, deciderOf, jobOf, severityLabel,
} from './reviewChecks';

const money = (v) => (v === null || v === undefined ? '—' : `₱${formatMoney(v)}`);
const when = (t) => new Date(t).toLocaleString();
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

export const FlagList = ({ flags }) => (flags.length === 0 ? null : (
    <ul className="rv-flags">
        {flags.map((f) => <li key={f.text} className={`rv-flag ${f.level === 'warn' ? 'warn' : 'none'}`}>{f.text}</li>)}
    </ul>
));

// Checklist of one decision: items marked Needs revision first, with remarks
const DecisionItems = ({ decision, checkItems, onlyFlagged }) => {
    const items = [...(decision.review_decision_items ?? [])]
        .filter((i) => !onlyFlagged || i.result === 'NEEDS_REVISION')
        .sort((a, b) => (a.result === b.result ? 0 : a.result === 'NEEDS_REVISION' ? -1 : 1));
    if (items.length === 0) return null;
    return (
        <ul className="rv-items">
            {items.map((i) => (
                <li key={i.item_code}>
                    <span className={`lf-chip ${i.result === 'NEEDS_REVISION' ? 'warn' : 'ok'}`}>
                        {i.result === 'NEEDS_REVISION' ? 'Needs revision' : 'OK'}
                    </span>
                    <span>
                        {checkItems.find((c) => c.code === i.item_code)?.label ?? i.item_code}
                        {i.remark && <span className="whitespace-pre-wrap">: {i.remark}</span>}
                    </span>
                </li>
            ))}
        </ul>
    );
};

// One return to the CO and the CO's answer
export const ReturnCard = ({ decision, rows, names, checkItems, round }) => {
    const by = deciderOf(decision, rows);
    return (
        <div className="border border-red-300 p-3 my-2 rv-return">
            <p className="font-semibold">
                Round {round}: returned by reviewer {by?.seq ?? '?'} ({names[by?.user_id] ?? 'Reviewer'}) on {when(decision.decided_at)}
                {' · '}{severityLabel(decision.severity)} revision
            </p>
            <p className="whitespace-pre-wrap">{decision.remarks}</p>
            <DecisionItems decision={decision} checkItems={checkItems} onlyFlagged />
            {decision.response ? (
                <p className="pt-1 text-sm">
                    <span className="font-semibold">Credit Officer ({names[decision.responded_by] ?? 'Credit Officer'}), {when(decision.responded_at)}:</span>{' '}
                    <span className="whitespace-pre-wrap">{decision.response}</span>
                </p>
            ) : <p className="pt-1 text-sm italic text-amber-700">Waiting for the Credit Officer's revision.</p>}
        </div>
    );
};

// Reviewers in order with their sign-off, then every return
export const ReviewProgress = ({ rows, state, names, myId, checkItems, stage }) => {
    const [open, setOpen] = useState({});
    const { reviewers, signoffs, current, returns, roundOf } = state;
    if (reviewers.length === 0) return <p className="fp-empty">Not sent for review yet.</p>;
    return (
        <div>
            <ol className="rv-timeline">
                {reviewers.map((r) => {
                    const d = signoffs[r.id];
                    const isCurrent = current?.id === r.id;
                    const tone = d ? (d.action === 'ENDORSED' ? 'ok' : 'warn') : isCurrent ? 'warn' : 'none';
                    return (
                        <li key={r.id} className={`rv-step ${tone}`}>
                            <div className="rv-step-top">
                                <span className="rv-who">
                                    <span className="rv-seq" aria-hidden="true">{r.seq}</span>
                                    <b>{names[r.user_id] ?? 'Unknown'}{r.user_id === myId ? ' (you)' : ''}</b>
                                </span>
                                {d ? (
                                    <span className="lf-chip">{DECISION_LABELS[d.action]}</span>
                                ) : isCurrent ? (
                                    <span className="lf-chip">
                                        {stage === 'REVIEW' ? 'Reviewing now' : state.openReturn ? 'Reviews again after the revision' : 'Next to review'}
                                    </span>
                                ) : <span className="lf-chip">Waiting</span>}
                            </div>
                            {d && (
                                <>
                                    <p className="lf-kyc-meta">{when(d.decided_at)}</p>
                                    {d.remarks && <p className="lf-kyc-remark whitespace-pre-wrap">{d.remarks}</p>}
                                    <button type="button" className="rv-link"
                                        onClick={() => setOpen({ ...open, [d.id]: !open[d.id] })}>
                                        {open[d.id] ? 'Hide checklist' : 'Show checklist'}
                                    </button>
                                    {open[d.id] && <DecisionItems decision={d} checkItems={checkItems} />}
                                </>
                            )}
                        </li>
                    );
                })}
            </ol>
            {returns.length > 0 && (
                <>
                    <p className="fp-subhead rv-returns-head">Returns to the Credit Officer</p>
                    {[...returns].reverse().map((d) => (
                        <ReturnCard key={d.id} decision={d} rows={rows} names={names} checkItems={checkItems} round={roundOf(d)} />
                    ))}
                </>
            )}
        </div>
    );
};

// Per borrower: declared income vs. the basis the CO used, with the income documents to check it against
export const IncomeEvidence = ({ app, computed, fp, onError }) => {
    const details = Object.fromEntries(fp.parties.map((r) => [r.applicant_id, r]));
    const view = async (doc) => {
        try {
            window.open(await getDocumentUrl(doc), '_blank', 'noopener');
        } catch (err) {
            onError(err.message);
        }
    };
    return (
        <div className="fp-tablewrap">
            <table>
                <thead>
                    <tr>
                        <th>Borrower</th>
                        <th>Declared (KYC)</th>
                        <th>Basis used by the CO</th>
                        <th>(A) Basic + (B) Other = Gross</th>
                        <th>Income documents</th>
                    </tr>
                </thead>
                <tbody>
                    {computed.incomes.map(({ party, declared, basis, basic, other, gross }) => {
                        const job = jobOf(party);
                        const docs = (party.application_requirements ?? [])
                            .filter((r) => INCOME_DOCUMENT_TYPES.includes(r.requirement_type));
                        const remarks = details[party.id]?.employment_remarks;
                        return (
                            <tr key={party.id}>
                                <td>
                                    <b>{fullName(party)} ({partyLabel(party)})</b>
                                    <div className="fp-note">{[labelFor(EMPLOYMENT_TYPES, job?.employment_type), job?.employer_business_name].filter(Boolean).join(' · ')}</div>
                                </td>
                                <td>{money(declared)}</td>
                                <td>
                                    {basis ? basis.label : declared === 0 ? 'No income' : <span className="lf-err">Not picked</span>}
                                    {remarks && <p className="whitespace-pre-wrap fp-note">CO: {remarks}</p>}
                                </td>
                                <td>
                                    {money(basic)} + {money(other)} = <b>{money(gross)}</b>
                                </td>
                                <td>
                                    {docs.length === 0 && <span className="fp-pending">None required</span>}
                                    {docs.map((r) => (
                                        <div key={r.id} className="rv-doc">
                                            <span className="rv-doc-type">{REQUIREMENT_LABELS[r.requirement_type]}</span>
                                            {(r.documents ?? []).length === 0 && <span className="lf-err">no file</span>}
                                            {(r.documents ?? []).map((doc) => (
                                                <button key={doc.id} type="button" className="rv-link block text-left"
                                                    title={doc.original_file_name} onClick={() => view(doc)}>
                                                    {doc.file_name}
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {getParties(app, BORROWER_ROLES).length === 0 && <p className="fp-empty">No borrowers.</p>}
        </div>
    );
};

const emptyChecks = (items) => Object.fromEntries(items.map((i) => [i.code, { result: '', remark: '' }]));

// The current reviewer's checklist + decision. flags = reviewFlags() (shown under their checklist item)
export const ReviewForm = ({ checkItems, flags, nextLabel, onSubmit, busy, error }) => {
    const [checks, setChecks] = useState(() => emptyChecks(checkItems));
    const [action, setAction] = useState('');
    const [remarks, setRemarks] = useState('');
    const [severity, setSeverity] = useState('');

    const dirty = action !== '' || remarks.trim() !== '' || Object.values(checks).some((c) => c.result || c.remark.trim());
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const set = (code, patch) => setChecks({ ...checks, [code]: { ...checks[code], ...patch } });
    const marked = checkItems.filter((i) => checks[i.code].result);
    const flagged = checkItems.filter((i) => checks[i.code].result === 'NEEDS_REVISION');
    const isReturn = action === 'RETURNED';

    const blockers = [
        !action && 'Pick a decision.',
        !isReturn && action && marked.length < checkItems.length && `Mark every checklist item (${marked.length} of ${checkItems.length}).`,
        isReturn && flagged.length === 0 && 'Mark at least one item as Needs revision.',
        flagged.some((i) => !checks[i.code].remark.trim()) && 'Add a remark to every item marked Needs revision.',
        isReturn && !severity && 'Pick Minor or Major.',
        !remarks.trim() && (isReturn ? 'Say what the Credit Officer needs to revise.' : 'Write the justification.'),
    ].filter(Boolean);
    const signingOffWithFlags = !isReturn && action && flagged.length > 0;

    const handleSubmit = (e) => {
        e.preventDefault();
        const label = REVIEW_ACTIONS.find((a) => a.value === action)?.label;
        const after = isReturn ? 'It goes back to the Credit Officer, who is notified.' : nextLabel;
        if (!window.confirm(`${label}? ${after} This can't be undone.`)) return;
        onSubmit({
            action,
            remarks: remarks.trim(),
            severity: isReturn ? severity : null,
            items: checkItems.filter((i) => checks[i.code].result)
                .map((i) => ({ code: i.code, result: checks[i.code].result, remark: checks[i.code].remark.trim() || null })),
        });
    };

    return (
        <form onSubmit={handleSubmit} className="rv-form">
            <p className="fp-note">
                Check the Credit Officer's work against the documents. You can't edit the Financial Package: anything
                that needs fixing goes back to the Credit Officer.
            </p>
            <div className="fp-tablewrap">
                <table className="rv-checklist">
                    <thead>
                        <tr>
                            <th>Check</th>
                            <th>Result</th>
                            <th>Remark</th>
                        </tr>
                    </thead>
                    <tbody>
                        {checkItems.map((i) => {
                            const c = checks[i.code];
                            return (
                                <tr key={i.code}>
                                    <td>
                                        <b>{i.label}</b>
                                        {i.hint && <p className="fp-note">{i.hint}</p>}
                                        <FlagList flags={flags.filter((f) => f.item === i.code)} />
                                    </td>
                                    <td>
                                        <div className="rv-radios">
                                            {[['OK', 'OK'], ['NEEDS_REVISION', 'Needs revision']].map(([v, l]) => (
                                                <label key={v} className={`rv-radio${v === 'NEEDS_REVISION' ? ' warn' : ''}`}>
                                                    <input type="radio" name={`check-${i.code}`} checked={c.result === v}
                                                        onChange={() => set(i.code, { result: v })} disabled={busy} />
                                                    {l}
                                                </label>
                                            ))}
                                        </div>
                                    </td>
                                    <td>
                                        <textarea rows={2} value={c.remark} disabled={busy}
                                            aria-label={`Remark for ${i.label}`}
                                            placeholder={c.result === 'NEEDS_REVISION' ? 'What needs fixing (required)' : 'Optional'}
                                            onChange={(e) => set(i.code, { remark: e.target.value })} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="rv-decision">
                <h3 className="fp-subhead">Your decision</h3>
                <div className="lf-choices">
                    {REVIEW_ACTIONS.map((a) => (
                        <label key={a.value} className="lf-choice">
                            <input type="radio" name="review-action" checked={action === a.value}
                                onChange={() => setAction(a.value)} disabled={busy} /> {a.label}
                        </label>
                    ))}
                </div>
                <p className="fp-note">
                    Endorse / Not endorse is your recommendation to the approvers, like the Credit Officer's Credit Result.
                    It doesn't approve or reject the loan.
                </p>
                {isReturn && (
                    <>
                        <h3 className="fp-subhead">Revision</h3>
                        <div className="lf-choices">
                            {SEVERITIES.map((s) => (
                                <label key={s.value} className="lf-choice">
                                    <input type="radio" name="severity" checked={severity === s.value}
                                        onChange={() => setSeverity(s.value)} disabled={busy} /> {s.label} ({s.hint})
                                </label>
                            ))}
                        </div>
                    </>
                )}
                <label className="ct-field rv-remarks">
                    {isReturn ? 'What the Credit Officer needs to revise' : 'Justification and remarks'}
                    <textarea rows={4} value={remarks} disabled={busy} onChange={(e) => setRemarks(e.target.value)} />
                </label>
                {signingOffWithFlags && (
                    <p className="lf-note warn">
                        You marked {flagged.map((i) => i.label).join(', ')} as Needs revision. To have it fixed, return it to the Credit Officer instead.
                    </p>
                )}
            </div>

            <div className="fp-savebar">
                <div className="state">
                    {error && <p className="ct-error">{error}</p>}
                    {blockers.length > 0
                        ? <ul className="rv-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                        : <span className="fp-chip ok">Ready to submit</span>}
                </div>
                <button type="submit" disabled={busy || blockers.length > 0}>
                    {busy ? 'Submitting...' : 'Submit review'}
                </button>
            </div>
        </form>
    );
};
