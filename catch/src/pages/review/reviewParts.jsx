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

const FLAG_STYLE = { warn: 'text-amber-700', info: 'text-gray-700' };

export const FlagList = ({ flags }) => (flags.length === 0 ? null : (
    <ul className="list-disc pl-5 text-sm">
        {flags.map((f) => <li key={f.text} className={FLAG_STYLE[f.level]}>{f.text}</li>)}
    </ul>
));

// Checklist of one decision: items marked Needs revision first, with remarks
const DecisionItems = ({ decision, checkItems, onlyFlagged }) => {
    const items = [...(decision.review_decision_items ?? [])]
        .filter((i) => !onlyFlagged || i.result === 'NEEDS_REVISION')
        .sort((a, b) => (a.result === b.result ? 0 : a.result === 'NEEDS_REVISION' ? -1 : 1));
    if (items.length === 0) return null;
    return (
        <ul className="pl-5 list-disc text-sm">
            {items.map((i) => (
                <li key={i.item_code}>
                    <span className={i.result === 'NEEDS_REVISION' ? 'text-red-700 font-semibold' : 'text-green-700'}>
                        {i.result === 'NEEDS_REVISION' ? 'Needs revision' : 'OK'}
                    </span>
                    {' · '}{checkItems.find((c) => c.code === i.item_code)?.label ?? i.item_code}
                    {i.remark && <span className="whitespace-pre-wrap">: {i.remark}</span>}
                </li>
            ))}
        </ul>
    );
};

// One return to the CO and the CO's answer
export const ReturnCard = ({ decision, rows, names, checkItems, round }) => {
    const by = deciderOf(decision, rows);
    return (
        <div className="border border-red-300 p-3 my-2">
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
    if (reviewers.length === 0) return <p className="italic">Not sent for review yet.</p>;
    return (
        <div>
            <ol className="list-decimal pl-6">
                {reviewers.map((r) => {
                    const d = signoffs[r.id];
                    const isCurrent = current?.id === r.id;
                    return (
                        <li key={r.id} className="py-1">
                            <span className="font-semibold">{names[r.user_id] ?? 'Unknown'}{r.user_id === myId ? ' (you)' : ''}</span>
                            {' · '}
                            {d ? (
                                <>
                                    <span className={d.action === 'ENDORSED' ? 'text-green-700' : 'text-red-700'}>{DECISION_LABELS[d.action]}</span>
                                    {' '}on {when(d.decided_at)}
                                    {' '}<button type="button" className="underline text-sm"
                                        onClick={() => setOpen({ ...open, [d.id]: !open[d.id] })}>
                                        {open[d.id] ? 'Hide checklist' : 'Show checklist'}
                                    </button>
                                    <p className="whitespace-pre-wrap text-sm">{d.remarks}</p>
                                    {open[d.id] && <DecisionItems decision={d} checkItems={checkItems} />}
                                </>
                            ) : isCurrent ? (
                                <span className="text-amber-700">
                                    {stage === 'REVIEW' ? 'Reviewing now' : state.openReturn ? 'Returned it; reviews again after the revision' : 'Next to review'}
                                </span>
                            ) : <span className="italic text-gray-500">Waiting</span>}
                        </li>
                    );
                })}
            </ol>
            {returns.length > 0 && (
                <>
                    <p className="font-semibold pt-2">Returns to the Credit Officer</p>
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
        <div className="overflow-x-auto">
            <table className="border-collapse w-full text-sm">
                <thead>
                    <tr className="text-left">
                        <th className="border px-2 align-top">Borrower</th>
                        <th className="border px-2 align-top">Declared (KYC)</th>
                        <th className="border px-2 align-top">Basis used by the CO</th>
                        <th className="border px-2 align-top">(A) Basic + (B) Other = Gross</th>
                        <th className="border px-2 align-top">Income documents</th>
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
                                <td className="border px-2 align-top">
                                    {fullName(party)} ({partyLabel(party)})
                                    <div>{[labelFor(EMPLOYMENT_TYPES, job?.employment_type), job?.employer_business_name].filter(Boolean).join(' · ')}</div>
                                </td>
                                <td className="border px-2 align-top">{money(declared)}</td>
                                <td className="border px-2 align-top">
                                    {basis ? basis.label : declared === 0 ? 'No income' : <span className="text-red-700">Not picked</span>}
                                    {remarks && <p className="whitespace-pre-wrap">CO: {remarks}</p>}
                                </td>
                                <td className="border px-2 align-top">
                                    {money(basic)} + {money(other)} = <span className="font-semibold">{money(gross)}</span>
                                </td>
                                <td className="border px-2 align-top">
                                    {docs.length === 0 && <span className="italic text-gray-500">None required</span>}
                                    {docs.map((r) => (
                                        <div key={r.id}>
                                            <span className="font-semibold">{REQUIREMENT_LABELS[r.requirement_type]}:</span>{' '}
                                            {(r.documents ?? []).length === 0 && <span className="text-red-700">no file</span>}
                                            {(r.documents ?? []).map((doc) => (
                                                <button key={doc.id} type="button" className="underline block text-left"
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
            {getParties(app, BORROWER_ROLES).length === 0 && <p className="italic">No borrowers.</p>}
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
        <form onSubmit={handleSubmit}>
            <p className="text-sm italic pb-2">
                Check the Credit Officer's work against the documents. You can't edit the Financial Package: anything
                that needs fixing goes back to the Credit Officer.
            </p>
            <table className="border-collapse w-full text-sm">
                <thead>
                    <tr className="text-left">
                        <th className="border px-2 align-top">Check</th>
                        <th className="border px-2 align-top w-44">Result</th>
                        <th className="border px-2 align-top">Remark</th>
                    </tr>
                </thead>
                <tbody>
                    {checkItems.map((i) => {
                        const c = checks[i.code];
                        return (
                            <tr key={i.code}>
                                <td className="border px-2 align-top">
                                    <p className="font-semibold">{i.label}</p>
                                    {i.hint && <p className="text-gray-600">{i.hint}</p>}
                                    <FlagList flags={flags.filter((f) => f.item === i.code)} />
                                </td>
                                <td className="border px-2 align-top">
                                    {[['OK', 'OK'], ['NEEDS_REVISION', 'Needs revision']].map(([v, l]) => (
                                        <label key={v} className="block">
                                            <input type="radio" name={`check-${i.code}`} checked={c.result === v}
                                                onChange={() => set(i.code, { result: v })} disabled={busy} /> {l}
                                        </label>
                                    ))}
                                </td>
                                <td className="border px-2 align-top">
                                    <textarea className="border w-full p-1" rows={2} value={c.remark} disabled={busy}
                                        placeholder={c.result === 'NEEDS_REVISION' ? 'What needs fixing (required)' : 'Optional'}
                                        onChange={(e) => set(i.code, { remark: e.target.value })} />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="py-3">
                <p className="font-semibold">Your decision</p>
                {REVIEW_ACTIONS.map((a) => (
                    <label key={a.value} className="block">
                        <input type="radio" name="review-action" checked={action === a.value}
                            onChange={() => setAction(a.value)} disabled={busy} /> {a.label}
                    </label>
                ))}
                <p className="text-sm text-gray-600">
                    Endorse / Not endorse is your recommendation to the approvers, like the Credit Officer's Credit Result.
                    It doesn't approve or reject the loan.
                </p>
                {isReturn && (
                    <div className="py-2">
                        <p className="font-semibold">Revision</p>
                        {SEVERITIES.map((s) => (
                            <label key={s.value} className="block">
                                <input type="radio" name="severity" checked={severity === s.value}
                                    onChange={() => setSeverity(s.value)} disabled={busy} /> {s.label} ({s.hint})
                            </label>
                        ))}
                    </div>
                )}
                <label className="block py-2">
                    <span className="font-semibold">{isReturn ? 'What the Credit Officer needs to revise' : 'Justification and remarks'}</span>
                    <textarea className="border w-full p-1 mt-1" rows={4} value={remarks} disabled={busy}
                        onChange={(e) => setRemarks(e.target.value)} />
                </label>
                {signingOffWithFlags && (
                    <p className="text-amber-700 text-sm">
                        You marked {flagged.map((i) => i.label).join(', ')} as Needs revision. To have it fixed, return it to the Credit Officer instead.
                    </p>
                )}
            </div>

            <div className="sticky bottom-0 bg-white border-t py-3 flex gap-4 items-center flex-wrap">
                <button type="submit" className="border px-4 py-2" disabled={busy || blockers.length > 0}>
                    {busy ? 'Submitting...' : 'Submit review'}
                </button>
                {error && <p className="text-red-600">{error}</p>}
                {blockers.length > 0 && (
                    <ul className="text-sm text-amber-700 list-disc pl-4">
                        {blockers.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                )}
            </div>
        </form>
    );
};
