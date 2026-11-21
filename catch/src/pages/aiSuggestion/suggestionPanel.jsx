// "Ask AI for a suggestion" under the Credit Result of the Financial Package. The assigned Credit Officer asks; the
// ocr-service worker answers with the Claude API (ocr-service/advise.py): a suggested result, short reasons that each
// cite a policy passage, a draft justification and missing data. The AI never sets the credit result: the CO may copy
// the draft into the justification, edits it and saves the FP as usual. Every suggestion is kept, with who asked,
// when and the figures used. Everyone who can open the FP reads them.
// The data privacy question (Q-04) was cleared by the bank on 2026-11-20; what is sent stays filtered (buildInput.js).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Clock, Copy, Sparkles } from 'lucide-react';
import { Section } from '../applicationForm/fields';
import { formatPeso } from '../applicationForm/options';
import { percent } from '../financialPackage/compute';
import Byline from '../../components/byline';
import { Terms } from '../../components/term';
import { askForSuggestion, fetchSuggestions } from './api';
import { RESULT_LABELS } from './buildInput';
import '../mrac/mrac.css';
import './aiSuggestion.css';

const POLL_MS = 4000;
const WAITING = ['QUEUED', 'RUNNING'];
const TONE = { ENDORSED: 'ok', NOT_ENDORSED: 'bad', DEFERRED: 'warn' };

// One cited reason, with its passage excerpt (from what was sent) on demand
const Reason = ({ reason, passages }) => {
    const p = passages.find((x) => x.chunk_key === reason.chunk_key);
    return (
        <li>
            <span>{reason.text}</span>
            <details className="ai-cite">
                <summary>Policy: {reason.heading || reason.chunk_key}{reason.document ? ` · ${reason.document}` : ''}</summary>
                {p ? <p>{p.excerpt}{p.pages?.length ? ` (p. ${p.pages.join(', ')})` : ''}</p> : <p>Passage {reason.chunk_key}</p>}
            </details>
        </li>
    );
};

// The figures a suggestion was asked with (short list; the whole input below it)
const FiguresUsed = ({ input }) => (
    <details className="ai-figs">
        <summary>Figures used</summary>
        <ul>
            <li>Loan {input.loan?.amount != null ? formatPeso(input.loan.amount) : '—'}, {input.loan?.term_years ?? '—'} years at {input.loan?.interest_rate ?? '—'}%</li>
            <li>Total gross income {input.totals?.total_gross_income != null ? formatPeso(input.totals.total_gross_income) : '—'};
                {' '}DBR {percent(input.totals?.dbr ?? null) ?? '—'}; LCR {percent(input.loan?.lcr ?? null) ?? '—'}</li>
            <li>Credit score {input.credit_score?.total ?? '—'} / 100 ({input.credit_score?.complete ? 'complete' : 'not complete'}); Condition sub-total only</li>
            <li>{input.borrowers?.length ?? 0} borrower(s) by role; {input.exceptions?.length ?? 0} exception(s)</li>
        </ul>
        <pre>{JSON.stringify(input, null, 2)}</pre>
    </details>
);

export const SuggestionView = ({ row, names, canEdit, onUseDraft }) => {
    const out = row.output ?? {};
    const passages = row.sent?.passages ?? [];
    return (
        <div className="ai-result">
            <div className={`mrac-banner ${TONE[out.suggested_result] ?? 'plain'}`}>
                <div className="top">
                    <b>AI suggests: {RESULT_LABELS[out.suggested_result] ?? out.suggested_result}</b>
                    <span className="mrac-chip plain">Suggestion only</span>
                </div>
                <p>The credit result is still yours to set. Read the cited passages before relying on it.</p>
            </div>
            {out.reasons?.length > 0 && (
                <>
                    <h4 className="ai-h">Reasons</h4>
                    <ul className="ai-reasons">{out.reasons.map((r, i) => <Reason key={`${r.chunk_key}-${i}`} reason={r} passages={passages} />)}</ul>
                </>
            )}
            {out.notes?.map((n) => <p key={n} className="lf-note warn"><AlertTriangle size={15} aria-hidden="true" /><span>{n}</span></p>)}
            {out.draft_justification && (
                <>
                    <h4 className="ai-h">Draft justification</h4>
                    <blockquote className="ai-draft">{out.draft_justification}</blockquote>
                    {canEdit && onUseDraft && (
                        <button type="button" className="fp-btn" onClick={() => onUseDraft(out.draft_justification)}>
                            <Copy size={15} aria-hidden="true" />Copy into justification
                        </button>
                    )}
                </>
            )}
            {out.missing_data?.length > 0 && (
                <>
                    <h4 className="ai-h">Missing or to verify</h4>
                    <ul className="ai-missing">{out.missing_data.map((m) => <li key={m}>{m}</li>)}</ul>
                </>
            )}
            <p className="fp-note ai-meta">
                Asked by <Byline layout="inline" name={names[row.requested_by]} fallback="Credit Officer" at={row.requested_at} />
                {row.model ? ` · ${row.model}` : ''}
                {row.input_tokens ? ` · ${row.input_tokens.toLocaleString()} in / ${(row.output_tokens ?? 0).toLocaleString()} out tokens` : ''}
            </p>
            {row.input && <FiguresUsed input={row.input} />}
        </div>
    );
};

// canEdit: co_can_edit (the assigned CO); dirty: unsaved FP edits; justification: the current text (to confirm a
// replace); onUseDraft(text): puts the draft into the justification field (the CO still saves the FP)
const SuggestionPanel = ({ applicationId, canEdit, dirty, justification, onUseDraft }) => {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    const load = useCallback(() => fetchSuggestions(applicationId).then(setData).catch((err) => setError(err.message)), [applicationId]);
    useEffect(() => { load(); }, [load]);

    const latest = data?.rows[0] ?? null;
    const waiting = latest && WAITING.includes(latest.status);
    useEffect(() => {
        if (!waiting) return undefined;
        const t = setTimeout(load, POLL_MS);
        return () => clearTimeout(t);
    }, [waiting, data, load]);

    if (!data) return null;
    if (!canEdit && data.rows.length === 0) return null;

    const ask = async () => {
        setBusy(true);
        setError(null);
        try {
            await askForSuggestion(applicationId);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };
    const useDraft = (text) => {
        if (justification?.trim() && !window.confirm('Replace the current justification with the AI draft? You can edit it before saving.')) return;
        onUseDraft(text);
    };
    const done = data.rows.filter((r) => r.status === 'DONE');
    const shown = latest?.status === 'DONE' ? latest : done[0] ?? null;
    const earlier = data.rows.filter((r) => r !== shown && !(waiting && r === latest));

    return (
        <Section id="fp-ai" title="AI suggestion for the credit result" className="ai-panel">
            <p className="fp-note">
                <Terms text="The AI gets the saved figures (borrowers by role, no names, addresses or contact details; the Condition score as a sub-total only), the CI results, V. Exceptions as typed (don't put names there) and the latest policy check with its passages. It suggests; it never sets the credit result." />
            </p>

            {canEdit && (
                <div className="ai-ask">
                    <button type="button" className="lf-primary" disabled={busy || waiting || dirty} onClick={ask}>
                        <Sparkles size={16} aria-hidden="true" />{busy ? 'Asking...' : 'Ask AI for a suggestion'}
                    </button>
                    <span className="fp-note">
                        {dirty ? 'Save the Financial Package first: the AI reads the saved figures.'
                            : 'Needs a finished policy check run on the same figures as now.'}
                    </span>
                </div>
            )}
            {error && <p className="lf-err" role="alert">{error}</p>}

            {waiting && (
                <div className="ai-wait" role="status">
                    <Clock size={18} aria-hidden="true" />
                    <div>
                        <b>{latest.status === 'RUNNING' ? 'The AI is working on it...' : 'Waiting for the AI worker...'}</b>
                        <p className="fp-note">Usually under a minute. If this stays, ocr-service isn&apos;t running or ocr-service/.env has no ANTHROPIC_API_KEY.</p>
                    </div>
                </div>
            )}
            {latest?.status === 'FAILED' && (
                <p className="lf-err"><Bot size={15} aria-hidden="true" /> The last request failed: {latest.error}</p>
            )}
            {shown && <SuggestionView row={shown} names={data.names} canEdit={canEdit} onUseDraft={useDraft} />}

            {earlier.length > 0 && (
                <details className="ai-earlier">
                    <summary>Earlier suggestions ({earlier.length})</summary>
                    <ul>
                        {earlier.map((r) => (
                            <li key={r.id}>
                                <b>{r.status === 'DONE' ? RESULT_LABELS[r.output?.suggested_result] : r.status === 'FAILED' ? 'Failed' : 'Waiting'}</b>
                                {' · '}<Byline layout="inline" name={data.names[r.requested_by]} fallback="Credit Officer" at={r.requested_at} />
                                {r.input && <FiguresUsed input={r.input} />}
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </Section>
    );
};

export default SuggestionPanel;
