import { useState } from 'react';
import { deleteParty, getParty, replaceApplicantRows, toForm, upsertParty } from '../api';
import { Field, FormError, PersonFields, Section, StepButtons } from '../fields';
import { MAX_DEPENDENTS, PARTY_FIELDS } from '../options';
import { hasErrors, validateDependents, validatePerson } from '../validators';

const FIELDS = PARTY_FIELDS.PRINCIPAL.map(([f]) => f);

const PrincipalInfoStep = ({ app, session, profile, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const [form, setForm] = useState(() => {
        if (principal) return toForm(principal, FIELDS);
        // First time here: start from the master profile and the account email
        return { ...toForm(profile, FIELDS), email_address: session?.user?.email ?? '' };
    });
    const savedAges = (principal?.dependents ?? []).map((d) => String(d.age));
    const [dependentCount, setDependentCount] = useState(principal ? String(savedAges.length) : '');
    const [dependentAges, setDependentAges] = useState(savedAges);
    const [errors, setErrors] = useState({});
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

    const count = Number(dependentCount);
    const shownAges = Number.isInteger(count) && count > 0 ? Math.min(count, MAX_DEPENDENTS) : 0;

    const setAge = (i, value) => setDependentAges((ages) => {
        const next = [...ages];
        next[i] = value;
        return next;
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = { ...validatePerson(form, 'PRINCIPAL'), ...validateDependents(dependentCount, dependentAges) };
        setErrors(found);
        if (hasErrors(found)) return;

        const spouse = getParty(app, 'SPOUSE');
        if (spouse && form.civil_status !== 'MARRIED'
            && !window.confirm('Changing civil status will remove the spouse information you entered. Continue?')) {
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const saved = await upsertParty(app.id, 'PRINCIPAL', form);
            await replaceApplicantRows('dependents', saved.id,
                dependentAges.slice(0, count).map((age) => ({ age: Number(age) })));
            if (spouse && form.civil_status !== 'MARRIED') await deleteParty(app.id, 'SPOUSE');
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            {!principal && (
                <p className="text-left text-sm py-2">Pre-filled from your profile. Please check each field before continuing.</p>
            )}
            <Section title="Principal Borrower Information">
                <PersonFields role="PRINCIPAL" values={form} errors={errors} onChange={set} />
            </Section>
            <Section title="Dependents">
                <Field name="dependent_count" label="Number of Dependents" type="number" required placeholder="0"
                    value={dependentCount} error={errors.dependent_count}
                    onChange={(_, v) => setDependentCount(v)} />
                {Array.from({ length: shownAges }, (_, i) => (
                    <Field key={i} name={`dependent_age_${i}`} label={`Age of Dependent ${i + 1}`} type="number" required
                        value={dependentAges[i] ?? ''} error={errors[`dependent_age_${i}`]}
                        onChange={(_, v) => setAge(i, v)} />
                ))}
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PrincipalInfoStep;
