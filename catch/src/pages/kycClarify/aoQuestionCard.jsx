// The AO's "Question to the applicant" card in the loan folder's KYC rail (loanFolderPage.jsx). The rail only shows a
// summary: where the question stands (the applicant replied / waiting), the latest message, and a button that opens
// the whole conversation (aoThread.jsx: thread, Answer box, Close / Withdraw, earlier questions) in a popup
// (components/infoModal.jsx), so the narrow rail doesn't squeeze it. The answer being typed is kept here, so closing
// the popup by accident doesn't lose it. kycCheckPanel's "Question open" button opens the popup too (it clicks
// [data-open-thread] inside #kq-thread-<section>).
// Styles: "AO question card" in kycClarify.css.
import { useState } from 'react';
import { ArrowUpRight, Clock, MessageCircleQuestion, MessageCircleReply } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import { formatWhen, fullWhen } from '../../components/people';
import AoThread from './aoThread';

const AoQuestionCard = ({ section, sectionLabel, threads, canWithdraw, complete, onChanged }) => {
    const [show, setShow] = useState(false);
    const [draft, setDraft] = useState('');
    const open = threads.find((t) => t.status === 'OPEN') ?? null;
    const closed = threads.filter((t) => t.status === 'CLOSED').length;
    const last = open?.messages[open.messages.length - 1];
    const replied = last?.from === 'APPLICANT';
    const label = sectionLabel ?? open?.section_label ?? threads[0]?.section_label;

    return (
        <section id={`kq-thread-${section}`} tabIndex={-1} className="lf-card lf-check kq-card kq-aocard kq-aosum"
            aria-label="Question to the applicant">
            <div className="lf-cardhead"><h3>Question to the applicant</h3></div>
            {open ? (
                <p className={`kq-state ${replied ? 'replied' : 'waiting'}`}>
                    {replied ? <MessageCircleReply size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />}
                    <span>
                        <b>{replied ? 'The applicant replied' : 'Waiting for the applicant'}</b>
                        {last && (
                            <small className="kq-aosum-last">
                                <span>{replied ? 'Applicant: ' : 'You: '}{last.body}</span>
                                <time dateTime={last.created_at} title={fullWhen(last.created_at)}>{formatWhen(last.created_at)}</time>
                            </small>
                        )}
                    </span>
                </p>
            ) : (
                <p className="kq-note kq-aosum-none">No open question. {closed} earlier question{closed === 1 ? '' : 's'} on this section, closed.</p>
            )}
            <button type="button" className={`kq-aosum-open${open && replied ? ' primary' : ''}`} data-open-thread
                aria-haspopup="dialog" onClick={() => setShow(true)}>
                {open ? <MessageCircleQuestion size={16} aria-hidden="true" /> : null}
                {open ? (replied ? 'Open and answer' : 'Open conversation') : 'See earlier questions'}
                <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            {draft.trim() && !show && <p className="kq-hint">You have an answer that isn&apos;t sent yet.</p>}

            {show && (
                <InfoModal className="kq-modal" Icon={MessageCircleQuestion} tone={open ? (replied ? 'none' : 'warn') : 'none'}
                    eyebrow="Question to the applicant" title={label} onClose={() => setShow(false)}
                    note={open ? 'The applicant sees this in the app.' : 'Closed questions are read only.'}>
                    <AoThread threads={threads} canAnswer canWithdraw={canWithdraw} complete={complete} onChanged={onChanged}
                        draft={draft} onDraft={setDraft} />
                </InfoModal>
            )}
        </section>
    );
};

export default AoQuestionCard;
