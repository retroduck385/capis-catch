// One finished MRAC / policy-RAG check: overall verdict, criteria, reasoning with citations, suggested exceptions,
// manual checks, approval path and related policy. Shared by the Financial Package's MracPanel (where the assigned CO
// can add a suggested exception) and the Decision Support page (read only). Everything shown is a SUGGESTION.
// Pass `onAddException` to show the "+ Add to V. Exception/s" buttons; leave it out for a read-only view.
// Give it key={run.id} so the "added" marks reset when a new check comes in.
import { useState } from 'react';
import Excerpt from './excerpt';
import { OVERALL, showFact, showRequirement, STATUS } from './labels';
import './mrac.css';

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

const MracResult = ({ run, onAddException }) => {
    const [added, setAdded] = useState([]);
    const result = run?.status === 'DONE' ? run.result : null;
    if (!result) return null;
    const [overallLabel, overallTone] = OVERALL[result.overall] ?? [result.overall, 'plain'];
    const reasoning = result.reasoning;
    const criteria = result.criteria ?? [];
    const suggested = result.suggested_exceptions ?? [];
    const policyContext = result.policy_context ?? [];
    const approvalPassages = reasoning?.approval_path?.passages ?? [];

    return (
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

            {criteria.length > 0 && (
                <div className="mrac-block">
                    <h3>Criteria checked</h3>
                    <div className="fp-tablewrap">
                        <table className="mrac-table">
                            <thead><tr><th>Criterion</th><th>Value</th><th>Required</th><th>Result</th></tr></thead>
                            <tbody>
                                {criteria.map((c) => {
                                    const [label, tone] = STATUS[c.status] ?? [c.status, 'plain'];
                                    return (
                                        <tr key={c.code}>
                                            <td>
                                                {c.label}
                                                {c.is_example && <> <span className="mrac-chip warn">Example</span></>}
                                                {c.source_ref && <div className="ref">{c.source_ref}</div>}
                                            </td>
                                            <td className="num" data-label="Value">{showFact(c.field, c.value)}</td>
                                            <td className="num" data-label="Required">{showRequirement(c.field, c.threshold)}</td>
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
                    {criteria.filter((c) => c.source).map((c) => (
                        <details key={c.code} className="mrac-facts">
                            <summary>Policy clause for: {c.label}</summary>
                            <Citation c={c.source} />
                        </details>
                    ))}
                </div>
            )}

            {reasoning && (reasoning.points?.length > 0 || reasoning.next_steps?.length > 0) && (
                <div className="mrac-block">
                    <h3>Reasoning</h3>
                    {reasoning.points?.length > 0 && (
                        <ul className="mrac-list">
                            {reasoning.points.map((pt) => (
                                <li key={pt.code}>
                                    {pt.status === 'pass' ? pt.text : <strong>{pt.text}</strong>}
                                    {pt.citation && <span className="ref"> [{pt.citation}]</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                    {reasoning.next_steps?.length > 0 && (
                        <>
                            <h3 className="mt-3">What to do next</h3>
                            <ul className="mrac-list">{reasoning.next_steps.map((step) => <li key={step}>{step}</li>)}</ul>
                        </>
                    )}
                </div>
            )}

            {suggested.length > 0 && (
                <div className="mrac-block mrac-suggest">
                    <h3>Possible exceptions for V. Exception/s</h3>
                    <p className="fp-note">Clauses found by keyword: check that each one really applies before adding it.</p>
                    {suggested.map((s) => (
                        <div key={s.criterion} className="fp-sub">
                            <p>{s.policy}</p>
                            {s.citations?.length > 0
                                ? <Citations items={s.citations} />
                                : <p className="fp-empty">No matching exception clause found.</p>}
                            {onAddException && (
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

            {approvalPassages.length > 0 && (
                <div className="mrac-block">
                    <h3>Approval authority in the policy (newest first)</h3>
                    {reasoning.approval_path.note && <p className="fp-note">{reasoning.approval_path.note}</p>}
                    <Citations items={approvalPassages} />
                </div>
            )}

            {policyContext.length > 0 && (
                <div className="mrac-block">
                    <h3>Related policy</h3>
                    <Citations items={policyContext} />
                </div>
            )}

            {run.facts && (
                <details className="mrac-facts">
                    <summary>Figures used for this check</summary>
                    <dl>
                        {Object.entries(run.facts).filter(([key]) => key !== 'schema').map(([key, value]) => (
                            <div key={key}><dt>{key}</dt><dd>{showFact(key, value)}</dd></div>
                        ))}
                    </dl>
                </details>
            )}

            {reasoning?.disclaimer && <p className="mrac-disclaimer">{reasoning.disclaimer}</p>}
        </div>
    );
};

export default MracResult;
