// Pieces of the reviewer sign-off (review summary page, VII. Approval page, FP banner).
// MyWorkProgress: the progress bar in the review summary's header for the reviewer / approver whose turn it is,
// fed by ReviewForm's / ApprovalForm's onProgress (what's filled in so far). The review is kept as a draft in this
// browser as the reviewer goes (reviewDraft.js); nothing reaches the database until Submit.
// Who did what and when is a Byline (components/byline.jsx), never "name on <date>".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Byline from '../../components/byline';
import {
    ArrowDown, ArrowUp, Ban, Check, CheckCircle2, Circle, CloudCheck, CornerUpLeft, ExternalLink, Gavel, ListChecks, ThumbsUp,
    TriangleAlert,
} from 'lucide-react';
import { formatWhen } from '../../components/people';
import { getDocumentUrl, getParties } from '../applicationForm/api';
import { BORROWER_ROLES, EMPLOYMENT_TYPES, REQUIREMENT_LABELS, formatMoney, labelFor, partyLabel } from '../applicationForm/options';
import {
    CHECK_SOURCES, DECISION_LABELS, INCOME_DOCUMENT_TYPES, REVIEW_ACTIONS, SEVERITIES, deciderOf, jobOf, severityLabel,
    sourceHref,
} from './reviewChecks';
import { clearDraft, formFromDraft, isBlankForm, loadDraft, saveDraft } from './reviewDraft';
import { Term, Terms } from '../../components/term';

const money = (v) => (v === null || v === undefined ? '—' : `₱${formatMoney(v)}`);
const fullName = (p) => [p.first_name, p.middle_name, p.last_name, p.name_extension].filter(Boolean).join(' ');

export const FlagList = ({ flags }) => (flags.length === 0 ? null : (
    <ul className="rv-flags">
        {flags.map((f) => <li key={f.text} className={`rv-flag ${f.level === 'warn' ? 'warn' : 'none'}`}><Terms text={f.text} /></li>)}
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
            <p className="rv-return-head">
                <b>Round {round}</b>
                <span className="rv-return-by">
                    Returned by reviewer {by?.seq ?? '?'}
                    <Byline layout="inline" name={names[by?.user_id]} fallback="Reviewer" at={decision.decided_at} />
                </span>
                <span className="lf-chip warn">{severityLabel(decision.severity)} revision</span>
            </p>
            <p className="whitespace-pre-wrap">{decision.remarks}</p>
            <DecisionItems decision={decision} checkItems={checkItems} onlyFlagged />
            {decision.response ? (
                <div className="rv-return-answer">
                    <p className="rv-return-by">
                        Credit Officer's answer
                        <Byline layout="inline" name={names[decision.responded_by]} fallback="Credit Officer" at={decision.responded_at} />
                    </p>
                    <p className="whitespace-pre-wrap">{decision.response}</p>
                </div>
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
                                    <span className="sr-only">Reviewer {r.seq}: </span>
                                    <Byline layout="inline" name={names[r.user_id]} fallback="Unknown" at={d?.decided_at} />
                                    {r.user_id === myId && <span className="lf-chip none">You</span>}
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
                        <th>Declared (<Term k="KYC" />)</th>
                        <th>Basis used by the <Term k="CO" /></th>
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
                                    {remarks && <p className="whitespace-pre-wrap fp-note"><Term k="CO" />: {remarks}</p>}
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

// decision card tones: an endorsement is ok, not endorsing amber (it needs a look), a return slate
// The three decisions as cards: tone, icon and what each one does
const ACTION_CARDS = {
    ENDORSED: { tone: 'ok', Icon: ThumbsUp, desc: 'Sign off and recommend it to the approvers.' },
    NOT_ENDORSED: { tone: 'warn', Icon: Ban, desc: 'Sign off and recommend against it.' },
    RETURNED: { tone: 'none', Icon: CornerUpLeft, desc: 'Send it back to fix what you marked Needs revision.' },
};

const emptyForm = (items) => formFromDraft(null, items);

// "Check against": where the evidence for one checklist item is (CHECK_SOURCES). The section on this page scrolls
// (onJump), the CO's page opens in a new tab.
const CheckSources = ({ code, appId, onJump }) => {
    const src = CHECK_SOURCES[code];
    if (!src || (!src.here && !src.there)) return null;
    return (
        <p className="rv-sources">
            <span className="rv-sources-k">Check against</span>
            {src.here && onJump && (
                <a href={`#${src.here[0]}`} className="rv-source"
                    onClick={(e) => { e.preventDefault(); onJump(src.here[0], code); }}>
                    <ArrowUp size={14} aria-hidden="true" /><Terms text={src.here[1]} />
                </a>
            )}
            {src.there && appId && (
                <Link to={sourceHref(src.there, appId)} target="_blank" rel="noopener" className="rv-source">
                    <ExternalLink size={14} aria-hidden="true" />{src.there.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                </Link>
            )}
        </p>
    );
};

// Draft status in the submit bar: when it was last kept in this browser, or that it couldn't be
const DraftStatus = ({ saved, onClear, busy }) => {
    if (saved.failed) {
        return <span className="rv-draft failed">Couldn&apos;t keep a draft in this browser: submit before you leave the page.</span>;
    }
    if (!saved.at) return null;
    return (
        <span className="rv-draft">
            <CloudCheck size={16} aria-hidden="true" />
            <span>{saved.restored ? 'Draft restored' : 'Draft saved'}</span>
            <time dateTime={saved.at} title={new Date(saved.at).toLocaleString()}>{formatWhen(saved.at)}</time>
            <button type="button" className="rv-draft-clear" onClick={onClear} disabled={busy}>Clear</button>
        </span>
    );
};

// The current reviewer's checklist + decision. flags = reviewFlags() (shown under their checklist item)
// draftKey: where reviewDraft.js keeps the unsent answers (saved on every change, restored on the next visit)
// appId + onJump(sectionId, code): the "Check against" links under each item
// Laid out as one card per checklist item (number, what to check, OK / Needs revision, remark) and the decision as
// described cards; the ids rv-check-<code> are where "Back to your review" returns to.
// onProgress({ kind: 'review', marked, total, action, actionLabel, isReturn, hasRemarks, ready }): for the header bar
export const ReviewForm = ({ checkItems, flags, nextLabel, onSubmit, busy, error, onProgress, draftKey, appId, onJump }) => {
    const [restored] = useState(() => loadDraft(draftKey));
    const [form, setForm] = useState(() => formFromDraft(restored, checkItems));
    const [saved, setSaved] = useState(() => ({ at: restored?.savedAt ?? null, restored: Boolean(restored?.savedAt), failed: false }));
    const { checks, action, remarks, severity } = form;

    // Every change is kept as a draft right away (a blank form removes it)
    const update = (patch) => {
        const next = { ...form, ...patch };
        setForm(next);
        if (isBlankForm(next)) {
            clearDraft(draftKey);
            setSaved({ at: null, restored: false, failed: false });
            return;
        }
        const at = new Date().toISOString();
        const ok = saveDraft(draftKey, { ...next, savedAt: at });
        setSaved({ at: ok ? at : null, restored: false, failed: !ok });
    };
    const clear = () => {
        if (!window.confirm('Clear your checklist, decision and remarks? This removes the saved draft.')) return;
        update(emptyForm(checkItems));
    };

    // Only warn before leaving when the draft couldn't be kept
    const dirty = !isBlankForm(form);
    useEffect(() => {
        if (!dirty || !saved.failed) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty, saved.failed]);

    const set = (code, patch) => update({ checks: { ...checks, [code]: { ...checks[code], ...patch } } });
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
    const ready = blockers.length === 0;
    const hasRemarks = remarks.trim() !== '';
    const actionLabel = REVIEW_ACTIONS.find((a) => a.value === action)?.label ?? null;
    useEffect(() => {
        onProgress?.({ kind: 'review', marked: marked.length, total: checkItems.length, action, actionLabel, isReturn, hasRemarks, ready });
    }, [onProgress, marked.length, checkItems.length, action, actionLabel, isReturn, hasRemarks, ready]);

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
                Check the Credit Officer&apos;s work against the documents. You can&apos;t edit the Financial Package: anything
                that needs fixing goes back to the Credit Officer. Your answers are kept as a draft in this browser
                until you submit.
            </p>

            <div className="rv-checks-head">
                <h3 className="fp-subhead"><ListChecks size={18} aria-hidden="true" />Checklist</h3>
                <span className="rv-checks-count">
                    <b>{marked.length}</b> of {checkItems.length} marked
                    {flagged.length > 0 && <span className="lf-chip warn">{flagged.length} need revision</span>}
                </span>
                <span className="rv-checks-meter" aria-hidden="true">
                    <span style={{ width: `${(marked.length / Math.max(checkItems.length, 1)) * 100}%` }} />
                </span>
            </div>

            <ol className="rv-checks">
                {checkItems.map((i, n) => {
                    const c = checks[i.code];
                    const tone = c.result === 'OK' ? 'ok' : c.result === 'NEEDS_REVISION' ? 'warn' : 'none';
                    const missingRemark = c.result === 'NEEDS_REVISION' && !c.remark.trim();
                    const errId = `rv-check-${i.code}-err`;
                    return (
                        <li key={i.code} id={`rv-check-${i.code}`} className={`rv-check ${tone}`}>
                            <span className="rv-check-num" aria-hidden="true">
                                {tone === 'ok' ? <Check size={16} strokeWidth={3} />
                                    : tone === 'warn' ? <TriangleAlert size={15} strokeWidth={2.5} /> : n + 1}
                            </span>
                            <div className="rv-check-body">
                                <h4 className="rv-check-title">{i.label}</h4>
                                {i.hint && <p className="rv-check-hint">{i.hint}</p>}
                                <CheckSources code={i.code} appId={appId} onJump={onJump} />
                                <FlagList flags={flags.filter((f) => f.item === i.code)} />
                            </div>
                            <div className="rv-check-seg" role="radiogroup" aria-label={`Result for ${i.label}`}>
                                {[['OK', 'OK', 'ok', Check], ['NEEDS_REVISION', 'Needs revision', 'warn', TriangleAlert]].map(([v, l, t, Icon]) => (
                                    <label key={v} className={`rv-seg-opt ${t}`}>
                                        <input type="radio" name={`check-${i.code}`} checked={c.result === v}
                                            onChange={() => set(i.code, { result: v })} disabled={busy} />
                                        <Icon size={15} strokeWidth={2.5} aria-hidden="true" />{l}
                                    </label>
                                ))}
                            </div>
                            <label className="rv-check-remark">
                                <span>
                                    Remark
                                    <small>{c.result === 'NEEDS_REVISION' ? 'required' : 'optional'}</small>
                                </span>
                                <textarea rows={2} value={c.remark} disabled={busy}
                                    aria-describedby={missingRemark ? errId : undefined}
                                    aria-invalid={missingRemark || undefined}
                                    placeholder={c.result === 'NEEDS_REVISION' ? 'What the Credit Officer should fix' : 'Anything worth noting'}
                                    onChange={(e) => set(i.code, { remark: e.target.value })} />
                            </label>
                            {missingRemark && (
                                <p id={errId} className="rv-check-err">Say what needs fixing before you submit.</p>
                            )}
                        </li>
                    );
                })}
            </ol>

            <fieldset className="rv-decision rv-decide">
                <legend className="fp-subhead"><Gavel size={18} aria-hidden="true" />Your decision</legend>
                <div className="lf-choices rv-action-choices">
                    {REVIEW_ACTIONS.map((a) => {
                        const { tone, Icon, desc } = ACTION_CARDS[a.value] ?? { tone: 'none', Icon: Circle, desc: '' };
                        return (
                            <label key={a.value} className={`lf-choice ${tone}`}>
                                <input type="radio" name="review-action" checked={action === a.value}
                                    onChange={() => update({ action: a.value })} disabled={busy} />
                                <Icon size={20} className="mark" aria-hidden="true" />
                                <span>
                                    <b>{a.label}</b>
                                    {desc && <small>{desc}</small>}
                                </span>
                            </label>
                        );
                    })}
                </div>
                <p className="fp-note">
                    Endorse / Not endorse is your recommendation to the approvers, like the Credit Officer&apos;s Credit Result.
                    It doesn&apos;t approve or reject the loan.
                </p>
                {isReturn && (
                    <div className="rv-severity">
                        <h4 className="rv-severity-k">How big is the revision?</h4>
                        <div className="lf-choices">
                            {SEVERITIES.map((s) => (
                                <label key={s.value} className="lf-choice none">
                                    <input type="radio" name="severity" checked={severity === s.value}
                                        onChange={() => update({ severity: s.value })} disabled={busy} />
                                    <span><b>{s.label}</b><small>{s.hint}</small></span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                <label className="ct-field rv-remarks">
                    {isReturn ? 'What the Credit Officer needs to revise' : 'Justification and remarks'}
                    <textarea rows={4} value={remarks} disabled={busy} onChange={(e) => update({ remarks: e.target.value })}
                        placeholder={isReturn ? 'Summarize what to fix; the items above have the details' : 'Why you endorse it or not'} />
                </label>
                {signingOffWithFlags && (
                    <p className="lf-note warn">
                        <TriangleAlert size={16} aria-hidden="true" />
                        <span>
                            You marked {flagged.map((i) => i.label).join(', ')} as Needs revision. To have it fixed, return it to
                            the Credit Officer instead.
                        </span>
                    </p>
                )}
            </fieldset>

            <div className="fp-savebar">
                <div className="state">
                    {error && <p className="ct-error">{error}</p>}
                    {blockers.length > 0
                        ? <ul className="rv-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                        : <span className="lf-chip ok">Ready to submit</span>}
                </div>
                <div className="rv-savebar-end">
                    <span role="status"><DraftStatus saved={saved} onClear={clear} busy={busy} /></span>
                    <button type="submit" className="lf-primary" disabled={busy || blockers.length > 0}>
                        {busy ? 'Submitting...' : 'Submit review'}
                    </button>
                </div>
            </div>
        </form>
    );
};

// ============================================================
// Header progress bar for the reviewer / approver whose turn it is
// ============================================================
const Part = ({ done, label, value }) => (
    <li className={done ? 'is-done' : undefined}>
        {done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
        <span><b>{label}</b> {value}<span className="sr-only">{done ? ' (done)' : ' (to do)'}</span></span>
    </li>
);

// progress: the form's last onProgress (null until it reports); kind: 'review' | 'approval'; total: checklist items;
// onJump: scroll to the form
export const MyWorkProgress = ({ kind, progress, total = 0, onJump }) => {
    const p = progress?.kind === kind ? progress : null;
    let parts;
    let max;
    let value;
    if (kind === 'review') {
        const marked = p?.marked ?? 0;
        const items = p?.total ?? total;
        // A return only needs the items that need revising; a sign-off needs every item
        const listDone = items > 0 && (marked === items || (p?.isReturn && marked > 0));
        parts = [
            { key: 'list', label: 'Checklist', value: `${marked} of ${items} marked`, done: listDone },
            { key: 'decision', label: 'Decision', value: p?.actionLabel ?? 'not picked', done: Boolean(p?.action) },
            {
                key: 'remarks', label: p?.isReturn ? 'What to revise' : 'Justification',
                value: p?.hasRemarks ? 'written' : 'not written', done: Boolean(p?.hasRemarks),
            },
        ];
        max = items + 2;
        value = (listDone ? items : Math.min(marked, items)) + (p?.action ? 1 : 0) + (p?.hasRemarks ? 1 : 0);
    } else {
        parts = [
            { key: 'decision', label: 'Decision', value: p?.choiceLabel ?? 'not picked', done: Boolean(p?.choiceLabel) },
            { key: 'details', label: 'Details', value: p?.ready ? 'complete' : 'see the form', done: Boolean(p?.ready) },
        ];
        max = 2;
        value = (p?.choiceLabel ? 1 : 0) + (p?.ready ? 1 : 0);
    }
    // Full only when the form would let you submit (it may still need e.g. a remark on a flagged item)
    const ready = Boolean(p?.ready);
    const shown = ready ? max : Math.min(value, max - 1);
    const pct = max > 0 ? Math.round((shown / max) * 100) : 0;
    const title = kind === 'review' ? 'Your review' : 'Your decision';

    return (
        <div className="rv-mywork">
            <div className="rv-mywork-top">
                <p className="lf-steps-label">{title}</p>
                <span className={`lf-chip ${ready ? 'ok' : 'warn'}`}>{ready ? 'Ready to submit' : `${pct}% done`}</span>
                <button type="button" className="lf-btn quiet rv-mywork-jump" onClick={onJump}>
                    Go to {title.toLowerCase()}<ArrowDown size={16} aria-hidden="true" />
                </button>
            </div>
            <div className="lf-meter" role="progressbar" aria-label={`${title} progress`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <span style={{ width: `${pct}%` }} />
            </div>
            <ul className="rv-mywork-parts">
                {parts.map((x) => <Part key={x.key} done={x.done} label={x.label} value={x.value} />)}
            </ul>
            <p className="rv-mywork-note">
                {kind === 'review'
                    ? 'Kept as a draft in this browser as you go. Nothing is sent until you submit.'
                    : 'Nothing is saved until you submit.'}
            </p>
        </div>
    );
};
