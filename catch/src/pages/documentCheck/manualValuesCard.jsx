// "Other documents (typed by hand)" on the Document check (group notes item 14): the SPA, SEC / DTI / Mayor's permit
// and "Other" files of the application (from the original upload or a document request), which the AI doesn't read.
// Pick a file: it opens in the viewer, with its local OCR text under it when there is one (PaddleOCR only, no AI), and
// the assigned Account Officer types label / value rows and saves (save_manual_document_values in
// 20261123_manual_document_values.sql). Typing is open from Intake to Review; from Approval on, and for everyone
// else, the card is read-only. Every save is kept: the latest shows, the earlier ones are under History.
// A replaced copy keeps its typed values, read-only. Nothing is copied into the application record.
// Look: .mv-* in documentCheck.css, on the page's --lf-* tokens (DESIGN.md "Document check").
import { useCallback, useEffect, useId, useState } from 'react';
import { History, Keyboard, Plus, Save, Trash2 } from 'lucide-react';
import { getParties } from '../applicationForm/api';
import { partyLabel } from '../applicationForm/options';
import { formatExact, fullWhen } from '../../components/people';
import DocumentViewer from './documentViewer';
import { fetchManualData, fetchOcrText, saveManualValues } from './manualApi';
import {
    LIMITS, MANUAL_TYPE_LABELS, filledRows, rowsProblem, sameAsSaved, savesByDocument, startingRows,
} from './manualValues';

const who = (names, id) => names[id] ?? 'Account Officer';

// The rows of one save, read-only
const SavedRows = ({ entries }) => (entries.length === 0
    ? <p className="lf-empty">Cleared: no values.</p>
    : (
        <dl className="mv-saved">
            {entries.map((e) => <div key={e.label}><dt>{e.label}</dt><dd>{e.value}</dd></div>)}
        </dl>
    ));

const ManualForm = ({ file, saves, canType, names, onSaved }) => {
    const id = useId();
    const latest = saves[0] ?? null;
    const [rows, setRows] = useState(() => startingRows(file.document_type, latest));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    const filled = filledRows(rows);
    const problem = rowsProblem(filled);
    const unchanged = sameAsSaved(filled, latest);
    const set = (i, key, v) => { setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r))); setDone(false); };

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await saveManualValues(file.id, filled.map((r) => ({ label: r.label.trim(), value: r.value.trim() })));
            setDone(true);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const editable = canType && !file.superseded_at;
    return (
        <div className="mv-form">
            {editable ? (
                <>
                    <div className="mv-rows" role="group" aria-label="Values from this file">
                        {rows.map((r, i) => (
                            // the index is the key: rows have no id until saved, and they only change by typing / add / remove
                            <div key={i} className="mv-row">
                                <label className="sr-only" htmlFor={`${id}-l${i}`}>Label {i + 1}</label>
                                <input id={`${id}-l${i}`} type="text" placeholder="Label" value={r.label} maxLength={LIMITS.label}
                                    onChange={(e) => set(i, 'label', e.target.value)} />
                                <label className="sr-only" htmlFor={`${id}-v${i}`}>{r.label.trim() || `Value ${i + 1}`}</label>
                                <input id={`${id}-v${i}`} type="text" placeholder="As shown on the file" value={r.value} maxLength={LIMITS.value}
                                    onChange={(e) => set(i, 'value', e.target.value)} />
                                <button type="button" className="mv-remove" aria-label={`Remove row ${i + 1}`}
                                    onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDone(false); }}>
                                    <Trash2 size={15} aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="mv-acts">
                        <button type="button" className="mv-add" disabled={rows.length >= LIMITS.rows}
                            onClick={() => { setRows([...rows, { label: '', value: '' }]); setDone(false); }}>
                            <Plus size={15} aria-hidden="true" />Add row
                        </button>
                        <button type="button" className="lf-primary mv-save" disabled={busy || Boolean(problem) || unchanged} onClick={save}>
                            <Save size={15} aria-hidden="true" />{busy ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    {problem && filled.length > 0 && <p className="mv-hint" role="status">{problem}.</p>}
                    {unchanged && !done && <p className="mv-hint">Nothing changed since the last save.</p>}
                    {error && <p className="lf-err" role="alert">{error}</p>}
                    {done && <p className="lf-ok-note" role="status">Saved.</p>}
                    <p className="mv-hint">Empty rows are left out. Labels up to {LIMITS.label} characters, values up to {LIMITS.value}.</p>
                </>
            ) : latest ? <SavedRows entries={latest.entries} /> : <p className="lf-empty">Nothing typed for this file yet.</p>}

            {latest && (
                <p className="mv-by">
                    Saved by {who(names, latest.saved_by)} · <time dateTime={latest.saved_at} title={fullWhen(latest.saved_at)}>{formatExact(latest.saved_at)}</time>
                </p>
            )}
            {saves.length > 1 && (
                <details className="mv-history">
                    <summary><History size={14} aria-hidden="true" />History ({saves.length - 1} earlier)</summary>
                    <ol>
                        {saves.slice(1).map((s) => (
                            <li key={s.id}>
                                <p className="mv-by">{who(names, s.saved_by)} · <time dateTime={s.saved_at} title={fullWhen(s.saved_at)}>{formatExact(s.saved_at)}</time></p>
                                <SavedRows entries={s.entries} />
                            </li>
                        ))}
                    </ol>
                </details>
            )}
        </div>
    );
};

const ManualValuesCard = ({ app }) => {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [fileId, setFileId] = useState(null);
    const [ocr, setOcr] = useState({ id: null, lines: [] });
    const [page, setPage] = useState(1);

    const load = useCallback(() => fetchManualData(app.id).then(setData).catch((err) => setError(err.message)), [app.id]);
    useEffect(() => { load(); }, [load]);

    const saves = data ? savesByDocument(data.saves) : {};
    // current files, and replaced ones that have typed values (read-only)
    const files = (data?.files ?? []).filter((f) => !f.superseded_at || saves[f.id]);
    const file = files.find((f) => f.id === fileId) ?? files[0] ?? null;

    const fid = file?.id ?? null;
    useEffect(() => {
        if (!fid) return undefined;
        let cancelled = false;
        fetchOcrText(fid).then((lines) => { if (!cancelled) setOcr({ id: fid, lines }); }).catch(() => {});
        return () => { cancelled = true; };
    }, [fid]);

    if (error) return <section className="lf-card mv"><p className="lf-err" role="alert">{error}</p></section>;
    if (!data || files.length === 0) return null;

    const parties = Object.fromEntries(getParties(app).map((p) => [p.id, p]));
    const personOf = (f) => {
        const p = parties[f.applicant_id];
        return p ? `${[p.first_name, p.last_name].filter(Boolean).join(' ')} · ${partyLabel(p)}` : 'Application';
    };
    const lines = ocr.id === file?.id ? ocr.lines : [];

    return (
        <section className="lf-card mv" aria-labelledby="mv-title">
            <div className="lf-cardhead">
                <h2 id="mv-title"><Keyboard size={17} aria-hidden="true" /> Other documents (typed by hand)</h2>
                <span className="lf-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
            </div>
            <p className="mv-intro">
                SPA, SEC / DTI / Mayor&apos;s permit and other files aren&apos;t read by the AI. Open one and type what matters.
                {data.canSave ? ' Only you, the assigned Account Officer, can type here, until the file goes to Approval.'
                    : ' Read-only: only the assigned Account Officer types here, from Intake to Review.'}
            </p>
            <div className="mv-grid">
                <ul className="dc-doclist mv-files">
                    {files.map((f) => {
                        const typed = Boolean(saves[f.id]);
                        return (
                            <li key={f.id}>
                                <button type="button" className={`dc-doc ${typed ? 'ok' : 'none'}`} aria-current={f.id === file.id ? 'true' : undefined}
                                    onClick={() => { setFileId(f.id); setPage(1); }} title={f.original_file_name ?? f.file_name}>
                                    <span className="txt">
                                        <b>{MANUAL_TYPE_LABELS[f.document_type]}</b>
                                        <span className="note">{personOf(f)}</span>
                                        <span className="note">
                                            Uploaded <time dateTime={f.uploaded_at} title={fullWhen(f.uploaded_at)}>{formatExact(f.uploaded_at)}</time>
                                            {f.superseded_at && ' · Replaced'}
                                        </span>
                                    </span>
                                    <span className={`lf-chip dc-chip ${typed ? 'ok' : 'none'}`}>{typed ? 'Typed' : 'Not typed yet'}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <div className="mv-view">
                    <DocumentViewer key={file.id} doc={file} highlights={[]} page={page} onPageChange={setPage} />
                    {lines.length > 0 && (
                        <details className="mv-ocr">
                            <summary>Text read from the file (OCR, to help you type)</summary>
                            <pre>{lines.map((l) => l.text).join('\n')}</pre>
                        </details>
                    )}
                </div>
                <ManualForm key={file.id} file={file} saves={saves[file.id] ?? []}
                    canType={data.canSave} names={data.names} onSaved={load} />
            </div>
        </section>
    );
};

export default ManualValuesCard;
