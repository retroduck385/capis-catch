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
            <p className="text-left py-2">Review your application. Go back to any step to make changes.</p>
            <ApplicationSummary app={app} />

            <label className="flex gap-2 items-center py-4 text-left">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I certify that the information above is true and correct.
            </label>

            {missing.length > 0 && (
                <div className="text-red-600 text-left">
                    <p>Your application can't be submitted yet. Still missing:</p>
                    <ul className="list-disc pl-6">
                        {missing.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                </div>
            )}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} disabled={!confirmed} nextLabel="Submit Application" />
        </form>
    );
};

export default ReviewStep;
