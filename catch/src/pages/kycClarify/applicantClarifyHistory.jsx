// The applicant's past (closed) clarification questions on one submitted application: a slim bar under the open
// question cards ("Past questions from your Account Officer (n)") that opens them in a popup (components/infoModal.jsx).
// Each question: the part it was about, how it ended (closed: the Account Officer checked that part / withdrawn), and the
// whole conversation, read only (threadView.jsx). Newest first. Hidden when there are none, or when the history
// can't be read (e.g. 20261206_applicant_clarification_history.sql not run yet).
// reloadKey: changes when the open questions change, so a question that just closed shows up here.
// Styles: "applicant past questions" in kycClarify.css.
import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, History, Undo2 } from 'lucide-react';
import InfoModal from '../../components/infoModal';
import { formatDay, fullWhen } from '../../components/people';
import { fetchMyClarificationHistory } from './api';
import ThreadView from './threadView';

const ApplicantClarifyHistory = ({ applicationId, reloadKey }) => {
    const [threads, setThreads] = useState([]);
    const [show, setShow] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchMyClarificationHistory(applicationId)
            .then((rows) => { if (!cancelled) setThreads(rows); })
            .catch(() => { if (!cancelled) setThreads([]); });
        return () => { cancelled = true; };
    }, [applicationId, reloadKey]);

    if (threads.length === 0) return null;
    const n = threads.length;

    return (
        <>
            <button type="button" className="kq-histbar" aria-haspopup="dialog" onClick={() => setShow(true)}>
                <span className="kq-histbar-icon" aria-hidden="true"><History size={18} /></span>
                <span className="kq-histbar-text">
                    <b>Past questions from your Account Officer</b>
                    <small>{n} closed question{n === 1 ? '' : 's'}, with your replies</small>
                </span>
                <span className="kq-histbar-count" aria-hidden="true">{n}</span>
                <ChevronRight size={18} className="kq-histbar-go" aria-hidden="true" />
            </button>

            {show && (
                <InfoModal className="kq-modal" Icon={History} eyebrow="Your application" title="Past questions"
                    onClose={() => setShow(false)} focusBody note={`${n} closed question${n === 1 ? '' : 's'}, newest first`}>
                    <ol className="kq-histlist">
                        {threads.map((t) => (
                            <li key={t.id} className="kq-histitem">
                                <div className="kq-histhead">
                                    <h3>{t.section_label}</h3>
                                    <span className={`kq-histchip ${t.withdrawn ? 'withdrawn' : 'closed'}`}>
                                        {t.withdrawn ? <Undo2 size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                                        {t.withdrawn ? 'Withdrawn' : 'Closed'}
                                        {t.closed_at && <> · <time dateTime={t.closed_at} title={fullWhen(t.closed_at)}>{formatDay(t.closed_at)}</time></>}
                                    </span>
                                </div>
                                <p className="kq-note kq-histnote">
                                    {t.withdrawn
                                        ? 'Your Account Officer withdrew this question. Nothing more is needed.'
                                        : `Your Account Officer checked the ${t.section_label} part. Nothing more is needed.`}
                                </p>
                                <ThreadView thread={t} viewer="APPLICANT" />
                            </li>
                        ))}
                    </ol>
                </InfoModal>
            )}
        </>
    );
};

export default ApplicantClarifyHistory;
