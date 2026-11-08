// "Ask the policy": a staff member types a question and gets the most relevant passages of the credit policy manual,
// with their heading and manual page. Extractive only (no generated answer). Safe to place inside a <form>.
import { useState } from 'react';
import { Section } from '../applicationForm/fields';
import Excerpt from './excerpt';
import { askPolicy, waitForMracRun } from './api';

const PolicyAsk = () => {
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    const ask = async () => {
        if (question.trim().length < 3) return;
        setBusy(true);
        setError(null);
        try {
            const run = await waitForMracRun(await askPolicy(question));
            setResult(run.result);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section title="Ask the credit policy">
            <input aria-label="Policy question" className="p-1 border w-full" maxLength={500} value={question}
                placeholder="e.g. Who must the mortgage redemption insurance cover?"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }} />
            <button type="button" className="border px-2 py-1 my-2" onClick={ask} disabled={busy}>
                {busy ? 'Searching...' : 'Search policy'}
            </button>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {result && (result.passages.length === 0
                ? <p className="italic text-gray-500">No matching passage found.</p>
                : (
                    <ul className="list-disc pl-5">
                        {result.passages.map((p) => (
                            <li key={`${p.chunk_key}-${p.heading_path}`} className="text-sm mb-2">
                                <span className="font-semibold">{p.heading_path}</span>
                                {p.manual_pages?.length > 0 && ` (manual p. ${p.manual_pages.join(', ')})`}
                                {p.status === 'draft' && <span className="text-amber-700 text-xs"> · unreviewed draft</span>}
                                <div className="text-gray-700"><Excerpt text={p.excerpt} preview={300} /></div>
                            </li>
                        ))}
                    </ul>
                ))}
        </Section>
    );
};

export default PolicyAsk;
