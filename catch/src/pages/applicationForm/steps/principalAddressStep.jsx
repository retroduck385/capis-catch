import { useState } from 'react';
import { getAddress, getParty, toForm, upsertAddress } from '../api';
import { AddressFields, FormError, Section, StepButtons } from '../fields';
import { ADDRESS_FIELDS, ADDRESS_KEYS } from '../options';
import { hasErrors, validateAddress } from '../validators';

const PERMANENT_KEYS = [...Object.keys(ADDRESS_FIELDS), 'date_move_in'];

const PrincipalAddressStep = ({ app, onSaved, onBack }) => {
    const principal = getParty(app, 'PRINCIPAL');
    const [present, setPresent] = useState(() => {
        const initial = toForm(getAddress(principal, 'PRESENT'), ADDRESS_KEYS);
        if (initial.living_in_ph === '') initial.living_in_ph = true;
        return initial;
    });
    const [permanent, setPermanent] = useState(() => toForm(getAddress(principal, 'PERMANENT'), PERMANENT_KEYS));
    const [errors, setErrors] = useState({ present: {}, permanent: {} });
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const copyPresent = () =>
        setPermanent(Object.fromEntries(PERMANENT_KEYS.map((k) => [k, present[k] ?? ''])));

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = { present: validateAddress(present, 'PRESENT'), permanent: validateAddress(permanent, 'PERMANENT') };
        setErrors(found);
        if (hasErrors(found.present) || hasErrors(found.permanent)) return;

        setSaving(true);
        setError(null);
        try {
            const rent = present.home_ownership === 'RENTED' ? present.monthly_rent : null;
            await upsertAddress(principal.id, 'PRESENT', { ...present, monthly_rent: rent });
            await upsertAddress(principal.id, 'PERMANENT', permanent);
            await onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <Section title="Principal Borrower's Present Address">
                <AddressFields kind="PRESENT" idPrefix="present" values={present} errors={errors.present}
                    onChange={(f, v) => setPresent((a) => ({ ...a, [f]: v }))} />
            </Section>
            <Section title="Principal Borrower's Permanent Address">
                <button type="button" className="border px-3 py-1" onClick={copyPresent}>Same as present address</button>
                <AddressFields kind="PERMANENT" idPrefix="permanent" values={permanent} errors={errors.permanent}
                    onChange={(f, v) => setPermanent((a) => ({ ...a, [f]: v }))} />
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PrincipalAddressStep;
