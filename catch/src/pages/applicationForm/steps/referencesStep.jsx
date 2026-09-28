import { useState } from 'react';
import { toForm, upsertReferences } from '../api';
import { FieldGroup, FormError, Section, StepButtons } from '../fields';
import { REFERENCE_FIELDS } from '../options';
import { hasErrors, validateReference } from '../validators';

const KEYS = Object.keys(REFERENCE_FIELDS);

const ReferencesStep = ({ app, onSaved, onBack }) => {
    const [refs, setRefs] = useState(() => [1, 2, 3].map((n) =>
        toForm((app.character_references ?? []).find((r) => r.reference_no === n), KEYS)));
    const [errors, setErrors] = useState([{}, {}, {}]);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const update = (i, field, value) => setRefs((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = refs.map(validateReference);
        setErrors(found);
        if (found.some(hasErrors)) return;

        setSaving(true);
        setError(null);
        try {
            await upsertReferences(app.id, refs);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            {refs.map((ref, i) => (
                <Section key={i} title={`Reference #${i + 1}`}>
                    <FieldGroup config={REFERENCE_FIELDS} fields={KEYS} required={KEYS} values={ref}
                        errors={errors[i]} onChange={(f, v) => update(i, f, v)} prefix={`ref${i + 1}-`} />
                </Section>
            ))}
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default ReferencesStep;
