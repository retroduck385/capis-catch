import { useState } from 'react';
import { getAddress, getParty, toForm, upsertAddress } from '../api';
import { AddressFields, Field, FormError, Section, StepButtons } from '../fields';
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

    const copyOf = (a) => Object.fromEntries(PERMANENT_KEYS.map((k) => [k, a[k] ?? '']));
    // "Same as present address": while ticked, the permanent address follows the present one. Editing the
    // permanent address by hand unticks it. Starts ticked when the saved addresses are already identical.
    const [samePresent, setSamePresent] = useState(() =>
        PERMANENT_KEYS.some((k) => present[k]) && PERMANENT_KEYS.every((k) => (present[k] ?? '') === (permanent[k] ?? '')));

    const toggleSame = (checked) => {
        setSamePresent(checked);
        // ticking copies the present address; unticking clears it so a different address can be typed in
        setPermanent(checked ? copyOf(present) : Object.fromEntries(PERMANENT_KEYS.map((k) => [k, ''])));
    };
    const changePresent = (f, v) => {
        const next = { ...present, [f]: v };
        setPresent(next);
        if (samePresent && PERMANENT_KEYS.includes(f)) setPermanent(copyOf(next));
    };
    const changePermanent = (f, v) => {
        setSamePresent(false);
        setPermanent((a) => ({ ...a, [f]: v }));
    };

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
        <form onSubmit={handleSubmit} noValidate>
            <Section title="Principal Borrower's Present Address" className="ct-panel ct-cols-4">
                <AddressFields kind="PRESENT" idPrefix="present" values={present} errors={errors.present}
                    onChange={changePresent} />
            </Section>
            <Section title="Principal Borrower's Permanent Address" className="ct-panel ct-cols-4">
                <Field name="same_as_present" type="checkbox" label="Same as present address"
                    value={samePresent} onChange={(_, v) => toggleSame(v)} />
                <AddressFields kind="PERMANENT" idPrefix="permanent" values={permanent} errors={errors.permanent}
                    onChange={changePermanent} />
            </Section>
            <FormError error={error} />
            <StepButtons onBack={onBack} saving={saving} />
        </form>
    );
};

export default PrincipalAddressStep;
