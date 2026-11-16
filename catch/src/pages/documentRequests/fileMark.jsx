// A staff mark on one uploaded applicant document: Cleared or Needs a new copy, with a comment, and the history of
// who marked what (document_file_marks in 20261116_findings_and_file_marks.sql). Only the assigned Account Officer
// and the assigned Credit Officer can mark; everyone who can open the file reads. Applicants never see any of it.
// "Needs a new copy" offers one click to put that document into a request to the applicant (ask.jsx).
import { useState } from 'react';
import { ROLE_LABELS } from '../../roles';
import { markFile } from './api';
import AskApplicantButton from './ask';
import { Term } from '../../components/term';

const MARKS = {
    CLEARED: ['Cleared', 'border-green-700 bg-green-50 text-green-900'],
    NEEDS_NEW_COPY: ['Needs a new copy', 'border-amber-600 bg-amber-50 text-amber-950'],
};
const when = (t) => new Date(t).toLocaleString();
const BTN = 'min-h-0! rounded border border-gray-500! bg-white! px-2.5! py-1! text-sm text-gray-900! hover:bg-gray-100! disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

const Line = ({ row, names }) => (
    <>
        <span className={`rounded border px-1.5 text-sm font-semibold ${MARKS[row.mark][1]}`}>{MARKS[row.mark][0]}</span>
        <span className='text-sm text-gray-700'>
            {' '}by {names[row.marked_by] ?? 'staff'} ({ROLE_LABELS[row.marked_role] ?? row.marked_role}) · {when(row.marked_at)}
        </span>
        {row.comment && <span className='block whitespace-pre-wrap break-words text-gray-900'>{row.comment}</span>}
    </>
);

// marks: useFileMarks() of the application (useFileMarks.js)
// file: { documentId, applicantId, requirementType (null = not a checklist document), label }
// unreadable: the file could not be read (OCR failed), so "Ask the applicant" is offered even before a mark
// confirmLeave: optional, returns false to stay on the page (Document check: unsaved edits of the AI's values)
const FileMark = ({ applicationId, file, marks, unreadable = false, confirmLeave, className = '' }) => {
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const rows = marks.byDoc[file.documentId] ?? [];
    const latest = rows.at(-1) ?? null;
    const inputId = `file-mark-${file.documentId}`;

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

    const askAgain = latest?.mark === 'NEEDS_NEW_COPY' || (unreadable && latest?.mark !== 'CLEARED');
    if (!latest && !marks.canMark && !askAgain) return null;

    return (
        <div className={`rounded border border-gray-300 bg-white p-2 text-left text-gray-900 ${className}`}>
            <p className='text-sm font-semibold text-gray-900'>Staff check of this file <span className='font-normal text-gray-700'>(staff only: the assigned <Term k="AO" /> and <Term k="CO" /> mark)</span></p>
            <p className='text-gray-900'>
                {latest ? <Line row={latest} names={marks.names} /> : <span className='text-sm text-gray-700'>Not marked yet.</span>}
            </p>

            {askAgain && (
                <p className='pt-1'>
                    <AskApplicantButton applicationId={applicationId} confirmLeave={confirmLeave}
                        ask={{
                            items: [{ applicant_id: file.applicantId, requirement_type: file.requirementType, label: file.label }],
                            note: latest?.mark === 'NEEDS_NEW_COPY' ? latest.comment : '',
                            from: `the file marked "Needs a new copy" (${file.label})`,
                        }}>
                        Ask the applicant for a new copy
                    </AskApplicantButton>
                </p>
            )}

            {marks.canMark && (
                <div className='pt-2'>
                    <label htmlFor={inputId} className='block text-sm font-semibold text-gray-900'>Comment</label>
                    <input id={inputId} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)}
                        placeholder='What you checked, or what is wrong with the file'
                        className='w-full rounded border border-gray-400 bg-white p-1.5 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600' />
                    <div className='flex flex-wrap gap-2 pt-1.5'>
                        <button type='button' className={BTN} disabled={busy} onClick={() => save('CLEARED')}>Mark Cleared</button>
                        <button type='button' className={BTN} disabled={busy} onClick={() => save('NEEDS_NEW_COPY')}>Mark Needs a new copy</button>
                    </div>
                </div>
            )}
            {error && <p role='alert' className='pt-1 text-sm text-red-800'>{error}</p>}

            {rows.length > 1 && (
                <details className='pt-1'>
                    <summary className='cursor-pointer text-sm text-blue-900'>History ({rows.length} marks)</summary>
                    <ol className='pt-1'>
                        {[...rows].reverse().map((r) => <li key={r.id} className='border-t border-gray-200 py-1'><Line row={r} names={marks.names} /></li>)}
                    </ol>
                </details>
            )}
        </div>
    );
};

export default FileMark;
