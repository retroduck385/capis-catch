// The applicant's "Clarification requested: <section>" card on their submitted application: the AO's question, the
// thread so far, and a Reply box (text, optionally one JPG, PNG or PDF file). Shown only while the question is open
// (my_kyc_clarifications()); once the AO marks the section Verified it is gone. The application itself stays read only.
// A dropdown (<details>): the summary row says which part was asked about, the latest message and whose turn it is;
// it starts open while the applicant still has to reply (or when a notification pointed here), closed once they have.
// focus: this is the question the notification pointed to (it is highlighted and scrolled into view by the page).
// onShowPart: scroll to the matching part of the application below.
import { useId, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, FileText, MessageCircleQuestion, Paperclip, Send, X } from 'lucide-react';
import { formatWhen, fullWhen } from '../../components/people';
import { replyClarification } from './api';
import { fileProblem, REPLY_MAX } from './sections';
import ThreadView from './threadView';
import './kycClarify.css';

const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const ApplicantClarifyCard = ({ thread, focus = false, onChanged, onShowPart }) => {
    const [text, setText] = useState('');
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [sent, setSent] = useState(false);
    const fileRef = useRef(null);
    const id = useId();
    const last = thread.messages[thread.messages.length - 1];
    const yourTurn = last?.from !== 'APPLICANT';
    const [open, setOpen] = useState(focus || yourTurn);
    // a notification pointing here while the page is open: open it again
    const [seenFocus, setSeenFocus] = useState(focus);
    if (focus !== seenFocus) {
        setSeenFocus(focus);
        if (focus) setOpen(true);
    }

    const clearFile = () => {
        setFile(null);
        setError(null);
        if (fileRef.current) fileRef.current.value = '';
    };

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
        <section id={`clarify-${thread.section}`} className={`ct-card kq-card kq-fold${focus ? ' focus' : ''}${yourTurn ? ' your-turn' : ''}`}
            aria-labelledby={`${id}-title`}>
            <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
                <summary className="kq-sum">
                    <span className="kq-sum-icon" aria-hidden="true"><MessageCircleQuestion size={20} /></span>
                    <span className="kq-sum-text">
                        <span className="kq-sum-eyebrow">Question from your Account Officer</span>
                        <h2 id={`${id}-title`}>{thread.section_label}</h2>
                        {last && (
                            <span className="kq-sum-last">
                                <span className="kq-sum-quote">{last.from === 'APPLICANT' ? 'You: ' : ''}{last.body}</span>
                                <time dateTime={last.created_at} title={fullWhen(last.created_at)}>{formatWhen(last.created_at)}</time>
                            </span>
                        )}
                    </span>
                    <span className={`kq-sum-chip ${yourTurn ? 'warn' : 'info'}`}>
                        {yourTurn ? 'Needs your reply' : 'Replied, waiting for your Account Officer'}
                    </span>
                    <ChevronDown className="kq-chev" size={20} aria-hidden="true" />
                </summary>
                <div className="kq-fold-body">
                    <div className="kq-intro">
                        <p className="kq-note">
                            Answer below. Your application can&apos;t be edited here; your Account Officer will update it if needed.
                        </p>
                        {onShowPart && (
                            <button type="button" className="kq-showpart" onClick={onShowPart}>
                                <ArrowDown size={15} aria-hidden="true" />Show the {thread.section_label} part
                            </button>
                        )}
                    </div>
                    <ThreadView thread={thread} viewer="APPLICANT" />
                    <form className="kq-form kq-reply" onSubmit={send}>
                        <div className="kq-labelrow">
                            <label htmlFor={`${id}-reply`}>Your reply</label>
                            <span className="kq-counter">{text.length} / {REPLY_MAX}</span>
                        </div>
                        <textarea id={`${id}-reply`} rows={3} maxLength={REPLY_MAX} value={text} disabled={busy}
                            onChange={(e) => { setText(e.target.value); setError(null); setSent(false); }} />
                        {/* the real file input stays hidden (no browser "No file chosen" text or tooltip); the Attach button opens it */}
                        <input id={`${id}-file`} ref={fileRef} type="file" hidden accept="image/jpeg,image/png,application/pdf" disabled={busy}
                            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
                        {file && (
                            <div className="kq-chosen">
                                <FileText size={18} aria-hidden="true" />
                                <span className="kq-chosen-name">{file.name}</span>
                                <span className="kq-chosen-size">{fileSize(file.size)}</span>
                                <button type="button" className="kq-chosen-remove" onClick={clearFile} disabled={busy}
                                    aria-label={`Remove ${file.name}`}>
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </div>
                        )}
                        {error && <p className="kq-err" role="alert">{error}</p>}
                        {sent && !error && <p className="kq-note" role="status">Reply sent to your Account Officer.</p>}
                        <div className="kq-actions">
                            <div className="kq-attach-wrap">
                                <button type="button" className="kq-attach" disabled={busy} aria-describedby={`${id}-filehint`}
                                    onClick={() => fileRef.current?.click()}>
                                    <Paperclip size={16} aria-hidden="true" />{file ? 'Change file' : 'Attach a file'}
                                </button>
                                <small id={`${id}-filehint`} className="kq-hint">Optional. JPG, PNG or PDF, up to 10 MB</small>
                            </div>
                            <button type="submit" className="ct-primary" disabled={busy}>
                                <Send size={15} aria-hidden="true" /> {busy ? 'Sending...' : 'Send reply'}
                            </button>
                        </div>
                    </form>
                </div>
            </details>
        </section>
    );
};

export default ApplicantClarifyCard;
