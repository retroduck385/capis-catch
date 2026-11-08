import { useState } from 'react';
import { submitApplication } from '../api';
import { FormError, StepButtons } from '../fields';
import ApplicationSummary from '../applicationSummary';

const ReviewStep = ({ app, onRefresh, onBack }) => {
    const [confirmed, setConfirmed] = useState(false);
    const [missing, setMissing] = useState([]);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            // Server re-checks completeness; it only moves to SUBMITTED when nothing is missing
            const result = await submitApplication(app.id);
            setMissing(result ?? []);
            if (!result?.length) await onRefresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <p>Check each sheet below. Use the list on the left to go back and change anything.</p>
            <ApplicationSummary app={app} />

            <label className="flex gap-2 items-center py-4 text-left">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I certify that the information above is true and correct.
            </label>

            {missing.length > 0 && (
                <div className="ct-note" role="alert">
                    <strong>Your application can't be submitted yet. Still missing:</strong>
                    <ul className="list-disc pl-6">
                        {missing.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                </div>
            )}
            <FormError error={error} />
            <p className="ct-hint">Your application is only sent for review when you press Submit application.</p>
            <StepButtons onBack={onBack} saving={saving} disabled={!confirmed} nextLabel="Submit application" />
        </form>
    );
};

export default ReviewStep;
