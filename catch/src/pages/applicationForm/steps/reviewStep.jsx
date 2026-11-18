// Last step: the whole application as label-over-value tiles (SummaryContext stacked, as in the staff loan folder),
// a certify box, and Submit. Only the server decides it is complete (submitApplication returns what's missing).
import { useState } from 'react';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { submitApplication } from '../api';
import { FormError, StepButtons } from '../fields';
import ApplicationSummary from '../applicationSummary';
import { SummaryContext } from '../summaryContext';

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
        <form onSubmit={handleSubmit} noValidate>
            <p className="ct-intro">Check each part below. Use the steps on the left to go back and change anything.</p>
            <div className="ap-summary">
                <SummaryContext.Provider value={{ stacked: true, hideEmpty: false }}>
                    <ApplicationSummary app={app} />
                </SummaryContext.Provider>
            </div>

            <label className={`ap-certify${confirmed ? ' on' : ''}`}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <ShieldCheck size={20} aria-hidden="true" />
                <span>I certify that the information above is true and correct.</span>
            </label>

            {missing.length > 0 && (
                <div className="ap-missing" role="alert">
                    <CircleAlert size={18} aria-hidden="true" />
                    <div>
                        <strong>Your application can&apos;t be submitted yet. Still missing:</strong>
                        <ul>
                            {missing.map((m) => <li key={m}>{m}</li>)}
                        </ul>
                    </div>
                </div>
            )}
            <FormError error={error} />
            <p className="ct-hint">Your application is only sent for review when you press Submit application.</p>
            <StepButtons onBack={onBack} saving={saving} disabled={!confirmed} nextLabel="Submit application" />
        </form>
    );
};

export default ReviewStep;
