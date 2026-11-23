// AO's verification of one form section: Verified (unchanged: a direct insert, remarks optional), or Needs
// clarification: the AO types a question for the applicant and ask_kyc_clarification() records the check, opens the
// section's thread and sends the question (in-app, SMS, email). While a question is open, the Needs clarification
// option becomes a link down to the question card (one open question per section); marking Verified closes it
// (20261203_kyc_clarifications.sql), and so does that card's Close question.
// The choice starts on the section's latest recorded result, so the form matches the chip when you come back to it.
// Recording a check calls onRecorded (the page reloads its checks) and stays on the section, so the AO sees the result,
// the remarks and "Ask the applicant" for a Needs clarification. The Next button beside it moves on when the AO is ready.
// In the loan folder it sits in a sticky rail beside the section's form (wide screens) or above it.
import { useId, useState } from 'react';
import { AlertTriangle, ArrowUpRight, ArrowRight, CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { recordKycCheck } from './api';
import { askClarification } from '../kycClarify/api';
import { QUESTION_MAX } from '../kycClarify/sections';
import { RESULT_LABELS } from './options';
import Byline from '../../components/byline';
import CommentButton from '../messages/commentButton';
import { Term } from '../../components/term';

const TONES = { VERIFIED: 'ok', NEEDS_CLARIFICATION: 'warn' };

// Latest check of a section: who / when (a byline: avatar, name, short time) and the remarks
export const CheckSummary = ({ check, names }) => (check ? (
    <>
        <Byline name={names[check.checked_by]} at={check.checked_at} className="lf-kyc-by" />
        {check.remarks && <p className="lf-kyc-remark">{check.remarks}</p>}
    </>
) : <p className="lf-kyc-meta">Not checked yet.</p>);

export const CheckChip = ({ check }) => (
    <span className={`lf-chip ${check ? TONES[check.result] : 'none'}`}>
        {check ? RESULT_LABELS[check.result] : 'Not checked'}
    </span>
);

// extra: shown under the latest result. openThread: a question on this section is still open
// onNext / nextLabel: the button that goes on to the next section (after the last one, to Request CI)
const KycCheckPanel = ({ applicationId, section, complete, latest, names, onRecorded, onNext, nextLabel = 'Next', extra = null,
    openThread = false }) => {
    const [picked, setResult] = useState(latest?.result ?? '');
    // Needs clarification can't be picked again while its question is open
    const result = openThread && picked === 'NEEDS_CLARIFICATION' ? '' : picked;
    const [remarks, setRemarks] = useState('');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [recorded, setRecorded] = useState(false);
    const remarksId = useId();
    const needsRemark = result === 'NEEDS_CLARIFICATION';

    // The section's question card sits under this panel in the rail (kycClarify/aoQuestionCard.jsx, id
    // kq-thread-<section>): open its conversation popup
    const showThread = () => {
        document.getElementById(`kq-thread-${section}`)?.querySelector('[data-open-thread]')?.click();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!result) {
            setError('Choose Verified or Needs clarification.');
            return;
        }
        if (needsRemark && !remarks.trim()) {
            setError('Write your question for the applicant.');
            return;
        }
        setSaving(true);
        setError(null);
        setRecorded(false);
        try {
            if (needsRemark) await askClarification(applicationId, section, remarks.trim());
            else await recordKycCheck(applicationId, section, result, remarks);
            setRemarks('');
            await onRecorded(); // the page reloads its checks; this section stays open
            setRecorded(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form id={`kyc-${section}`} onSubmit={handleSubmit} className="lf-card lf-check">
            <div className="lf-cardhead lf-check-head">
                <h3>Record <Term k="KYC" /> check</h3>
                <CommentButton topic={`kyc-${section}`} className="lf-comment" />
            </div>
            <div className="lf-check-latest">
                <div className="lf-check-latest-head">
                    <span>Latest result</span>
                    <CheckChip check={latest} />
                </div>
                {latest && <CheckSummary check={latest} names={names} />}
                {extra}
            </div>
            {!complete && (
                <p className="lf-warnnote">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>This section is incomplete, so it can't be marked Verified.</span>
                </p>
            )}

            <fieldset className="lf-choices">
                <legend className="sr-only"><Term k="KYC" /> result</legend>
                <label className="lf-choice ok">
                    <input type="radio" name="kyc_result" disabled={!complete}
                        checked={result === 'VERIFIED'} onChange={() => setResult('VERIFIED')} />
                    <CheckCircle2 size={20} className="mark" aria-hidden="true" />
                    <span><b>Verified</b><small>Matches the documents</small></span>
                </label>
                {openThread ? (
                    // one open question per section: instead of a dead option, a way to its conversation popup
                    <button type="button" className="lf-choice warn lf-choice-open" aria-haspopup="dialog" onClick={showThread}>
                        <MessageCircleQuestion size={20} className="mark" aria-hidden="true" />
                        <span><b>Question open</b><small>Answer, close or withdraw it</small></span>
                        <ArrowUpRight size={16} className="go" aria-hidden="true" />
                    </button>
                ) : (
                    <label className="lf-choice warn">
                        <input type="radio" name="kyc_result" checked={needsRemark} onChange={() => setResult('NEEDS_CLARIFICATION')} />
                        <AlertTriangle size={20} className="mark" aria-hidden="true" />
                        <span><b>Needs clarification</b><small>Ask the applicant a question</small></span>
                    </label>
                )}
            </fieldset>
            <label className="lf-fieldlabel" htmlFor={remarksId}>
                {needsRemark ? <>Question for the applicant</> : <>Remarks <small>(optional)</small></>}
            </label>
            {needsRemark && (
                <p className="lf-kyc-meta" id={`${remarksId}-hint`}>
                    Sent by app, SMS and email. No links.
                </p>
            )}
            <textarea id={remarksId} rows={3} aria-required={needsRemark} maxLength={needsRemark ? QUESTION_MAX : undefined}
                aria-describedby={needsRemark ? `${remarksId}-hint` : undefined}
                placeholder={needsRemark ? 'Type your question' : 'Anything the next person should know'}
                value={remarks} onChange={(e) => { setRemarks(e.target.value); setRecorded(false); }} />
            {needsRemark && <p className="lf-kyc-meta">{remarks.length} / {QUESTION_MAX}</p>}
            {error && <p className="lf-err" role="alert">{error}</p>}
            {recorded && !error && (
                <p className="lf-check-done" role="status"><CheckCircle2 size={16} aria-hidden="true" />
                    {latest?.result === 'NEEDS_CLARIFICATION' ? 'Question sent.' : 'Check recorded.'}</p>
            )}
            <div className="lf-check-foot">
                <button type="submit" className="lf-primary" disabled={saving}>
                    {saving ? 'Saving...' : needsRemark ? 'Send question' : 'Record check'}
                </button>
                {onNext && (
                    <button type="button" className="lf-btn lf-check-next" onClick={onNext} disabled={saving}>
                        {nextLabel}<ArrowRight size={16} aria-hidden="true" />
                    </button>
                )}
            </div>
        </form>
    );
};

export default KycCheckPanel;
