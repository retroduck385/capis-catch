import { useState } from 'react';
import { deleteParty, getParty, replaceApplicantRows, toForm, upsertParty } from '../api';
import { Field, FieldGroup, FormError, Section, StepButtons } from '../fields';
import { MAX_DEPENDENTS, PARTY_FIELDS, PERSON_FIELDS } from '../options';
import { hasErrors, validateDependents, validatePerson } from '../validators';

const FIELDS = PARTY_FIELDS.PRINCIPAL.map(([f]) => f);
const REQUIRED = PARTY_FIELDS.PRINCIPAL.filter(([, r]) => r).map(([f]) => f);

// Same fields as PARTY_FIELDS.PRINCIPAL, grouped so related details sit together (up to four per row)
const GROUPS = [
    ['Name', ['first_name', 'middle_name', 'last_name', 'name_extension']],
    ['Personal details', ['gender', 'civil_status', 'date_of_birth', 'birth_place']],
    ['Contact', ['mobile_number', 'email_address']],
    ['Citizenship and government IDs', ['citizenship', 'sss_no', 'tin']],
];

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
            {GROUPS.map(([title, fields]) => (
                <Section key={title} title={title} className="ct-cols-4">
                    <FieldGroup config={PERSON_FIELDS} fields={fields} required={REQUIRED}
                        values={form} errors={errors} onChange={set} prefix="PRINCIPAL-" />
                </Section>
            ))}
            <Section title="Dependents" className="ct-cols-4">
                <Field name="dependent_count" label="Number of Dependents" type="number" required placeholder="0"
                    hint={`Up to ${MAX_DEPENDENTS} dependents.`} value={dependentCount} error={errors.dependent_count}
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
