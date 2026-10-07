// AO's verification of one form section: Verified, or Needs clarification with remarks
import { useState } from 'react';
import { FormError } from '../applicationForm/fields';
import { recordKycCheck } from './api';
import { RESULT_LABELS } from './options';

export const CheckSummary = ({ check, names }) => (check ? (
    <p>
        <strong>{RESULT_LABELS[check.result]}</strong> by {names[check.checked_by] ?? 'unknown'} on{' '}
        {new Date(check.checked_at).toLocaleString()}
        {check.remarks && <span>: {check.remarks}</span>}
    </p>
) : <p>Not checked yet.</p>);

const KycCheckPanel = ({ applicationId, section, complete, latest, names, onRecorded }) => {
    const [result, setResult] = useState('');
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
            setResult('');
            setRemarks('');
            await onRecorded();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="border p-3 my-3 text-left">
            <h3 className="font-semibold">KYC verification</h3>
            <CheckSummary check={latest} names={names} />
            {!complete && <p className="text-red-600">This section is incomplete, so it can't be marked Verified.</p>}
            <div className="py-2">
                <label className="pr-4">
                    <input type="radio" name="kyc_result" disabled={!complete}
                        checked={result === 'VERIFIED'} onChange={() => setResult('VERIFIED')} /> Verified
                </label>
                <label>
                    <input type="radio" name="kyc_result"
                        checked={result === 'NEEDS_CLARIFICATION'} onChange={() => setResult('NEEDS_CLARIFICATION')} /> Needs clarification
                </label>
            </div>
            <textarea className="border w-full p-1" rows={2}
                placeholder={result === 'NEEDS_CLARIFICATION' ? 'What needs clarification (required)' : 'Remarks (optional)'}
                value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <FormError error={error} />
            <button type="submit" className="border px-4 py-2" disabled={saving}>
                {saving ? 'Saving...' : 'Record check'}
            </button>
        </form>
    );
};

export default KycCheckPanel;
