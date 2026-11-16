// A staff mark on one uploaded applicant document: Cleared or Needs a new copy, with a comment, and the history of
// who marked what (document_file_marks in 20261116_findings_and_file_marks.sql). Only the assigned Account Officer
// and the assigned Credit Officer can mark; everyone who can open the file reads. Applicants never see any of it.
// "Needs a new copy" offers one click to put that document into a request to the applicant (ask.jsx).
// Look (DESIGN.md, "Document check"): a compact disclosure. The summary row always shows the latest mark as a chip
// with who / when; the rest (comment, Ask the applicant, marking, history) opens on demand. It starts open only when
// the file still needs something from the viewer (not marked yet and they can mark, or a new copy is needed).
// Used on the Document check and in the loan folder's "Ask the applicant for documents" box. Styles: fileMark.css.
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, History } from 'lucide-react';
import { ROLE_LABELS } from '../../roles';
import { markFile } from './api';
import AskApplicantButton from './ask';
import { Term } from '../../components/term';
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
// unreadable: the file could not be read (OCR failed), so "Ask the applicant" is offered even before a mark
// confirmLeave: optional, returns false to stay on the page (Document check: unsaved edits of the AI's values)
// autoOpen = false: start closed even when the file needs something (an earlier, closed request)
const FileMark = ({ applicationId, file, marks, unreadable = false, confirmLeave, className = '', autoOpen = true }) => {
    const id = useId();
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const rows = marks.byDoc[file.documentId] ?? [];
    const latest = rows.at(-1) ?? null;
    const askAgain = latest?.mark === 'NEEDS_NEW_COPY' || (unreadable && latest?.mark !== 'CLEARED');
    // null = not toggled yet: then it is open only while the file needs something (marks load after the first render)
    const [toggled, setToggled] = useState(null);
    const open = toggled ?? (autoOpen && ((!latest && marks.canMark) || askAgain));
    const inputId = `file-mark-${file.documentId}`;
    const bodyId = `${id}-body`;

    const save = async (mark) => {
        if (mark === 'NEEDS_NEW_COPY' && !comment.trim()) {
            setError('Say what is wrong with the file, so the applicant can be asked for a new copy.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await markFile(file.documentId, mark, comment);
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
                <span className="fm-title">Staff check of this file</span>
                {latest ? <MarkChip mark={latest.mark} /> : <span className="fm-chip none"><CircleDashed size={13} aria-hidden="true" />Not marked yet</span>}
                {latest && <MarkedBy row={latest} names={marks.names} />}
                <ChevronDown size={18} className="fm-chev" aria-hidden="true" />
            </button>

            {open && (
                <div id={bodyId} className="fm-body">
                    <p className="fm-note">
                        Staff only: the assigned <Term k="AO" /> and <Term k="CO" /> mark files. Applicants never see this.
                    </p>
                    {latest?.comment && <p className="fm-comment">{latest.comment}</p>}

                    {askAgain && (
                        <AskApplicantButton applicationId={applicationId} confirmLeave={confirmLeave} plain className="lf-ask-btn"
                            ask={{
                                items: [{ applicant_id: file.applicantId, requirement_type: file.requirementType, label: file.label }],
                                note: latest?.mark === 'NEEDS_NEW_COPY' ? latest.comment : '',
                                from: `the file marked "Needs a new copy" (${file.label})`,
                            }}>
                            Ask the applicant for a new copy
                        </AskApplicantButton>
                    )}

                    {marks.canMark && (
                        <div className="fm-form">
                            <label htmlFor={inputId} className="fm-label">
                                {latest ? 'Mark it again' : 'Mark this file'} <small>(a comment is required for a new copy)</small>
                            </label>
                            <input id={inputId} className="fm-input" value={comment} maxLength={500}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="What you checked, or what is wrong with the file"
                                aria-describedby={error ? `${inputId}-error` : undefined} aria-invalid={error ? true : undefined} />
                            <div className="fm-acts">
                                <button type="button" className="fm-btn ok" disabled={busy} onClick={() => save('CLEARED')}>
                                    <CheckCircle2 size={16} aria-hidden="true" />Mark Cleared
                                </button>
                                <button type="button" className="fm-btn warn" disabled={busy} onClick={() => save('NEEDS_NEW_COPY')}>
                                    <AlertTriangle size={16} aria-hidden="true" />Needs a new copy
                                </button>
                            </div>
                            {error && <p id={`${inputId}-error`} role="alert" className="fm-err">{error}</p>}
                        </div>
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
