// AO's verification of one form section: Verified, or Needs clarification with remarks.
// The choice starts on the section's latest recorded result, so the form matches the chip when you come back to it.
// Recording a check calls onRecorded, which moves the loan folder on to the next section.
import { useState } from 'react';
import { recordKycCheck } from './api';
import { RESULT_LABELS, whenOf } from './options';

const TONES = { VERIFIED: 'ok', NEEDS_CLARIFICATION: 'warn' };

// Latest check of a section as text: "Verified" chip plus who / when / remarks
export const CheckSummary = ({ check, names }) => (check ? (
    <>
        <p className="lf-kyc-meta">by {names[check.checked_by] ?? 'unknown'} · {whenOf(check.checked_at)}</p>
        {check.remarks && <p className="lf-kyc-remark">{check.remarks}</p>}
    </>
) : <p className="lf-kyc-meta">Not checked yet.</p>);

export const CheckChip = ({ check }) => (
    <span className={`lf-chip ${check ? TONES[check.result] : 'none'}`}>
        {check ? RESULT_LABELS[check.result] : 'Not checked'}
    </span>
);

const KycCheckPanel = ({ applicationId, section, complete, latest, names, onRecorded }) => {
    const [result, setResult] = useState(latest?.result ?? '');
    const [remarks, setRemarks] = useState('');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!result) {
            setError('Choose Verified or Needs clarification.');
            return;
        }
        if (result === 'NEEDS_CLARIFICATION' && !remarks.trim()) {
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
        <form onSubmit={handleSubmit} className="lf-card lf-check">
            <div className="lf-cardhead">
                <h3>KYC verification</h3>
                <CheckChip check={latest} />
            </div>
            <CheckSummary check={latest} names={names} />
            {!complete && <p className="lf-err">This section is incomplete, so it can't be marked Verified.</p>}

            <div className="lf-choices" role="radiogroup" aria-label="KYC result">
                <label className="lf-choice">
                    <input type="radio" name="kyc_result" disabled={!complete}
                        checked={result === 'VERIFIED'} onChange={() => setResult('VERIFIED')} /> Verified
                </label>
                <label className="lf-choice">
                    <input type="radio" name="kyc_result"
                        checked={result === 'NEEDS_CLARIFICATION'} onChange={() => setResult('NEEDS_CLARIFICATION')} /> Needs clarification
                </label>
            </div>
            <textarea rows={2}
                aria-label="Remarks"
                placeholder={result === 'NEEDS_CLARIFICATION' ? 'What needs clarification (required)' : 'Remarks (optional)'}
                value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <div className="lf-check-foot">
                {error ? <p className="lf-err" role="alert">{error}</p> : <span />}
                <button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Record check'}
                </button>
            </div>
        </form>
    );
};

export default KycCheckPanel;
