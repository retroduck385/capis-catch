// A staff mark on one uploaded applicant document: Cleared or Needs a new copy, with a comment, and the history of
// who marked what (document_file_marks in 20261116_findings_and_file_marks.sql). Only the assigned Account Officer
// and the assigned Credit Officer can mark; everyone who can open the file reads. Applicants never see any of it.
// "Needs a new copy" opens a modal (newCopyDialog.jsx): say what is wrong, and the assigned AO can send the
// applicant a request for that file's category right there (the only way to ask from here: no separate
// "Ask the applicant for a new copy" button).
// Look (DESIGN.md, "Document check"): a compact disclosure. The summary row always shows the latest mark as a chip
// with who / when; the rest (comment, marking, history) opens on demand. It starts open only when
// the file still needs something from the viewer (not marked yet and they can mark, or a new copy is needed).
// "See requests and replies" opens a read-only popup (fileHistoryDialog.jsx) of every request for this file's part.
// Used on the Document check and in the loan folder's "Ask the applicant for documents" box. Styles: fileMark.css.
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, History, MessagesSquare } from 'lucide-react';
import { ROLE_LABELS } from '../../roles';
import { markFile } from './api';
import NewCopyDialog from './newCopyDialog';
import FileHistoryDialog from './fileHistoryDialog';
import Byline from '../../components/byline';
import './fileMark.css';

// [label, chip tone, icon]
const MARKS = {
    CLEARED: ['Cleared', 'ok', CheckCircle2],
    NEEDS_NEW_COPY: ['Needs a new copy', 'warn', AlertTriangle],
};

const MarkChip = ({ mark }) => {
    const [label, tone, Icon] = MARKS[mark];
    return <span className={`fm-chip ${tone}`}><Icon size={13} aria-hidden="true" />{label}</span>;
};
// who marked it, as a one-line byline: avatar · name · role · short time (exact time in the tooltip)
const MarkedBy = ({ row, names }) => (
    <Byline layout="inline" name={names[row.marked_by]} role={ROLE_LABELS[row.marked_role] ?? row.marked_role} at={row.marked_at} className="fm-by" />
);

// marks: useFileMarks() of the application (useFileMarks.js)
// file: { documentId, applicantId, requirementType (null = not a checklist document), label }
// unreadable: the file could not be read (OCR failed), so the box starts open even before a mark
// autoOpen = false: start closed even when the file needs something (an earlier, closed request)
const FileMark = ({ applicationId, file, marks, unreadable = false, className = '', autoOpen = true }) => {
    const id = useId();
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [asking, setAsking] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const rows = marks.byDoc[file.documentId] ?? [];
    const latest = rows.at(-1) ?? null;
    const askAgain = latest?.mark === 'NEEDS_NEW_COPY' || (unreadable && latest?.mark !== 'CLEARED');
    // null = not toggled yet: then it is open only while the file needs something (marks load after the first render)
    const [toggled, setToggled] = useState(null);
    const open = toggled ?? (autoOpen && ((!latest && marks.canMark) || askAgain));
    const inputId = `file-mark-${file.documentId}`;
    const bodyId = `${id}-body`;

    const saveCleared = async () => {
        setBusy(true);
        setError(null);
        try {
            await markFile(file.documentId, 'CLEARED', comment);
            setComment('');
            marks.reload();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (!latest && !marks.canMark && !askAgain) return null;

    return (
        <div className={`fm${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
            <button type="button" className="fm-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setToggled(!open)}>
                <span className="fm-title">File status</span>
                {latest ? <MarkChip mark={latest.mark} /> : <span className="fm-chip none"><CircleDashed size={13} aria-hidden="true" />Not marked yet</span>}
                {latest && <MarkedBy row={latest} names={marks.names} />}
                <ChevronDown size={18} className="fm-chev" aria-hidden="true" />
            </button>

            {open && (
                <div id={bodyId} className="fm-body">
                    {latest?.comment && <p className="fm-comment">{latest.comment}</p>}

                    <button type="button" className="fm-link" aria-haspopup="dialog" onClick={() => setShowHistory(true)}>
                        <MessagesSquare size={15} aria-hidden="true" />See requests and replies for this document
                    </button>
                    {showHistory && (
                        <FileHistoryDialog applicationId={applicationId} file={file} onClose={() => setShowHistory(false)} />
                    )}

                    {marks.canMark && (
                        <div className="fm-form">
                            <label htmlFor={inputId} className="fm-label">
                                {latest ? 'Mark it again' : 'Mark this file'} <small>(staff only, not sent; comment optional)</small>
                            </label>
                            <input id={inputId} className="fm-input" value={comment} maxLength={500}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="What you checked, or what is wrong with the file"
                                aria-describedby={error ? `${inputId}-error` : undefined} aria-invalid={error ? true : undefined} />
                            <div className="fm-acts">
                                <button type="button" className="fm-btn ok" disabled={busy} onClick={saveCleared}>
                                    <CheckCircle2 size={16} aria-hidden="true" />Mark Cleared
                                </button>
                                <button type="button" className="fm-btn warn" disabled={busy}
                                    onClick={() => { setError(null); setAsking(true); }}>
                                    <AlertTriangle size={16} aria-hidden="true" />Needs a new copy
                                </button>
                            </div>
                            {error && <p id={`${inputId}-error`} role="alert" className="fm-err">{error}</p>}
                        </div>
                    )}
                    {asking && (
                        <NewCopyDialog applicationId={applicationId} file={file} initialComment={comment}
                            onClose={() => setAsking(false)}
                            onMarked={() => marks.reload()}
                            onDone={() => { setAsking(false); setComment(''); marks.reload(); }} />
                    )}

                    {rows.length > 1 && (
                        <details className="fm-history">
                            <summary><History size={15} aria-hidden="true" />History <span className="fm-count">{rows.length} marks</span></summary>
                            <ol>
                                {[...rows].reverse().map((r) => (
                                    <li key={r.id}>
                                        <MarkChip mark={r.mark} />
                                        <MarkedBy row={r} names={marks.names} />
                                        {r.comment && <span className="fm-comment">{r.comment}</span>}
                                    </li>
                                ))}
                            </ol>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
};

export default FileMark;
