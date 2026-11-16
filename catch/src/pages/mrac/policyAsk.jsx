// "Search the credit policy": a staff member types a question and gets the most relevant passages of the bank's policy
// manuals, with heading, document and manual page. Extractive only (no generated answer). Shown on the Policy search
// page (policySearchPage.jsx), a tab in the staff sidebar.
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Citations } from './mracResult';
import { askPolicy, waitForMracRun } from './api';
import './mrac.css';

const PolicyAsk = () => {
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    const ask = async (e) => {
        e.preventDefault();
        if (question.trim().length < 3) {
            setError('Type at least 3 characters.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const run = await waitForMracRun(await askPolicy(question.trim()));
            setResult(run.result);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="wt-card mrac mrac-ask" aria-labelledby="mrac-ask-title">
            <h2 id="mrac-ask-title">Search the credit policy</h2>
            <p>Finds the most relevant passages in the policy manuals and the housing RAAC. Passages are quoted, not generated.</p>
            <form role="search" onSubmit={ask}>
                <input aria-label="Policy question" maxLength={500} value={question}
                    placeholder="e.g. Who must the mortgage redemption insurance cover?"
                    onChange={(e) => setQuestion(e.target.value)} />
                <button type="submit" className="mrac-btn" disabled={busy}>
                    <Search size={18} aria-hidden="true" />
                    {busy ? 'Searching...' : 'Search'}
                </button>
            </form>
            {error && <p className="mrac-err" role="alert">{error}</p>}
            {result && (
                <div aria-live="polite">
                    {result.passages.length === 0
                        ? <p className="mrac-empty">No matching passage found.</p>
                        : <Citations items={result.passages} preview={300} />}
                </div>
            )}
        </section>
    );
};

export default PolicyAsk;
