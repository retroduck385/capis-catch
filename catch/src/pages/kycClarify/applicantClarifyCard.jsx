// The applicant's "Question from your Account Officer" card on their submitted application: the AO's question, the
// thread so far, and a Reply box (text, optionally one JPG, PNG or PDF file). Shown only while the question is open
// (my_kyc_clarifications()); once the AO marks the section Verified it is gone. The application itself stays read only.
// focus: this is the question the notification pointed to (it is highlighted and scrolled into view by the page).
// onShowPart: scroll to the matching part of the application below.
import { useId, useRef, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { replyClarification } from './api';
import { fileProblem, REPLY_MAX } from './sections';
import ThreadView from './threadView';
import './kycClarify.css';

const ApplicantClarifyCard = ({ thread, focus = false, onChanged, onShowPart }) => {
    const [text, setText] = useState('');
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [sent, setSent] = useState(false);
    const fileRef = useRef(null);
    const id = useId();

    const send = async (e) => {
        e.preventDefault();
        if (!text.trim()) { setError('Write your reply.'); return; }
        const problem = fileProblem(file);
        if (problem) { setError(problem); return; }
        setBusy(true);
        setError(null);
        setSent(false);
        try {
            await replyClarification(thread, text.trim(), file);
            setText('');
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
            setSent(true);
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section id={`clarify-${thread.section}`} className={`ct-card kq-card${focus ? ' focus' : ''}`}
            aria-labelledby={`${id}-title`} style={{ marginBottom: '1rem' }}>
            <div className="ct-card-head">
                <h2 id={`${id}-title`}>Question from your Account Officer: {thread.section_label}</h2>
                <span className="ct-mono ct-muted">{thread.application_no}</span>
            </div>
            <div className="ct-sheet-body">
                <p className="kq-note">
                    Please answer here. Your application can&apos;t be changed; your Account Officer will update it if needed.
                    {onShowPart && <>{' '}<button type="button" className="kq-file" onClick={onShowPart}>Show the {thread.section_label} part</button></>}
                </p>
                <ThreadView thread={thread} viewer="APPLICANT" />
                <form className="kq-form" onSubmit={send}>
                    <label htmlFor={`${id}-reply`}>Your reply</label>
                    <textarea id={`${id}-reply`} rows={3} maxLength={REPLY_MAX} value={text} disabled={busy}
                        onChange={(e) => { setText(e.target.value); setError(null); setSent(false); }} />
                    <p className="kq-counter">{text.length} / {REPLY_MAX}</p>
                    <label htmlFor={`${id}-file`}>
                        <Paperclip size={14} aria-hidden="true" /> Attach a file <small>(optional: JPG, PNG or PDF, up to 10 MB)</small>
                    </label>
                    <input id={`${id}-file`} ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy}
                        onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
                    {error && <p className="kq-err" role="alert">{error}</p>}
                    {sent && !error && <p className="kq-note" role="status">Reply sent to your Account Officer.</p>}
                    <div className="kq-row">
                        <button type="submit" className="ct-primary" disabled={busy}>
                            <Send size={15} aria-hidden="true" /> {busy ? 'Sending...' : 'Send reply'}
                        </button>
                    </div>
                </form>
            </div>
        </section>
    );
};

export default ApplicantClarifyCard;
