// MRAC check inside the Financial Package. Queues a check for the mrac-service worker and shows the result next to the
// credit score. Everything here is a SUGGESTION: the CO adds a suggested exception to V. Exception/s with one click
// and edits it. The panel sits inside the FP <form>, so every button is type="button".
import { useEffect, useState } from 'react';
import { Section } from '../applicationForm/fields';
import Excerpt from './excerpt';
import { fetchLatestMracCheck, requestMracCheck, waitForMracRun } from './api';
import { buildMracFacts } from './facts';

const STATUS = { pass: 'Pass', fail: 'Fails', needs_review: 'Needs review' };
const OVERALL = {
    PASS: 'All enabled criteria pass',
    REVIEW: 'Needs review',
    FAIL: 'One or more criteria fail',
    NO_RULES: 'No automatic MRAC criteria apply yet',
};

const Cell = ({ children, className = '' }) => <td className={`border px-2 py-1 align-top ${className}`}>{children}</td>;
const Head = ({ children }) => <th className="border px-2 text-left align-top">{children}</th>;

const Citations = ({ items }) => (
    <ul className="list-disc pl-5">
        {items.map((c) => (
            <li key={`${c.chunk_key}-${c.heading_path}`} className="text-xs text-gray-700 mb-1">
                <span className="font-semibold">{c.heading_path}</span>
                {c.manual_pages?.length > 0 && ` (manual p. ${c.manual_pages.join(', ')})`}
                {c.status === 'draft' && <span className="text-amber-700"> · unreviewed draft</span>}
                <Excerpt text={c.excerpt} />
            </li>
        ))}
    </ul>
);

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

    return (
        <Section title="MRAC check (suggestions only)">
            <p className="text-sm text-gray-600">
                Checks the figures on this page against the enabled MRAC criteria and finds the policy clauses that apply.
                Nothing is saved to the Financial Package until you add it.
            </p>
            <button type="button" className="border px-2 py-1 my-2" onClick={handleCheck} disabled={!canEdit || busy}>
                {busy ? 'Checking...' : result ? 'Check again' : 'Check against policy'}
            </button>
            {error && <p className="text-red-600 text-sm">{error}</p>}

            {result && (
                <div>
                    <p className="font-semibold">
                        {OVERALL[result.overall] ?? result.overall}
                        <span className="text-xs font-normal text-gray-600"> · {new Date(run.finished_at).toLocaleString()}</span>
                    </p>
                    {result.notes.map((n) => <p key={n} className="text-xs text-amber-700">{n}</p>)}

                    {result.criteria.length > 0 && (
                        <table className="border-collapse my-2 w-full text-sm">
                            <thead><tr><Head>Criterion</Head><Head>Value</Head><Head>Required</Head><Head>Result</Head></tr></thead>
                            <tbody>
                                {result.criteria.map((c) => (
                                    <tr key={c.code}>
                                        <Cell>
                                            {c.label}{c.is_example && <span className="text-xs text-amber-700"> (example)</span>}
                                            {c.source && (
                                                <div className="text-xs text-gray-600">
                                                    <span className="font-semibold">{c.source.heading_path}</span>
                                                    <Excerpt text={c.source.excerpt} />
                                                </div>
                                            )}
                                        </Cell>
                                        <Cell>{c.value ?? '—'}</Cell>
                                        <Cell>{c.threshold}</Cell>
                                        <Cell className={c.status === 'pass' ? '' : 'font-semibold'}>
                                            {STATUS[c.status]}
                                            {c.reason && <p className="text-xs text-gray-600">{c.reason}</p>}
                                        </Cell>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {result.manual_checks?.length > 0 && (
                        <div className="my-2">
                            <p className="font-semibold">To verify from the documents</p>
                            <ul className="list-disc pl-5">
                                {result.manual_checks.map((m) => (
                                    <li key={m.code} className="text-sm mb-1">
                                        <span className="font-semibold">{m.label}</span>
                                        <p className="text-xs text-gray-700">{m.prompt}</p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.suggested_exceptions.length > 0 && (
                        <div className="my-2">
                            <p className="font-semibold">Possible exceptions to record in V. Exception/s</p>
                            {result.suggested_exceptions.map((s) => (
                                <div key={s.criterion} className="border p-2 my-1">
                                    <p>{s.policy}</p>
                                    {s.citations.length > 0
                                        ? <Citations items={s.citations} />
                                        : <p className="text-xs italic text-gray-500">No matching exception clause found.</p>}
                                    {canEdit && (
                                        <button type="button" className="border px-2 mt-1 text-sm"
                                            disabled={added.includes(s.criterion)}
                                            onClick={() => {
                                                onAddException({
                                                    policy: s.policy,
                                                    exception_recommendation: s.exception_recommendation,
                                                    mitigant: s.mitigant,
                                                });
                                                setAdded([...added, s.criterion]);
                                            }}>
                                            {added.includes(s.criterion) ? 'Added to V. Exception/s' : 'Add to V. Exception/s'}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {result.policy_context.length > 0 && (
                        <div className="my-2">
                            <p className="font-semibold">Related policy</p>
                            <Citations items={result.policy_context} />
                        </div>
                    )}
                </div>
            )}
            {run?.status === 'FAILED' && <p className="text-red-600 text-sm">The last check failed: {run.error}</p>}
        </Section>
    );
};

export default MracPanel;
