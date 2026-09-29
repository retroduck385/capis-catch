import { useEffect, useState } from 'react';
import { fetchLoanPurposes, updateLoanApplication } from '../api';
import { Field, FormError, Section, StepButtons } from '../fields';
import { hasErrors, validateLoan } from '../validators';

const OTHER = 'OTHER';

const LoanDetailsStep = ({ app, onSaved, onBack }) => {
    const [purposes, setPurposes] = useState([]);
    const [form, setForm] = useState({
        loan_purpose_id: app.loan_purpose_other ? OTHER : (app.loan_purpose_id != null ? String(app.loan_purpose_id) : ''),
        loan_purpose_other: app.loan_purpose_other ?? '',
        property_address: app.property_address ?? '',
        loan_amount: app.loan_amount ?? '',
        loan_term_years: app.loan_term_years ?? '',
    });
    const [errors, setErrors] = useState({});
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchLoanPurposes().then(setPurposes).catch((err) => setError(err.message));
    }, []);

    const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

    // Exactly one of loan_purpose_id / loan_purpose_other is saved (DB check constraint)
    const toRecord = () => ({
        loan_purpose_id: form.loan_purpose_id === OTHER ? null : form.loan_purpose_id,
        loan_purpose_other: form.loan_purpose_id === OTHER ? form.loan_purpose_other : null,
        property_address: form.property_address,
        loan_amount: form.loan_amount,
        loan_term_years: form.loan_term_years,
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        const record = toRecord();
        const found = validateLoan(record);
        if (form.loan_purpose_id === OTHER && found.loan_purpose_id) found.loan_purpose_other = 'Please specify the purpose';
        setErrors(found);
        if (hasErrors(found)) return;

        setSaving(true);
        setError(null);
        try {
            await updateLoanApplication(app.id, record);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <Section title="Loan Details">
                <Field name="loan_purpose_id" label="Purpose" required value={form.loan_purpose_id}
                    error={form.loan_purpose_id === OTHER ? null : errors.loan_purpose_id} onChange={set}
                    options={[...purposes.map((p) => ({ value: String(p.id), label: p.label })),
                        { value: OTHER, label: 'Other (please specify)' }]} />
                {form.loan_purpose_id === OTHER && (
                    <Field name="loan_purpose_other" label="Specify purpose" required
                        value={form.loan_purpose_other} error={errors.loan_purpose_other} onChange={set} />
                )}
                <Field name="property_address" label="Property Address" required
                    value={form.property_address} error={errors.property_address} onChange={set} />
                <Field name="loan_amount" label="Loan Amount (PHP)" type="money" required
                    value={form.loan_amount} error={errors.loan_amount} onChange={set} />
                <Field name="loan_term_years" label="Loan Term (years)" type="number" required
                    value={form.loan_term_years} error={errors.loan_term_years} onChange={set} />
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default LoanDetailsStep;
