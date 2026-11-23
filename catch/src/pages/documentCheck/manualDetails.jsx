// "Details" pane of the Document check for the files the AI doesn't read (group notes item 14): SPA, SEC / DTI /
// Mayor's permit and "Other" files (the ones the AO asked for by name in a document request). They sit in the same
// file list as the IDs and payslips; picking one shows this pane instead of the AI's values. The assigned Account
// Officer adds panels, each a label and a description ("+ Add detail"), and saves (save_manual_document_values in
// 20261123_manual_document_values.sql). Typing is open from Intake to Review; from Approval on, and for everyone else,
// the panels are read-only. Every save is kept: the latest shows, the earlier ones are under History. A replaced copy
// keeps its details, read-only. Nothing is copied into the application record. No AI.
// Look: the extraction panel's .dc-x / .dc-actionbar / .dc-scroll / .dc-field cards, plus .mv-* in documentCheck.css.
import { useEffect, useId, useState } from 'react';
import { History, Keyboard, Plus, Save, Trash2 } from 'lucide-react';
import { formatExact, fullWhen } from '../../components/people';
import { fetchOcrText, saveManualValues } from './manualApi';
import { LIMITS, filledRows, rowsProblem, sameAsSaved, startingRows } from './manualValues';

const who = (names, id) => names[id] ?? 'Account Officer';

// One saved detail, read-only: the label as a heading and the description in a box
const SavedPanels = ({ entries }) => (entries.length === 0
    ? <p className="lf-empty">Cleared: no details.</p>
    : (
        <div className="dc-fieldlist">
            {entries.map((e) => (
                <div key={e.label} className="dc-field mv-panel">
                    <span className="dc-field-label">{e.label}</span>
                    <p className="dc-input mv-text">{e.value}</p>
                </div>
            ))}
        </div>
    ));

// file: the documents row (+ label); saves: its document_manual_values rows, newest first
const ManualDetails = ({ file, label, saves, canType, names, onSaved, onDirtyChange }) => {
    const id = useId();
    const latest = saves[0] ?? null;
    const [rows, setRows] = useState(() => startingRows(file.document_type, latest));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [ocr, setOcr] = useState([]);

    const editable = canType && !file.superseded_at;
    const filled = filledRows(rows);
    const problem = rowsProblem(filled);
    const unchanged = sameAsSaved(filled, latest);
    const dirty = editable && !unchanged;

    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    // the local OCR text of the file, when it was read (PaddleOCR only, nothing sent to the AI), to help typing
    useEffect(() => {
        let cancelled = false;
        fetchOcrText(file.id).then((lines) => { if (!cancelled) setOcr(lines); }).catch(() => {});
        return () => { cancelled = true; };
    }, [file.id]);

    const set = (i, key, v) => { setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r))); setDone(false); };
    const add = () => {
        setRows([...rows, { label: '', value: '' }]);
        setDone(false);
        // focus the new panel's label once it is drawn
        requestAnimationFrame(() => document.getElementById(`${id}-l${rows.length}`)?.focus());
    };

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

    return (
        <div className="dc-x">
            <div className="dc-actionbar">
                <div className="dc-actionbar-top">
                    <div className="dc-kind">
                        <p className="dc-kind-name">{label}</p>
                        <p className="dc-muted">
                            <Keyboard size={13} aria-hidden="true" />
                            {latest
                                ? <>Saved by {who(names, latest.saved_by)} · <time dateTime={latest.saved_at} title={fullWhen(latest.saved_at)}>{formatExact(latest.saved_at)}</time></>
                                : 'Typed by hand: the AI does not read this file.'}
                        </p>
                    </div>
                    {editable && (
                        <div className="dc-acts">
                            <button type="button" className="lf-primary mv-save" disabled={busy || Boolean(problem) || unchanged} onClick={save}>
                                <Save size={15} aria-hidden="true" />{busy ? 'Saving...' : 'Save details'}
                            </button>
                        </div>
                    )}
                </div>
                {editable && problem && filled.length > 0 && <p className="mv-hint" role="status">{problem}.</p>}
                {error && <p className="lf-err" role="alert">{error}</p>}
                {done && unchanged && <p className="lf-ok-note" role="status">Saved.</p>}
            </div>

            <div className="dc-scroll">
                <section>
                    <h3 className="dc-h">Details</h3>
                    {editable ? (
                        <div className="dc-fieldlist" role="group" aria-label={`Details of the ${label}`}>
                            {rows.map((r, i) => (
                                // the index is the key: panels have no id until saved, and change only by typing / add / remove
                                <div key={i} className="dc-field mv-panel">
                                    <div className="mv-panel-top">
                                        <label className="sr-only" htmlFor={`${id}-l${i}`}>Label of detail {i + 1}</label>
                                        <input id={`${id}-l${i}`} type="text" className="dc-input mv-label" placeholder="Label, e.g. Account name"
                                            value={r.label} maxLength={LIMITS.label} onChange={(e) => set(i, 'label', e.target.value)} />
                                        <button type="button" className="mv-remove" aria-label={`Remove ${r.label.trim() || `detail ${i + 1}`}`}
                                            title="Remove" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDone(false); }}>
                                            <Trash2 size={15} aria-hidden="true" />
                                        </button>
                                    </div>
                                    <label className="sr-only" htmlFor={`${id}-v${i}`}>Description of {r.label.trim() || `detail ${i + 1}`}</label>
                                    <textarea id={`${id}-v${i}`} rows={2} className="dc-input mv-desc" placeholder="Description, as shown on the file"
                                        value={r.value} maxLength={LIMITS.value} onChange={(e) => set(i, 'value', e.target.value)} />
                                    <span className="mv-count" aria-hidden="true">{r.value.length}/{LIMITS.value}</span>
                                </div>
                            ))}
                            <button type="button" className="mv-add" disabled={rows.length >= LIMITS.rows} onClick={add}>
                                <Plus size={16} aria-hidden="true" />Add detail
                            </button>
                            <p className="mv-hint">
                                Empty panels are left out. Labels up to {LIMITS.label} characters, descriptions up to {LIMITS.value}.
                            </p>
                        </div>
                    ) : latest ? <SavedPanels entries={latest.entries} />
                        : <p className="lf-empty">No details added for this file yet.{!file.superseded_at && ' Only the assigned Account Officer adds them, from Intake to Review.'}</p>}
                </section>

                {saves.length > 1 && (
                    <details className="mv-history">
                        <summary><History size={14} aria-hidden="true" />History ({saves.length - 1} earlier)</summary>
                        <ol>
                            {saves.slice(1).map((s) => (
                                <li key={s.id}>
                                    <p className="mv-hint">{who(names, s.saved_by)} · <time dateTime={s.saved_at} title={fullWhen(s.saved_at)}>{formatExact(s.saved_at)}</time></p>
                                    <SavedPanels entries={s.entries} />
                                </li>
                            ))}
                        </ol>
                    </details>
                )}

                {ocr.length > 0 && (
                    <details className="mv-ocr">
                        <summary>Text read from the file (OCR, to help you type)</summary>
                        <pre>{ocr.map((l) => l.text).join('\n')}</pre>
                    </details>
                )}
            </div>
        </div>
    );
};

export default ManualDetails;
