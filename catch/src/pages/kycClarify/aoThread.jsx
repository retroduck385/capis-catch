// The AO's view of one KYC section's clarification threads (loan folder): the open thread with an Answer box, and the
// closed ones as read-only history. Marking the section Verified (the KYC check panel, unchanged) closes the open one.
// threads: kyc_clarification_threads() rows for this section, oldest first. canAnswer: the assigned AO (the database
// checks it again). onChanged: reload the threads after an answer.
import { useId, useState } from 'react';
import { CircleHelp, Send } from 'lucide-react';
import { answerClarification } from './api';
import { REPLY_MAX } from './sections';
import ThreadView from './threadView';
import { formatDay } from '../../components/people';

const AoThread = ({ threads, canAnswer, onChanged }) => {
    const open = threads.find((t) => t.status === 'OPEN') ?? null;
    const past = threads.filter((t) => t.status === 'CLOSED').reverse();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const id = useId();
    if (!open && past.length === 0) return null;

    const send = async (e) => {
        e.preventDefault();
        if (!text.trim()) { setError('Write your answer.'); return; }
        setBusy(true);
        setError(null);
        try {
            await answerClarification(open.id, text.trim());
            setText('');
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const replied = open?.messages.some((m) => m.from === 'APPLICANT');
    return (
        <div className="kq-ao">
            {open && (
                <>
                    <p className={`kq-status open`}>
                        <CircleHelp size={15} aria-hidden="true" />
                        {replied ? 'Question open: the applicant replied' : 'Question open: waiting for the applicant'}
                    </p>
                    <ThreadView thread={open} viewer="STAFF" />
                    {canAnswer && (
                        <form className="kq-form" onSubmit={send}>
                            <label htmlFor={id}>Answer the applicant <small>(in-app only)</small></label>
                            <textarea id={id} rows={2} maxLength={REPLY_MAX} value={text}
                                onChange={(e) => { setText(e.target.value); setError(null); }} />
                            <p className="kq-counter">{text.length} / {REPLY_MAX}</p>
                            {error && <p className="kq-err" role="alert">{error}</p>}
                            <div className="kq-row">
                                <button type="submit" className="lf-btn" disabled={busy}>
                                    <Send size={15} aria-hidden="true" />{busy ? 'Sending...' : 'Send answer'}
                                </button>
                                <span className="kq-note">Mark the section Verified when it is settled: that closes the question.</span>
                            </div>
                        </form>
                    )}
                </>
            )}
            {past.length > 0 && (
                <details className="kq-history">
                    <summary>Earlier questions on this section ({past.length}, closed)</summary>
                    {past.map((t) => (
                        <div key={t.id} className="kq-past">
                            <p className="kq-note">Closed {formatDay(t.closed_at)}{t.closed_by ? ` by ${t.closed_by}` : ''} (section verified)</p>
                            <ThreadView thread={t} viewer="STAFF" />
                        </div>
                    ))}
                </details>
            )}
        </div>
    );
};

export default AoThread;
