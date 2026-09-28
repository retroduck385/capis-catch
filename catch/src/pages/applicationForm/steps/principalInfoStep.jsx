import { useState } from 'react';
import { deleteParty, getParty, replaceApplicantRows, toForm, upsertParty } from '../api';
import { Field, FormError, PersonFields, Section, StepButtons } from '../fields';
import { PARTY_FIELDS } from '../options';
import { hasErrors, parseDependentAges, validateDependentAges, validatePerson } from '../validators';

const FIELDS = PARTY_FIELDS.PRINCIPAL.map(([f]) => f);

const PrincipalInfoStep = ({ app, session, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const [form, setForm] = useState(() => {
        const initial = toForm(principal, FIELDS);
        if (!principal) initial.email_address = session?.user?.email ?? ''; // start from the account email
        return initial;
    });
    const [dependentAges, setDependentAges] = useState(
        (principal?.dependents ?? []).map((d) => d.age).join(', '));
    const [errors, setErrors] = useState({});
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = { ...validatePerson(form, 'PRINCIPAL'), ...validateDependentAges(dependentAges) };
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
                parseDependentAges(dependentAges).map((age) => ({ age: Number(age) })));
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
            <Section title="Principal Borrower Information">
                <PersonFields role="PRINCIPAL" values={form} errors={errors} onChange={set} />
                <Field name="dependent_ages" label="Age of Dependents (comma-separated, leave blank if none)"
                    placeholder="e.g. 4, 9" value={dependentAges} error={errors.dependent_ages}
                    onChange={(_, v) => setDependentAges(v)} />
                <p className="text-sm">Number of dependents: {parseDependentAges(dependentAges).length}</p>
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PrincipalInfoStep;
