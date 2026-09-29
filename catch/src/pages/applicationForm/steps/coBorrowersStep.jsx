// Asks how many co-borrowers there are; the wizard then adds one step per co-borrower
import { useState } from 'react';
import { getParties, setCoBorrowerCount } from '../api';
import { Field, FormError, Section, StepButtons } from '../fields';
import { MAX_CO_BORROWERS, partyLabel } from '../options';

const CoBorrowersStep = ({ app, onSaved, onBack }) => {
    const existing = getParties(app, ['CO_BORROWER']);
    const [count, setCount] = useState(String(existing.length));
    const [fieldError, setFieldError] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const n = Number(count);
        if (count === '' || !Number.isInteger(n) || n < 0 || n > MAX_CO_BORROWERS) {
            setFieldError(`Whole number, 0 to ${MAX_CO_BORROWERS}`);
            return;
        }
        setFieldError(null);

        const removed = existing.filter((p) => p.party_no > n && (p.first_name || p.last_name));
        if (removed.length && !window.confirm(
            `This will remove ${removed.map((p) => `${partyLabel(p)} (${p.first_name ?? ''} ${p.last_name ?? ''})`).join(', ')}. Continue?`)) {
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await setCoBorrowerCount(app.id, n, existing.map((p) => p.party_no));
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <Section title="Co-borrowers">
                <p>A co-borrower shares responsibility for the loan and adds their income to the application.
                    Enter 0 if you have none.</p>
                <Field name="co_borrower_count" label="Number of Co-borrowers" type="number" required
                    value={count} error={fieldError} onChange={(_, v) => setCount(v)} />
                {existing.length > 0 && (
                    <ul className="list-disc pl-6 text-sm">
                        {existing.map((p) => (
                            <li key={p.id}>{partyLabel(p)}: {[p.first_name, p.last_name].filter(Boolean).join(' ') || 'not filled in yet'}</li>
                        ))}
                    </ul>
                )}
                <p className="text-sm pt-2">Lowering the number removes the last co-borrowers in the list.</p>
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default CoBorrowersStep;
