import { useState } from 'react';
import { getParty } from '../api';
import { FormError, StepButtons } from '../fields';
import useEmploymentForm from '../useEmploymentForm';
import EmploymentSection from './employmentSection';

const PrincipalEmploymentStep = ({ app, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const employment = useEmploymentForm(principal, 'PRINCIPAL');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!employment.validate()) return;

        setSaving(true);
        setError(null);
        try {
            await employment.save(principal.id);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <EmploymentSection title="Principal Borrower's Employment Information" employment={employment} />
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PrincipalEmploymentStep;
