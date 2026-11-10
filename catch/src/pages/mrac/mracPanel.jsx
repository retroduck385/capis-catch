// MRAC check inside the Financial Package. Queues a check for the mrac-service worker and shows the result next to the
// credit score. Everything here is a SUGGESTION: the CO adds a suggested exception to V. Exception/s with one click
// and edits it. The panel sits inside the FP <form>, so every button is type="button".
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import Excerpt from './excerpt';
import { fetchLatestMracCheck, requestMracCheck, waitForMracRun } from './api';
import { buildMracFacts } from './facts';
import './mrac.css';

const STATUS = { pass: ['Pass', 'ok'], fail: ['Fails', 'bad'], needs_review: ['Needs review', 'warn'] };
const OVERALL = {
    PASS: ['All enabled criteria pass', 'ok'],
    REVIEW: ['Needs review', 'warn'],
    FAIL: ['One or more criteria fail', 'bad'],
    NO_RULES: ['No automatic MRAC criteria apply yet', 'plain'],
};

const pages = (c) => (c.manual_pages?.length ? `p. ${c.manual_pages.join(', ')}` : null);

// One policy passage: heading, document / page / revision date, draft flag, expandable text
export const Citation = ({ c, preview }) => (
    <div className="mrac-cite">
        <div className="head">
            <span>{c.heading_path || c.chunk_key}</span>
            <span className="meta">{[c.document, pages(c), c.revision_date && `rev. ${c.revision_date}`].filter(Boolean).join(' · ')}</span>
            {c.status === 'draft' && <span className="mrac-chip warn">Unreviewed draft</span>}
        </div>
        <Excerpt text={c.excerpt} preview={preview} />
    </div>
);

export const Citations = ({ items, preview }) => (
    <ul className="mrac-cites">
        {items.map((c) => <li key={`${c.document}-${c.chunk_key}`}><Citation c={c} preview={preview} /></li>)}
    </ul>
);

const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

const MracPanel = ({ app, computed, score, pricing, exceptions, canEdit, onAddException }) => {
    const [run, setRun] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [added, setAdded] = useState([]);

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
        setAdded([]);
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
    const [overallLabel, overallTone] = OVERALL[result?.overall] ?? [result?.overall, 'plain'];
    const reasoning = result?.reasoning;

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

            {result && (
                <div aria-live="polite">
                    <div className={`mrac-banner ${overallTone}`}>
                        <div className="top">
                            <b>{overallLabel}</b>
                            {run.finished_at && <time dateTime={run.finished_at}>{new Date(run.finished_at).toLocaleString()}</time>}
                        </div>
                        {reasoning?.headline && <p>{reasoning.headline}</p>}
                        {result.notes?.length > 0 && (
                            <ul className="mrac-notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                        )}
                    </div>

                    {result.criteria.length > 0 && (
                        <div className="mrac-block">
                            <h3>Criteria checked</h3>
                            <div className="fp-tablewrap">
                                <table className="mrac-table">
                                    <thead><tr><th>Criterion</th><th>Value</th><th>Required</th><th>Result</th></tr></thead>
                                    <tbody>
                                        {result.criteria.map((c) => {
                                            const [label, tone] = STATUS[c.status] ?? [c.status, 'plain'];
                                            return (
                                                <tr key={c.code}>
                                                    <td>
                                                        {c.label}
                                                        {c.is_example && <> <span className="mrac-chip warn">Example</span></>}
                                                        {c.source_ref && <div className="ref">{c.source_ref}</div>}
                                                    </td>
                                                    <td className="num" data-label="Value">{show(c.value)}</td>
                                                    <td className="num" data-label="Required">{show(c.threshold)}</td>
                                                    <td data-label="Result">
                                                        <span className={`mrac-chip ${tone}`}>{label}</span>
                                                        {c.reason && <p className="why">{c.reason}</p>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {result.criteria.filter((c) => c.source).map((c) => (
                                <details key={c.code} className="mrac-facts">
                                    <summary>Policy clause for: {c.label}</summary>
                                    <Citation c={c.source} />
                                </details>
                            ))}
                        </div>
                    )}

                    {reasoning && (reasoning.points.length > 0 || reasoning.next_steps.length > 0) && (
                        <div className="mrac-block">
                            <h3>Reasoning</h3>
                            {reasoning.points.length > 0 && (
                                <ul className="mrac-list">
                                    {reasoning.points.map((pt) => (
                                        <li key={pt.code}>
                                            {pt.status === 'pass' ? pt.text : <strong>{pt.text}</strong>}
                                            {pt.citation && <span className="ref"> [{pt.citation}]</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {reasoning.next_steps.length > 0 && (
                                <>
                                    <h3 className="mt-3">What to do next</h3>
                                    <ul className="mrac-list">{reasoning.next_steps.map((step) => <li key={step}>{step}</li>)}</ul>
                                </>
                            )}
                        </div>
                    )}

                    {result.suggested_exceptions.length > 0 && (
                        <div className="mrac-block mrac-suggest">
                            <h3>Possible exceptions for V. Exception/s</h3>
                            <p className="fp-note">Clauses found by keyword: check that each one really applies before adding it.</p>
                            {result.suggested_exceptions.map((s) => (
                                <div key={s.criterion} className="fp-sub">
                                    <p>{s.policy}</p>
                                    {s.citations.length > 0
                                        ? <Citations items={s.citations} />
                                        : <p className="fp-empty">No matching exception clause found.</p>}
                                    {canEdit && (
                                        <button type="button" className="fp-add" disabled={added.includes(s.criterion)}
                                            onClick={() => {
                                                onAddException({
                                                    policy: s.policy,
                                                    exception_recommendation: s.exception_recommendation,
                                                    mitigant: s.mitigant,
                                                });
                                                setAdded([...added, s.criterion]);
                                            }}>
                                            {added.includes(s.criterion) ? 'Added to V. Exception/s' : '+ Add to V. Exception/s'}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {result.manual_checks?.length > 0 && (
                        <div className="mrac-block">
                            <h3>To verify from the documents</h3>
                            <ul className="mrac-list">
                                {result.manual_checks.map((m) => (
                                    <li key={m.code}>
                                        <strong>{m.label}</strong>
                                        {m.prompt && <div className="ref">{m.prompt}</div>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {reasoning?.approval_path.passages.length > 0 && (
                        <div className="mrac-block">
                            <h3>Approval authority in the policy (newest first)</h3>
                            {reasoning.approval_path.note && <p className="fp-note">{reasoning.approval_path.note}</p>}
                            <Citations items={reasoning.approval_path.passages} />
                        </div>
                    )}

                    {result.policy_context.length > 0 && (
                        <div className="mrac-block">
                            <h3>Related policy</h3>
                            <Citations items={result.policy_context} />
                        </div>
                    )}

                    {run.facts && (
                        <details className="mrac-facts">
                            <summary>Figures used for this check</summary>
                            <dl>
                                {Object.entries(run.facts).filter(([key]) => key !== 'schema').map(([key, value]) => (
                                    <div key={key}><dt>{key}</dt><dd>{show(value)}</dd></div>
                                ))}
                            </dl>
                        </details>
                    )}

                    {reasoning?.disclaimer && <p className="mrac-disclaimer">{reasoning.disclaimer}</p>}
                </div>
            )}
        </Section>
    );
};

export default MracPanel;
