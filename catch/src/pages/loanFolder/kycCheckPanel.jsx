// AO's verification of one form section: Verified, or Needs clarification with remarks.
// The choice starts on the section's latest recorded result, so the form matches the chip when you come back to it.
// Recording a check calls onRecorded, which moves the loan folder on to the next section.
// In the loan folder it sits in a sticky rail beside the section's form (wide screens) or above it.
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { recordKycCheck } from './api';
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

// extra: shown under the latest result (the loan folder passes "Ask the applicant" for a Needs clarification)
const KycCheckPanel = ({ applicationId, section, complete, latest, names, onRecorded, extra = null }) => {
    const [result, setResult] = useState(latest?.result ?? '');
    const [remarks, setRemarks] = useState('');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const remarksId = useId();
    const needsRemark = result === 'NEEDS_CLARIFICATION';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!result) {
            setError('Choose Verified or Needs clarification.');
            return;
        }
        if (needsRemark && !remarks.trim()) {
            setError('Say what needs clarification.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await recordKycCheck(applicationId, section, result, remarks);
            setRemarks('');
            await onRecorded(); // the page moves on to the next section
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form id={`kyc-${section}`} onSubmit={handleSubmit} className="lf-card lf-check">
            <div className="lf-cardhead">
                <h3>Record <Term k="KYC" /> check<CommentButton topic={`kyc-${section}`} className="lf-comment" /></h3>
                <CheckChip check={latest} />
            </div>
            <div className="lf-check-latest">
                <CheckSummary check={latest} names={names} />
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
                <label className="lf-choice warn">
                    <input type="radio" name="kyc_result"
                        checked={needsRemark} onChange={() => setResult('NEEDS_CLARIFICATION')} />
                    <AlertTriangle size={20} className="mark" aria-hidden="true" />
                    <span><b>Needs clarification</b><small>Say what's unclear</small></span>
                </label>
            </fieldset>
            <label className="lf-fieldlabel" htmlFor={remarksId}>
                Remarks <small>{needsRemark ? '(required)' : '(optional)'}</small>
            </label>
            <textarea id={remarksId} rows={3} aria-required={needsRemark}
                placeholder={needsRemark ? 'What needs clarification' : 'Anything the next person should know'}
                value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <div className="lf-check-foot">
                {error ? <p className="lf-err" role="alert">{error}</p> : <span />}
                <button type="submit" className="lf-primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Record check'}
                </button>
            </div>
        </form>
    );
};

export default KycCheckPanel;
