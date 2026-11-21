// The applicant's five steps on a submitted application (Received → Background check → Evaluation → Review →
// Final approval), the current one highlighted. The outcome shows at the end only once the Account Officer has sent
// the notice (the database's visible_status); until then the file stays on Final approval. Nothing shows for a draft
// or an incomplete submission. After a reviewer's return the current step is Evaluation again (accurate on purpose).
// Styles: .ap-track in applicantPages.css.
import { Check } from 'lucide-react';
import { APPLICANT_STAGES, applicantStageIndex, shownOutcome } from './applicantStatus';
import { useVisibleStatus } from './useVisibleStatus';

const OUTCOME_TONES = { Approved: 'ok', Rejected: 'none', Deferred: 'warn' };

const ApplicantStageTracker = ({ application }) => {
    const visible = useVisibleStatus(application);
    const at = applicantStageIndex(application.status);
    if (at === null) return null;
    const outcome = shownOutcome(visible);

    return (
        <section className="ap-track" aria-label="Where your application is">
            <ol>
                {APPLICANT_STAGES.map((label, i) => {
                    const done = i < at || (outcome && i === at);
                    const now = i === at && !outcome;
                    return (
                        <li key={label} className={done ? 'done' : now ? 'now' : ''} aria-current={now ? 'step' : undefined}>
                            <span className="dot" aria-hidden="true">{done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                            <span className="txt">
                                {label}
                                {now && <small>Now</small>}
                                {done && <span className="sr-only"> (done)</span>}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {outcome && (
                <p className={`ap-track-outcome ${OUTCOME_TONES[outcome] ?? ''}`}>
                    Outcome: <b>{outcome}</b>. See the message from your Account Officer in your notifications.
                </p>
            )}
        </section>
    );
};

export default ApplicantStageTracker;
