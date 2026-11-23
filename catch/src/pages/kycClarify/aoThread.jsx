// The AO's view of one KYC section's clarification threads (loan folder): the open thread with an Answer box and the
// ways to finish it, and the closed ones as read-only history.
// threads: kyc_clarification_threads() rows for this section, oldest first. canAnswer: the assigned AO (the database
// checks it again). canWithdraw: the assigned AO while the file is in Intake or Credit Investigation; the same AO can
// also Close the question (it records the section as Verified, which closes the thread; complete = the section can be
// Verified). Withdrawing closes it without a result. Either way the applicant gets the same neutral line.
// onChanged: reload the threads and checks after a change.
// draft / onDraft (optional): the answer being typed, kept by the caller (aoQuestionCard.jsx keeps it while its popup
// is closed); without them the box keeps its own.
import { useId, useState } from 'react';
import { CheckCircle2, Clock, MessageCircleReply, Send, Undo2 } from 'lucide-react';
import { answerClarification, closeClarification, withdrawClarification } from './api';
import { REPLY_MAX } from './sections';
import ThreadView from './threadView';
import { formatDay } from '../../components/people';

const AoThread = ({ threads, canAnswer, canWithdraw = false, complete = true, onChanged, draft, onDraft }) => {
    const open = threads.find((t) => t.status === 'OPEN') ?? null;
    const past = threads.filter((t) => t.status === 'CLOSED').reverse();
    const [ownText, setOwnText] = useState('');
    const text = draft ?? ownText;
    const setText = onDraft ?? setOwnText;
    const [busy, setBusy] = useState(null);   // 'send' | 'close' | 'withdraw' while saving
    const [error, setError] = useState(null);
    const id = useId();
    if (!open && past.length === 0) return null;

    const run = async (kind, action) => {
        setBusy(kind);
        setError(null);
        try {
            await action();
            await onChanged();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const send = (e) => {
        e.preventDefault();
        if (!text.trim()) { setError('Write your answer.'); return; }
        run('send', async () => {
            await answerClarification(open.id, text.trim());
            setText('');
        });
    };

    const close = () => {
        if (!window.confirm(`Close this question? ${open.section_label} is marked Verified and the applicant is told the question is closed.`)) return;
        run('close', () => closeClarification(open));
    };

    const withdraw = () => {
        if (!window.confirm('Withdraw this question? It closes without a result, and the applicant is told it is closed.')) return;
        run('withdraw', () => withdrawClarification(open.id));
    };

    const replies = open ? open.messages.filter((m) => m.from === 'APPLICANT').length : 0;
    const canClose = canWithdraw;
    return (
        <div className="kq-ao">
            {open && (
                <>
                    <p className={`kq-state ${replies ? 'replied' : 'waiting'}`}>
                        {replies
                            ? <MessageCircleReply size={18} aria-hidden="true" />
                            : <Clock size={18} aria-hidden="true" />}
                        <span>
                            <b>{replies ? 'The applicant replied' : 'Waiting for the applicant'}</b>
                            <small>{replies ? 'Answer them, or close the question if it is settled.' : 'You can still add to the question below.'}</small>
                        </span>
                    </p>
                    <ThreadView thread={open} viewer="STAFF" />

                    {canAnswer && (
                        <form className="kq-form kq-answer" onSubmit={send}>
                            <div className="kq-labelrow">
                                <label htmlFor={id}>Answer the applicant</label>
                                <span className="kq-counter">{text.length} / {REPLY_MAX}</span>
                            </div>
                            <textarea id={id} rows={2} maxLength={REPLY_MAX} value={text} disabled={Boolean(busy)}
                                aria-describedby={`${id}-hint`} placeholder="Write a reply"
                                onChange={(e) => { setText(e.target.value); setError(null); }} />
                            <div className="kq-answer-foot">
                                <small id={`${id}-hint`} className="kq-hint">In the app only, no SMS or email.</small>
                                <button type="submit" className="kq-send" disabled={Boolean(busy)}>
                                    <Send size={15} aria-hidden="true" />{busy === 'send' ? 'Sending...' : 'Send answer'}
                                </button>
                            </div>
                        </form>
                    )}

                    {(canClose || canWithdraw) && (
                        <div className="kq-finish" role="group" aria-labelledby={`${id}-finish`}>
                            <p id={`${id}-finish`} className="kq-finish-title">Done with this question?</p>
                            <div className="kq-finish-btns">
                                {canClose && (
                                    <button type="button" className="kq-close" disabled={Boolean(busy) || !complete}
                                        aria-describedby={`${id}-finish-hint`} onClick={close}>
                                        <CheckCircle2 size={16} aria-hidden="true" />{busy === 'close' ? 'Closing...' : 'Close question'}
                                    </button>
                                )}
                                {canWithdraw && (
                                    <button type="button" className="kq-withdraw" disabled={Boolean(busy)}
                                        aria-describedby={`${id}-finish-hint`} onClick={withdraw}>
                                        <Undo2 size={16} aria-hidden="true" />{busy === 'withdraw' ? 'Withdrawing...' : 'Withdraw'}
                                    </button>
                                )}
                            </div>
                            <p id={`${id}-finish-hint`} className="kq-hint">
                                {complete
                                    ? <><b>Close</b> marks this section Verified. <b>Withdraw</b> closes it without a result.</>
                                    : <>This section is incomplete, so it can&apos;t be marked Verified yet. Complete it first, or withdraw the question.</>}
                            </p>
                        </div>
                    )}
                    {error && <p className="kq-err" role="alert">{error}</p>}
                </>
            )}
            {past.length > 0 && (
                <details className="kq-history" open={!open || undefined}>
                    <summary>Earlier questions on this section ({past.length}, closed)</summary>
                    {past.map((t) => (
                        <div key={t.id} className="kq-past">
                            <p className="kq-note">
                                {t.withdrawn ? 'Withdrawn' : 'Closed'} {formatDay(t.closed_at)}{t.closed_by ? ` by ${t.closed_by}` : ''}
                                {t.withdrawn ? '' : ' (section verified)'}
                            </p>
                            <ThreadView thread={t} viewer="STAFF" />
                        </div>
                    ))}
                </details>
            )}
        </div>
    );
};

export default AoThread;
